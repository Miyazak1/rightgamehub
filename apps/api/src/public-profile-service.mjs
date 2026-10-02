const HANDLE = /^[a-z][a-z0-9-]{2,31}$/;
const KINDS = new Set(['github','website','portfolio','bilibili','other']);
const RESERVED = new Set(['admin','api','account','creator','discover','install','library','login','me','play','profile','settings','social','support','works']);

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

const view = result => {
  const works = groupedWorks(result.workRows);
  const library = groupedWorks(result.libraryWorkRows ?? []);
  const featuredIds = [...new Set(result.workRows.filter(row => row.featured_position != null).sort((a,b) => a.featured_position - b.featured_position).map(row => row.id))];
  const workById = new Map(works.map(work => [work.id, work]));
  const row = result.profile;
  return {
    id: row.id, handle: row.profile_handle, displayName: row.display_name, headline: row.bio, about: row.profile_about,
    visibility: row.social_visibility, libraryVisibility: row.profile_library_visibility ?? 'private', libraryVisible: Boolean(result.libraryVisible), creator: Boolean(row.can_publish), role: row.role, joinedAt: new Date(row.created_at).toISOString(),
    avatar: avatarView(row), followerCount: Number(row.follower_count || 0), followingCount: Number(row.following_count || 0),
    isFollowing: Boolean(row.is_following), isMe: Boolean(row.is_me),
    links: result.links.map(link => ({ kind: link.kind, label: link.label, url: link.url })),
    githubRepositories: (result.githubRepositories ?? []).map(repository => ({ id: repository.id, owner: repository.owner_login, name: repository.name, url: repository.html_url })),
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
      if (!HANDLE.test(handle) || RESERVED.has(handle) || Array.from(headline).length > 160 || Array.from(about).length > 2000 || !['public','followers','private'].includes(input.visibility) || !['public','followers','private'].includes(libraryVisibility)) throw new PublicProfileError('SCHEMA_INVALID', 400, '个人主页资料无效。');
      const githubRepositoryIds = input.githubRepositoryIds ?? [];
      if (!Array.isArray(input.links) || input.links.length > 5 || !Array.isArray(input.featuredWorkIds) || input.featuredWorkIds.length > 6 || new Set(input.featuredWorkIds).size !== input.featuredWorkIds.length || !Array.isArray(githubRepositoryIds) || githubRepositoryIds.length > 6 || new Set(githubRepositoryIds).size !== githubRepositoryIds.length) throw new PublicProfileError('SCHEMA_INVALID', 400, '主页链接、精选作品或 GitHub 仓库数量无效。');
      const links = input.links.map(validateLink);
      if (new Set(links.map(link => link.url)).size !== links.length) throw new PublicProfileError('SCHEMA_INVALID', 400, '主页链接不能重复。');
      const result = await repository.update({ userId: actor.userId, handle, headline, about, visibility: input.visibility, libraryVisibility, links, featuredWorkIds: input.featuredWorkIds, githubRepositoryIds, now: clock() });
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
