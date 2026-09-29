const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/social-service.mjs'));
const player = overrides => ({
  id: '00000000-0000-4000-8000-000000000002', display_name: 'Pixel Pal', bio: '', social_visibility: 'public',
  avatar_kind: 'preset', preset_key: 'fox', follower_count: 2, following_count: 1, is_following: false, is_me: false,
  ...overrides,
});

test('social foundation enforces profile privacy, relationship safety and ranked results', async () => {
  const { createSocialService } = await import(moduleUrl);
  const calls = [];
  const repository = {
    getProfile: async (viewerId, userId) => userId === 'hidden' ? null : player({ id: userId, is_me: viewerId === userId }),
    updateSettings: async input => { calls.push(['settings', input]); return player({ id: input.userId, bio: input.bio, social_visibility: input.visibility, is_me: true }); },
    follow: async input => { calls.push(['follow', input]); return player({ id: input.followedId, is_following: true, follower_count: 3 }); },
    unfollow: async (...args) => calls.push(['unfollow', args]),
    block: async input => { calls.push(['block', input]); return true; },
    unblock: async (...args) => calls.push(['unblock', args]),
    leaderboard: async () => [player({ guessed_count: 7, elapsed_seconds: 42, hints: 0, completed_at: new Date('2026-09-29T00:00:00Z') })],
  };
  const service = createSocialService({ repository, clock: () => new Date('2026-09-29T01:00:00Z') });
  const actor = { userId: '00000000-0000-4000-8000-000000000001' };
  assert.equal((await service.updateSettings(actor, { bio: '  三分钟休息玩家  ', visibility: 'followers' })).bio, '三分钟休息玩家');
  assert.equal((await service.follow(actor, '00000000-0000-4000-8000-000000000002')).isFollowing, true);
  await assert.rejects(service.follow(actor, actor.userId), error => error.code === 'SELF_RELATION');
  assert.deepEqual(await service.block(actor, '00000000-0000-4000-8000-000000000002'), { blocked: true });
  await assert.rejects(service.getProfile(actor, 'hidden'), error => error.code === 'PROFILE_NOT_VISIBLE');
  const board = await service.leaderboard(actor, { date: '2026-09-29', scope: 'following' });
  assert.equal(board[0].rank, 1);
  assert.equal(board[0].elapsedSeconds, 42);
  assert.ok(calls.some(([kind]) => kind === 'settings'));
  assert.ok(calls.some(([kind]) => kind === 'block'));
});

test('social inputs fail closed before touching the repository', async () => {
  const { createSocialService } = await import(moduleUrl);
  const service = createSocialService({ repository: {} });
  await assert.rejects(service.updateSettings({ userId: 'u' }, { bio: 'x'.repeat(161), visibility: 'public' }), error => error.code === 'SCHEMA_INVALID');
  await assert.rejects(service.leaderboard({ userId: 'u' }, { date: 'today', scope: 'global' }), error => error.code === 'SCHEMA_INVALID');
  await assert.rejects(service.getSettings(null), error => error.code === 'AUTH_REQUIRED');
});

test('structured social loop limits reactions, notifications and challenges', async () => {
  const { createSocialService } = await import(moduleUrl);
  const now = new Date('2026-09-29T04:00:00Z');
  const actor = { userId: '00000000-0000-4000-8000-000000000001' };
  const targetId = '00000000-0000-4000-8000-000000000002';
  const repository = {
    react: async input => input.reaction === 'spark',
    removeReaction: async () => {},
    listNotifications: async () => [player({
      id: targetId, notification_id: '00000000-0000-4000-8000-000000000003', notification_type: 'reaction',
      puzzle_date: '2026-09-29', reaction: 'spark', read_at: null, notification_created_at: now,
    })],
    markNotificationsRead: async () => 1,
    createChallenge: async input => ({ code: input.code, puzzle_date: input.puzzleDate, expires_at: input.expiresAt }),
    getChallenge: async () => player({ code: 'PIXEL_LINK_1', puzzle_date: '2026-09-29', expires_at: new Date('2026-09-29T16:00:00Z'), guessed_count: 8, elapsed_seconds: 39, hints: 0, participant_user_id: null }),
    acceptChallenge: async () => ({ accepted: true, completed: false, outcome: null }),
    completeChallenge: async () => ({ outcome: 'win', creator: { guessedCount: 8, elapsedSeconds: 39, hints: 1 }, participant: { guessedCount: 7, elapsedSeconds: 35, hints: 0 } }),
    listChallenges: async () => [{ code: 'PIXEL_LINK_1', creator_user_id: targetId, participant_user_id: actor.userId, puzzle_date: '2026-09-29', expires_at: new Date('2026-09-29T16:00:00Z'), completed_at: now, participant_outcome: 'win', creator_guessed: 8, creator_elapsed: 39, creator_hints: 1, participant_guessed: 7, participant_elapsed: 35, participant_hints: 0 }],
    getProfile: async (_viewerId, userId) => player({ id: userId }),
    getRetention: async () => ({ dates: ['2026-09-26','2026-09-27','2026-09-28'], completedChallenges: 2, challengeWins: 1 }),
    getNotificationPreferences: async () => ({ follow_enabled: true, reaction_enabled: false, challenge_enabled: true }),
    updateNotificationPreferences: async input => ({ follow_enabled: input.follow, reaction_enabled: input.reaction, challenge_enabled: input.challenge }),
  };
  const service = createSocialService({ repository, clock: () => now });
  assert.deepEqual(await service.react(actor, targetId, { puzzleDate: '2026-09-29', reaction: 'spark' }), { reaction: 'spark' });
  await assert.rejects(service.react(actor, targetId, { puzzleDate: '2026-09-29', reaction: 'free-text' }), error => error.code === 'SCHEMA_INVALID');
  assert.equal((await service.listNotifications(actor))[0].read, false);
  assert.deepEqual(await service.markNotificationsRead(actor), { updated: 1 });
  const challenge = await service.createChallenge(actor, { puzzleDate: '2026-09-29' });
  assert.match(challenge.code, /^[A-Za-z0-9_-]{10,24}$/);
  assert.equal((await service.getChallenge(actor, 'PIXEL_LINK_1')).score.elapsedSeconds, 39);
  assert.deepEqual(await service.acceptChallenge(actor, 'PIXEL_LINK_1'), { accepted: true, completed: false, outcome: null });
  assert.equal((await service.completeChallenge(actor, 'PIXEL_LINK_1')).outcome, 'win');
  const history = await service.listChallenges(actor);
  assert.equal(history[0].status, 'completed');
  assert.equal(history[0].outcome, 'win');
  assert.equal(history[0].opponent.displayName, 'Pixel Pal');
  const retention = await service.getRetention(actor);
  assert.equal(retention.currentStreak, 3);
  assert.equal(retention.longestStreak, 3);
  assert.equal(retention.badges.find(item => item.key === 'duel_winner').unlocked, true);
  assert.deepEqual(await service.getNotificationPreferences(actor), { follow: true, reaction: false, challenge: true });
  assert.deepEqual(await service.updateNotificationPreferences(actor, { follow: false, reaction: true, challenge: false }), { follow: false, reaction: true, challenge: false });
  await assert.rejects(service.createChallenge(actor, { puzzleDate: '2026-09-28' }), error => error.code === 'CHALLENGE_DATE_CLOSED');
});
