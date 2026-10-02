const HANDLE = /^[a-z][a-z0-9-]{2,31}$/;
const KINDS = new Set(['github','website','portfolio','bilibili','other']);
const RESERVED = new Set(['admin','api','account','creator','discover','install','library','login','me','play','profile','settings','social','support','works']);
const COLLABORATION_STATUSES = new Set(['not_looking','open_to_collaboration','available_for_hire']);
const VISIBILITIES = new Set(['public','followers','private']);

export class PublicProfileError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'PublicProfileError'; this.code = code; this.statusCode = statusCode; this.retryable = false; }
}

const avatarView = row => row.avatar_kind === 'upload' ? {
  kind: 'upload', presetKey: null,
  url: `/v1/avatars/${row.id}?v=${Buffer.from(row.sha256).toString('hex').slice(0, 12)}`,
  staticUrl: (row.poster_body || row.poster_key) ? `/v1/avatars/${row.id}?variant=static&v=${Buffer.from(row.sha256).toString('hex').slice(0, 12)}` : null,
  mediaType: row.media_type, animated: row.animated,
} : { kind: 'preset', presetKey: row.preset_key || 'cat', url: null, staticUrl: null, mediaType: null, animated: false };

const targetView = row => ({ targetKey: row.target_key, state: row.target_state, currentReleaseId: row.current_release_id, revision: String(row.target_revision), packageType: row.package_type, releaseLabel: row.release_label, os: row.release_os, arch: row.release_arch, fileName: row.release_file_name ?? null, sizeBytes: row.release_size_bytes == null ? null : Number(row.release_size_bytes), sha256: row.release_sha256 ?? null });
const workView = rows => ({
  id: rows[0].id, ownerUserId: rows[0].owner_user_id, title: rows[0].title, description: rows[0].description,
  instructions: rows[0].instructions, kind: rows[0].kind, state: rows[0].state, visibility: rows[0].visibility,
  revision: String(rows[0].revision), firstPublishedAt: new Date(rows[0].first_published_at).toISOString(),
  estimatedMinutes: rows[0].estimated_minutes, tags: rows[0].tags ?? [], agentLabel: rows[0].agent_label,
  repositoryUrl: rows[0].repository_url, licenseSpdx: rows[0].license_spdx,
  creatorDisplayName: rows[0].creator_display_name, creatorHandle: rows[0].creator_handle,
  playCount: Number(rows[0].play_count ?? 0), saveCount: Number(rows[0].save_count ?? 0),
  coverUrl: rows[0].cover_object_key ? `/v1/works/${rows[0].id}/cover?v=${Buffer.from(rows[0].cover_sha256).toString('hex').slice(0, 12)}` : null,
  targets: rows.map(targetView),
});

const groupedWorks = rows => {
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.id)) groups.set(row.id, []); groups.get(row.id).push(row); }
  return [...groups.values()].map(workView);
};

const dayNumber = value => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
const achievementView = metrics => {
  if (!metrics) return null;
  const dates = [...new Set(metrics.dates ?? [])].map(dayNumber).sort((a,b) => a-b);
  let longestStreak = 0; let run = 0; let previous = null;
  for (const day of dates) { run = previous !== null && day === previous + 1 ? run + 1 : 1; longestStreak = Math.max(longestStreak, run); previous = day; }
  const completedChallenges = Number(metrics.completedChallenges ?? 0); const challengeWins = Number(metrics.challengeWins ?? 0);
  const badges = [
    ['first_break','初次休息','完成第一局猜百科',dates.length >= 1],
    ['streak_3','三日火花','连续参与 3 天',longestStreak >= 3],
    ['streak_7','七日像素','连续参与 7 天',longestStreak >= 7],
    ['challenger','挑战者','完成第一场玩家挑战',completedChallenges >= 1],
    ['duel_winner','胜负手','赢得第一场玩家挑战',challengeWins >= 1],
  ].filter(([, , , unlocked]) => unlocked).map(([key,name,description]) => ({ key,name,description }));
  return {
    totalDays: dates.length, longestStreak, completedChallenges, challengeWins,
    bestDailyRank: metrics.bestDailyRank == null ? null : Number(metrics.bestDailyRank),
    latestDailyRank: metrics.latestDailyRank == null ? null : Number(metrics.latestDailyRank),
    latestRankDate: metrics.latestRankDate ?? null, badges,
  };
};

