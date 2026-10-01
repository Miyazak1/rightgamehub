import crypto from 'node:crypto';

export class SocialError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'SocialError'; this.code = code; this.statusCode = statusCode; this.retryable = false; }
}

const requireActor = actor => { if (!actor?.userId) throw new SocialError('AUTH_REQUIRED', 401, '需要登录后使用社交功能。'); };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REACTIONS = new Set(['gg','spark','wow','coffee']);
const chinaDate = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const profileView = row => ({
  id: row.id,
  handle: row.profile_handle,
  displayName: row.display_name,
  bio: row.bio,
  visibility: row.social_visibility,
  avatar: row.avatar_kind === 'upload' ? {
    kind: 'upload', presetKey: null,
    url: `/v1/avatars/${row.id}?v=${Buffer.from(row.sha256).toString('hex').slice(0, 12)}`,
    staticUrl: (row.poster_body || row.poster_key) ? `/v1/avatars/${row.id}?variant=static&v=${Buffer.from(row.sha256).toString('hex').slice(0, 12)}` : null,
    mediaType: row.media_type, animated: row.animated,
  } : { kind: 'preset', presetKey: row.preset_key || 'cat', url: null, staticUrl: null, mediaType: null, animated: false },
  followerCount: Number(row.follower_count || 0),
  followingCount: Number(row.following_count || 0),
  isFollowing: Boolean(row.is_following),
  isMe: Boolean(row.is_me),
});
const scoreView = row => ({ guessedCount: Number(row.guessed_count ?? row.guessedCount), elapsedSeconds: Number(row.elapsed_seconds ?? row.elapsedSeconds), hints: Number(row.hints) });
const invertOutcome = outcome => outcome === 'win' ? 'loss' : outcome === 'loss' ? 'win' : outcome;
const dayNumber = value => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
const retentionView = (row, today) => {
  const days = [...new Set(row.dates)].map(dayNumber).sort((a,b) => a-b);
  let longest = 0; let run = 0; let previous = null;
  for (const day of days) { run = previous !== null && day === previous + 1 ? run + 1 : 1; longest = Math.max(longest, run); previous = day; }
  const latest = days.at(-1); const todayNumber = dayNumber(today);
  let current = 0;
  if (latest === todayNumber || latest === todayNumber - 1) {
    current = 1;
    for (let index = days.length - 2; index >= 0 && days[index] === days[index + 1] - 1; index -= 1) current += 1;
  }
  const definitions = [
    ['first_break','初次休息','完成第一局猜百科',days.length >= 1],
    ['streak_3','三日火花','连续参与 3 天',longest >= 3],
    ['streak_7','七日像素','连续参与 7 天',longest >= 7],
    ['challenger','挑战者','完成第一场玩家挑战',row.completedChallenges >= 1],
    ['duel_winner','胜负手','赢得第一场玩家挑战',row.challengeWins >= 1],
  ];
  return { currentStreak: current, longestStreak: longest, totalDays: days.length, completedChallenges: row.completedChallenges, badges: definitions.map(([key,name,description,unlocked]) => ({ key,name,description,unlocked })) };
};

