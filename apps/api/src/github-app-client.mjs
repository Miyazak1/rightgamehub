import crypto from 'node:crypto';

const API = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const base64url = value => Buffer.from(value).toString('base64url');

export class GitHubAppClientError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message); this.name = 'GitHubAppClientError'; this.code = code; this.statusCode = statusCode; this.retryable = retryable;
  }
}

const normalizePrivateKey = value => value?.replace(/\\n/g, '\n');

export function createGitHubAppClient({ appId, privateKey, slug, fetchImpl = globalThis.fetch, timeoutMs = 10_000, now = () => Date.now() } = {}) {
  if (!appId || !privateKey || !slug) return null;
  const key = normalizePrivateKey(privateKey);
  const tokenCache = new Map();
  const appJwt = () => {
    const issuedAt = Math.floor(now() / 1000) - 30;
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: String(appId) }));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url');
    return `${header}.${payload}.${signature}`;
  };
  const request = async (path, { token = null, method = 'GET', accept = 'application/vnd.github+json', body = undefined, maxBytes = 512 * 1024, binary = false } = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${API}${path}`, {
        method, signal: controller.signal,
        headers: {
          Accept: accept, Authorization: `Bearer ${token ?? appJwt()}`,
          'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'GameHub-GitHub-App',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const contentLength = Number(response.headers?.get?.('content-length') ?? 0);
      if (contentLength > maxBytes) throw new GitHubAppClientError('GITHUB_RESPONSE_TOO_LARGE', 422, 'GitHub returned more data than the import limit allows.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new GitHubAppClientError('GITHUB_RESPONSE_TOO_LARGE', 422, 'GitHub returned more data than the import limit allows.');
      if (!response.ok) {
        const limited = response.status === 403 && (response.headers?.get?.('x-ratelimit-remaining') === '0' || /rate limit/i.test(bytes.toString('utf8')));
        if (limited) throw new GitHubAppClientError('GITHUB_RATE_LIMITED', 503, 'GitHub API rate limit reached; try again later.', true);
        if (response.status === 404) throw new GitHubAppClientError('GITHUB_RESOURCE_NOT_FOUND', 404, 'The authorized GitHub resource is unavailable.');
        throw new GitHubAppClientError('GITHUB_UPSTREAM_ERROR', 502, `GitHub API request failed (${response.status}).`, response.status >= 500);
      }
      if (binary) return bytes;
      if (accept.includes('raw')) return bytes.toString('utf8');
      try { return JSON.parse(bytes.toString('utf8') || '{}'); }
      catch { throw new GitHubAppClientError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid response.', true); }
    } catch (error) {
      if (error?.name === 'AbortError') throw new GitHubAppClientError('GITHUB_TIMEOUT', 504, 'GitHub did not respond in time.', true);
      throw error;
    } finally { clearTimeout(timer); }
  };
  const installationToken = async installationId => {
    const cached = tokenCache.get(String(installationId));
    if (cached && cached.expiresAt - now() > 60_000) return cached.token;
    const payload = await request(`/app/installations/${installationId}/access_tokens`, { method: 'POST' });
    if (!payload.token || !payload.expires_at) throw new GitHubAppClientError('GITHUB_TOKEN_INVALID', 502, 'GitHub did not return a usable installation token.', true);
    tokenCache.set(String(installationId), { token: payload.token, expiresAt: Date.parse(payload.expires_at) });
    return payload.token;
  };
  const withInstallation = async (installationId, action) => action(await installationToken(installationId));
  const repositoryView = repo => {
    const result = {
      repositoryId: String(repo.id), nodeId: String(repo.node_id), owner: String(repo.owner?.login ?? ''), name: String(repo.name ?? ''),
      fullName: String(repo.full_name ?? ''), description: typeof repo.description === 'string' ? repo.description.slice(0, 4000) : '',
      defaultBranch: String(repo.default_branch ?? 'main'), visibility: repo.visibility ?? (repo.private ? 'private' : 'public'),
      private: Boolean(repo.private), htmlUrl: String(repo.html_url ?? ''), topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 20).map(value => String(value).slice(0, 100)) : [],
    };
    if (!/^[1-9][0-9]*$/.test(result.repositoryId) || !result.nodeId || !result.owner || !result.name || !['public','private','internal'].includes(result.visibility) || !/^https:\/\/github\.com\//.test(result.htmlUrl)) {
      throw new GitHubAppClientError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid repository metadata.', true);
    }
    return result;
  };
  return Object.freeze({
    installUrl(state) { const url = new URL(`https://github.com/apps/${slug}/installations/new`); url.searchParams.set('state', state); return url.toString(); },
    async getInstallation(installationId) {
      const item = await request(`/app/installations/${installationId}`);
      const result = {
        installationId: String(item.id), accountId: String(item.account?.id), accountLogin: String(item.account?.login), accountType: item.account?.type,
        repositorySelection: item.repository_selection, permissions: item.permissions ?? {}, createdAt: item.created_at ?? null,
        updatedAt: item.updated_at ?? null, suspendedAt: item.suspended_at ?? null,
      };
      if (!/^[1-9][0-9]*$/.test(result.installationId) || !/^[1-9][0-9]*$/.test(result.accountId) || !result.accountLogin || !['User','Organization'].includes(result.accountType) || !['all','selected'].includes(result.repositorySelection)) {
        throw new GitHubAppClientError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid installation metadata.', true);
      }
      return result;
    },
    async listRepositories(installationId, limit = 500) {
      return withInstallation(installationId, async token => {
        const repositories = []; const perPage = Math.min(100, limit); let complete = false;
        for (let page = 1; page <= Math.ceil(limit / perPage); page += 1) {
          const payload = await request(`/installation/repositories?per_page=${perPage}&page=${page}`, { token, maxBytes: 2 * 1024 * 1024 });
          const items = (payload.repositories ?? []).map(repositoryView);
          repositories.push(...items.slice(0, limit - repositories.length));
          if (items.length < perPage) { complete = true; break; }
          if (repositories.length >= limit) break;
        }
        return { repositories, complete };
      });
    },
    async previewRepository(installationId, owner, name) {
      return withInstallation(installationId, async token => {
        const repoRaw = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { token });
        const repo = repositoryView(repoRaw);
        const commit = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(repo.defaultBranch)}`, { token, maxBytes: 1024 * 1024 });
        const commitSha = String(commit.sha ?? '').toLowerCase();
        const treeSha = String(commit.commit?.tree?.sha ?? '').toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(commitSha) || !/^[a-f0-9]{40}$/.test(treeSha)) throw new GitHubAppClientError('GITHUB_COMMIT_INVALID', 502, 'GitHub did not return a valid commit identity.', true);
        let readme = ''; let license = null; let root = [];
        try { readme = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme?ref=${commitSha}`, { token, accept: 'application/vnd.github.raw+json', maxBytes: 256 * 1024 }); } catch (error) { if (error.code !== 'GITHUB_RESOURCE_NOT_FOUND') throw error; }
        try { license = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/license?ref=${commitSha}`, { token, maxBytes: 512 * 1024 }); } catch (error) { if (error.code !== 'GITHUB_RESOURCE_NOT_FOUND') throw error; }
        try { root = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents?ref=${commitSha}`, { token, maxBytes: 1024 * 1024 }); } catch (error) { if (error.code !== 'GITHUB_RESOURCE_NOT_FOUND') throw error; }
        const names = Array.isArray(root) ? root.slice(0, 200).map(item => String(item.name ?? '').toLowerCase()) : [];
        return { repo, commitSha, treeSha, readme, license, rootNames: names };
      });
    },
    async downloadRepositoryArchive(installationId, owner, name, commitSha, maxBytes = 100 * 1024 * 1024) {
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner ?? '') || !/^[A-Za-z0-9_.-]{1,100}$/.test(name ?? '') || !/^[a-f0-9]{40}$/.test(commitSha ?? '')) throw new GitHubAppClientError('GITHUB_ARCHIVE_REQUEST_INVALID', 400, 'Repository archive identity is invalid.');
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) throw new GitHubAppClientError('GITHUB_ARCHIVE_REQUEST_INVALID', 400, 'Repository archive limit is invalid.');
      return withInstallation(installationId, token => request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/zipball/${commitSha}`, { token,binary:true,maxBytes }));
    },
    clearInstallationToken(installationId) { tokenCache.delete(String(installationId)); },
  });
}