const view = result => {
  const works = groupedWorks(result.workRows);
  const library = groupedWorks(result.libraryWorkRows ?? []);
  const featuredIds = [...new Set(result.workRows.filter(row => row.featured_position != null).sort((a,b) => a.featured_position - b.featured_position).map(row => row.id))];
  const workById = new Map(works.map(work => [work.id, work]));
  const row = result.profile;
  return {
    id: row.id, handle: row.profile_handle, displayName: row.display_name, headline: row.bio, about: row.profile_about,
    visibility: row.social_visibility, libraryVisibility: row.profile_library_visibility ?? 'private', libraryVisible: Boolean(result.libraryVisible),
    collaborationStatus: row.profile_collaboration_status ?? 'not_looking', skills: row.profile_skills ?? [],
    activityVisibility: row.profile_activity_visibility ?? 'private', activityVisible: Boolean(result.activityVisible),
    achievementsVisibility: row.profile_achievements_visibility ?? 'followers', achievementsVisible: Boolean(result.achievementsVisible),
    creator: Boolean(row.can_publish), role: row.role, joinedAt: new Date(row.created_at).toISOString(),
    avatar: avatarView(row), followerCount: Number(row.follower_count || 0), followingCount: Number(row.following_count || 0),
    isFollowing: Boolean(row.is_following), isMe: Boolean(row.is_me),
    links: result.links.map(link => ({ kind: link.kind, label: link.label, url: link.url })),
    githubRepositories: (result.githubRepositories ?? []).map(repository => ({ id: repository.id, owner: repository.owner_login, name: repository.name, url: repository.html_url })),
    contributions: (result.contributions ?? []).map(item => ({ taskId: item.task_id, title: item.title, workId: item.work_id, workTitle: item.work_title, repositoryUrl: item.repository_url, issueUrl: item.issue_url, submissionUrl: item.submission_url, completedAt: new Date(item.completed_at).toISOString() })),
    activity: (result.activity ?? []).map(item => ({ type: item.type, occurredAt: new Date(item.occurred_at).toISOString(), title: item.title, workId: item.work_id ?? null })),
    achievements: achievementView(result.achievementMetrics),
    featuredWorks: featuredIds.map(id => workById.get(id)).filter(Boolean), works, library,
  };
};