export function createSocialService({ repository, clock = () => new Date() }) {
  return {
    async getSettings(actor) {
      requireActor(actor);
      const row = await repository.getProfile(actor.userId, actor.userId);
      if (!row) throw new SocialError('NOT_FOUND', 404, '账号不存在。');
      return profileView(row);
    },
    async updateSettings(actor, input) {
      requireActor(actor);
      const bio = String(input.bio ?? '').trim();
      if (Array.from(bio).length > 160 || !['public','followers','private'].includes(input.visibility)) throw new SocialError('SCHEMA_INVALID', 400, '社交资料设置无效。');
      return profileView(await repository.updateSettings({ userId: actor.userId, bio, visibility: input.visibility, now: clock() }));
    },
    async getProfile(actor, userId) {
      requireActor(actor);
      const row = await repository.getProfile(actor.userId, userId);
      if (!row) throw new SocialError('PROFILE_NOT_VISIBLE', 404, '玩家资料不存在或不可见。');
      return profileView(row);
    },
    async follow(actor, userId) {
      requireActor(actor);
      if (actor.userId === userId) throw new SocialError('SELF_RELATION', 409, '不能关注自己。');
      const row = await repository.follow({ notificationId: crypto.randomUUID(), followerId: actor.userId, followedId: userId, now: clock() });
      if (!row) throw new SocialError('PROFILE_NOT_VISIBLE', 404, '玩家资料不存在或不可关注。');
      return profileView(row);
    },
    async unfollow(actor, userId) { requireActor(actor); await repository.unfollow(actor.userId, userId); return { following: false }; },
    async block(actor, userId) {
      requireActor(actor);
      if (actor.userId === userId) throw new SocialError('SELF_RELATION', 409, '不能拉黑自己。');
      if (!await repository.block({ blockerId: actor.userId, blockedId: userId, now: clock() })) throw new SocialError('NOT_FOUND', 404, '玩家不存在。');
      return { blocked: true };
    },
    async unblock(actor, userId) { requireActor(actor); await repository.unblock(actor.userId, userId); return { blocked: false }; },
    async leaderboard(actor, input) {
      requireActor(actor);
      if (!DATE.test(input.date) || !['global','following'].includes(input.scope)) throw new SocialError('SCHEMA_INVALID', 400, '排行榜参数无效。');
      const rows = await repository.leaderboard({ viewerId: actor.userId, date: input.date, scope: input.scope, limit: 50 });
      return rows.map((row, index) => ({
        rank: index + 1, player: profileView(row), guessedCount: Number(row.guessed_count),
        elapsedSeconds: Number(row.elapsed_seconds), hints: Number(row.hints), completedAt: new Date(row.completed_at).toISOString(),
        reactions: row.reaction_counts ?? {}, myReaction: row.own_reaction ?? null,
      }));
    },
    async react(actor, userId, input) {
      requireActor(actor);
      if (actor.userId === userId) throw new SocialError('SELF_RELATION', 409, '不能给自己的成绩添加反应。');
      if (!DATE.test(input.puzzleDate) || !REACTIONS.has(input.reaction)) throw new SocialError('SCHEMA_INVALID', 400, '反应参数无效。');
      const ok = await repository.react({ id: crypto.randomUUID(), reactorId: actor.userId, targetId: userId, puzzleDate: input.puzzleDate, reaction: input.reaction, now: clock() });
      if (!ok) throw new SocialError('RESULT_NOT_VISIBLE', 404, '这条成绩不存在或不可见。');
      return { reaction: input.reaction };
    },
    async removeReaction(actor, userId, input) {
      requireActor(actor);
      if (!DATE.test(input.puzzleDate)) throw new SocialError('SCHEMA_INVALID', 400, '成绩日期无效。');
      await repository.removeReaction({ reactorId: actor.userId, targetId: userId, puzzleDate: input.puzzleDate });
      return { reaction: null };
    },
    async listNotifications(actor) {
      requireActor(actor);
      return (await repository.listNotifications(actor.userId, 30)).map(row => ({
        id: row.notification_id, type: row.notification_type, actor: profileView(row),
        puzzleDate: row.puzzle_date ? String(row.puzzle_date).slice(0, 10) : null,
        reaction: row.reaction, challengeCode: row.challenge_code ?? null,
        outcome: row.notification_type === 'challenge_complete' ? invertOutcome(row.participant_outcome) : null,
        read: Boolean(row.read_at), createdAt: new Date(row.notification_created_at).toISOString(),
      }));
    },
    async markNotificationsRead(actor) { requireActor(actor); return { updated: await repository.markNotificationsRead(actor.userId, clock()) }; },
    async createChallenge(actor, input) {
      requireActor(actor);
      if (!DATE.test(input.puzzleDate)) throw new SocialError('SCHEMA_INVALID', 400, '挑战日期无效。');
      const now = clock();
      if (input.puzzleDate !== chinaDate(now)) throw new SocialError('CHALLENGE_DATE_CLOSED', 409, '只能发起今日挑战。');
      const expiresAt = new Date(Date.parse(`${input.puzzleDate}T00:00:00+08:00`) + 86_400_000);
      const row = await repository.createChallenge({ id: crypto.randomUUID(), code: crypto.randomBytes(9).toString('base64url'), creatorId: actor.userId, puzzleDate: input.puzzleDate, now, expiresAt });
      if (!row || row.error === 'result_required') throw new SocialError('RESULT_REQUIRED', 409, '完成这道猜百科后才能发起挑战。');
      if (row.error === 'limit') throw new SocialError('CHALLENGE_LIMIT', 429, '今天已经发起 5 次挑战，明天再来。');
      return { code: row.code, puzzleDate: String(row.puzzle_date).slice(0, 10), expiresAt: new Date(row.expires_at).toISOString() };
    },
    async getChallenge(actor, code) {
      requireActor(actor);
      if (!/^[A-Za-z0-9_-]{10,24}$/.test(code)) throw new SocialError('SCHEMA_INVALID', 400, '挑战代码无效。');
      const row = await repository.getChallenge(actor.userId, code, clock());
      if (!row) throw new SocialError('CHALLENGE_NOT_FOUND', 404, '挑战不存在、已过期或不可见。');
      return {
        code: row.code, puzzleDate: String(row.puzzle_date).slice(0, 10), expiresAt: new Date(row.expires_at).toISOString(),
        creator: profileView(row), score: scoreView(row),
        status: row.participant_user_id ? (row.participation_completed_at ? 'completed' : 'accepted') : 'open',
        acceptedByMe: row.participant_user_id === actor.userId,
      };
    },
    async acceptChallenge(actor, code) {
      requireActor(actor);
      if (!/^[A-Za-z0-9_-]{10,24}$/.test(code)) throw new SocialError('SCHEMA_INVALID', 400, '挑战代码无效。');
      const result = await repository.acceptChallenge({ userId: actor.userId, code, now: clock() });
      if (result.error === 'not_found') throw new SocialError('CHALLENGE_NOT_FOUND', 404, '挑战不存在、已过期或不可见。');
      if (result.error === 'self') throw new SocialError('SELF_CHALLENGE', 409, '不能接受自己发起的挑战。');
      if (result.error === 'taken') throw new SocialError('CHALLENGE_TAKEN', 409, '这个挑战已经被其他玩家接受。');
      if (result.error === 'limit') throw new SocialError('CHALLENGE_LIMIT', 429, '今天已经接受 10 次挑战，明天再来。');
      return { accepted: true, completed: Boolean(result.completed), outcome: result.outcome ?? null };
    },
    async completeChallenge(actor, code) {
      requireActor(actor);
      if (!/^[A-Za-z0-9_-]{10,24}$/.test(code)) throw new SocialError('SCHEMA_INVALID', 400, '挑战代码无效。');
      const result = await repository.completeChallenge({ userId: actor.userId, code, now: clock(), notificationId: crypto.randomUUID() });
      if (result.error === 'not_found') throw new SocialError('CHALLENGE_NOT_FOUND', 404, '挑战不存在、已过期或未接受。');
      if (result.error === 'result_required') throw new SocialError('RESULT_REQUIRED', 409, '完成这道猜百科后才能结算挑战。');
      return { outcome: result.outcome, creator: scoreView(result.creator), participant: scoreView(result.participant) };
    },
    async listChallenges(actor) {
      requireActor(actor);
      const rows = await repository.listChallenges(actor.userId, clock(), 30);
      const items = [];
      for (const row of rows) {
        const role = row.creator_user_id === actor.userId ? 'creator' : 'participant';
        const opponentId = role === 'creator' ? row.participant_user_id : row.creator_user_id;
        const opponentRow = opponentId ? await repository.getProfile(actor.userId, opponentId) : null;
        if (opponentId && !opponentRow) continue;
        const completed = Boolean(row.completed_at);
        const expired = !completed && new Date(row.expires_at) <= clock();
        items.push({
          code: row.code, puzzleDate: String(row.puzzle_date).slice(0, 10), expiresAt: new Date(row.expires_at).toISOString(), role,
          status: completed ? 'completed' : expired ? 'expired' : 'pending',
          outcome: completed ? (role === 'creator' ? invertOutcome(row.participant_outcome) : row.participant_outcome) : null,
          opponent: opponentRow ? profileView(opponentRow) : null,
          myScore: role === 'creator' ? scoreView({ guessed_count: row.creator_guessed, elapsed_seconds: row.creator_elapsed, hints: row.creator_hints }) : scoreView({ guessed_count: row.participant_guessed, elapsed_seconds: row.participant_elapsed, hints: row.participant_hints }),
          opponentScore: opponentId ? (role === 'creator' ? scoreView({ guessed_count: row.participant_guessed, elapsed_seconds: row.participant_elapsed, hints: row.participant_hints }) : scoreView({ guessed_count: row.creator_guessed, elapsed_seconds: row.creator_elapsed, hints: row.creator_hints })) : null,
        });
      }
      return items;
    },
    async getRetention(actor) {
      requireActor(actor);
      return retentionView(await repository.getRetention(actor.userId), chinaDate(clock()));
    },
    async getNotificationPreferences(actor) {
      requireActor(actor);
      const row = await repository.getNotificationPreferences(actor.userId);
      if (!row) throw new SocialError('NOT_FOUND', 404, '账号不存在。');
      return { follow: Boolean(row.follow_enabled), reaction: Boolean(row.reaction_enabled), challenge: Boolean(row.challenge_enabled) };
    },
    async updateNotificationPreferences(actor, input) {
      requireActor(actor);
      if (typeof input.follow !== 'boolean' || typeof input.reaction !== 'boolean' || typeof input.challenge !== 'boolean') throw new SocialError('SCHEMA_INVALID', 400, '通知偏好无效。');
      const row = await repository.updateNotificationPreferences({ userId: actor.userId, ...input, now: clock() });
      return { follow: row.follow_enabled, reaction: row.reaction_enabled, challenge: row.challenge_enabled };
    },
  };
}