const validateLink = raw => {
  const kind = String(raw?.kind || '').trim(); const label = String(raw?.label || '').trim(); const value = String(raw?.url || '').trim();
  if (!KINDS.has(kind) || !label || Array.from(label).length > 40 || value.length > 2048) throw new PublicProfileError('SCHEMA_INVALID', 400, '主页链接信息无效。');
  let url;
  try { url = new URL(value); } catch { throw new PublicProfileError('SCHEMA_INVALID', 400, '主页链接必须是有效的 HTTPS 地址。'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.internal') || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) throw new PublicProfileError('SCHEMA_INVALID', 400, '主页链接必须是公开可访问的 HTTPS 地址。');
  if (kind === 'github' && host !== 'github.com' && !host.endsWith('.github.com')) throw new PublicProfileError('SCHEMA_INVALID', 400, 'GitHub 链接必须使用 github.com。');
  return { kind, label, url: url.toString() };
};

export function createPublicProfileService({ repository, builtInWorks = [], clock = () => new Date() }) {
  return {
    async get(actor, handle) {
      const normalized = String(handle || '').toLowerCase();
      if (!HANDLE.test(normalized)) throw new PublicProfileError('PROFILE_NOT_FOUND', 404, '个人主页不存在或不可见。');
      const result = await repository.getByHandle(actor?.userId ?? null, normalized);
      if (!result) throw new PublicProfileError('PROFILE_NOT_FOUND', 404, '个人主页不存在或不可见。');
      const profile = view(result);
      const databaseIds = new Set(profile.library.map(work => work.id));
      const builtIns = (result.libraryWorkKeys ?? []).map(key => builtInWorks.find(work => work.id === key)).filter(Boolean).filter(work => !databaseIds.has(work.id));
      return { ...profile, library: [...builtIns, ...profile.library] };
    },
    async update(actor, input) {
      if (!actor?.userId) throw new PublicProfileError('AUTH_REQUIRED', 401, '登录后才能编辑个人主页。');
      const handle = String(input.handle || '').trim().toLowerCase();
      const headline = String(input.headline || '').trim(); const about = String(input.about || '').trim();
      const libraryVisibility = input.libraryVisibility ?? 'private';
      const collaborationStatus = input.collaborationStatus === undefined ? null : input.collaborationStatus;
      const activityVisibility = input.activityVisibility === undefined ? null : input.activityVisibility; const achievementsVisibility = input.achievementsVisibility === undefined ? null : input.achievementsVisibility;
      const skills = input.skills === undefined ? null : Array.isArray(input.skills) ? [...new Set(input.skills.map(value => String(value).trim()).filter(Boolean))] : false;
      if (!HANDLE.test(handle) || RESERVED.has(handle) || Array.from(headline).length > 160 || Array.from(about).length > 2000 || !VISIBILITIES.has(input.visibility) || !VISIBILITIES.has(libraryVisibility) || (activityVisibility !== null && !VISIBILITIES.has(activityVisibility)) || (achievementsVisibility !== null && !VISIBILITIES.has(achievementsVisibility)) || (collaborationStatus !== null && !COLLABORATION_STATUSES.has(collaborationStatus)) || skills === false || (skills !== null && (skills.length > 12 || skills.some(skill => Array.from(skill).length > 30)))) throw new PublicProfileError('SCHEMA_INVALID', 400, '个人主页资料无效。');
      const githubRepositoryIds = input.githubRepositoryIds ?? [];
      if (!Array.isArray(input.links) || input.links.length > 5 || !Array.isArray(input.featuredWorkIds) || input.featuredWorkIds.length > 6 || new Set(input.featuredWorkIds).size !== input.featuredWorkIds.length || !Array.isArray(githubRepositoryIds) || githubRepositoryIds.length > 6 || new Set(githubRepositoryIds).size !== githubRepositoryIds.length) throw new PublicProfileError('SCHEMA_INVALID', 400, '主页链接、精选作品或 GitHub 仓库数量无效。');
      const links = input.links.map(validateLink);
      if (new Set(links.map(link => link.url)).size !== links.length) throw new PublicProfileError('SCHEMA_INVALID', 400, '主页链接不能重复。');
      const result = await repository.update({ userId: actor.userId, handle, headline, about, visibility: input.visibility, libraryVisibility, collaborationStatus, skills, activityVisibility, achievementsVisibility, links, featuredWorkIds: input.featuredWorkIds, githubRepositoryIds, now: clock() });
      if (result?.error === 'handle_taken') throw new PublicProfileError('HANDLE_TAKEN', 409, '这个主页地址已经被使用。');
      if (result?.error === 'featured_work_invalid') throw new PublicProfileError('FEATURED_WORK_INVALID', 400, '精选作品必须是你已公开发布且当前可用的作品。');
      if (result?.error === 'github_repository_invalid') throw new PublicProfileError('GITHUB_REPOSITORY_INVALID', 400, '只能展示当前 GitHub 授权中仍然公开的仓库。');
      if (!result) throw new PublicProfileError('NOT_FOUND', 404, '账号不存在。');
      const profile = view(result);
      const databaseIds = new Set(profile.library.map(work => work.id));
      const builtIns = (result.libraryWorkKeys ?? []).map(key => builtInWorks.find(work => work.id === key)).filter(Boolean).filter(work => !databaseIds.has(work.id));
      return { ...profile, library: [...builtIns, ...profile.library] };
    },
  };
}
