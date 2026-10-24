import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;
const MAX_RESPONSE_BYTES = 262144;

export const GITHUB_REPOSITORY_READ_TOOL = Object.freeze({
  toolKey: 'research.github.repository.read',
  contractVersion: 1,
  status: 'active',
  capabilityKey: 'research.github.read',
  riskLevel: 'L1',
  executionClass: 'remote',
  effectClass: 'read-only',
  inputSchema: { key: 'github.repository.read.input', version: 1 },
  outputSchema: { key: 'github.repository.read.output', version: 1 },
  networkPolicy: { allowedOrigins: ['https://api.github.com'], redirects: 'deny', authentication: 'none' },
  filesystemPolicy: { read: false, write: false },
  timeoutSeconds: 30,
  outputLimitBytes: 131072,
});

export class AgentGitHubRepositoryToolError extends Error {
  constructor(code, { retryable = false, notDispatched = false, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentGitHubRepositoryToolError';
    this.code = code;
    this.retryable = retryable;
    this.notDispatched = notDispatched;
  }
}

const fail = (code, options) => { throw new AgentGitHubRepositoryToolError(code, options); };

export function normalizeGitHubRepositoryLocator(value) {
  if (typeof value !== 'string' || value.length > 240) fail('AGENT_GITHUB_REPOSITORY_INVALID', { notDispatched: true });
  let locator = value.trim().replace(/\.git$/iu, '');
  if (/^https?:\/\//iu.test(locator)) {
    let url;
    try { url = new URL(locator); } catch { fail('AGENT_GITHUB_REPOSITORY_INVALID', { notDispatched: true }); }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password
      || url.port || url.search || url.hash) fail('AGENT_GITHUB_REPOSITORY_INVALID', { notDispatched: true });
    locator = url.pathname.replace(/^\/+|\/+$/gu, '');
  }
  if (!REPOSITORY.test(locator)) fail('AGENT_GITHUB_REPOSITORY_INVALID', { notDispatched: true });
  const [owner, repository] = locator.split('/');
  return {
    owner, repository,
    key: `${owner.toLowerCase()}/${repository.toLowerCase()}`,
    canonicalUrl: `https://github.com/${owner}/${repository}`,
  };
}

export function validateGitHubRepositoryReadInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'repository')) fail('AGENT_GITHUB_TOOL_INPUT_INVALID', { notDispatched: true });
  return { repository: normalizeGitHubRepositoryLocator(value.repository).canonicalUrl };
}

export function validateGitHubRepositoryReadOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('AGENT_GITHUB_TOOL_OUTPUT_INVALID');
  const required = ['schemaVersion', 'repository', 'sourceVersion', 'metadata', 'readme'];
  if (Object.keys(value).some(key => !required.includes(key)) || required.some(key => !Object.hasOwn(value, key))
    || value.schemaVersion !== 'github-repository-evidence-v1'
    || typeof value.repository?.canonicalUrl !== 'string' || typeof value.repository?.key !== 'string'
    || typeof value.sourceVersion?.revision !== 'string' || !/^[a-f0-9]{40}$/u.test(value.sourceVersion.revision)
    || typeof value.sourceVersion?.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sourceVersion.contentSha256)
    || typeof value.metadata?.name !== 'string' || typeof value.metadata?.fullName !== 'string'
    || !Number.isSafeInteger(value.metadata?.stars) || value.metadata.stars < 0
    || (value.readme !== null && (typeof value.readme?.text !== 'string' || value.readme.text.length > 12000))) {
    fail('AGENT_GITHUB_TOOL_OUTPUT_INVALID');
  }
  return structuredClone(value);
}

async function readResponse(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) fail('AGENT_GITHUB_RESPONSE_TOO_LARGE');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) fail('AGENT_GITHUB_RESPONSE_TOO_LARGE');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createGitHubRepositoryReadAdapter({ fetchImpl = globalThis.fetch, userAgent = 'GameHub-Agent-Research/1.0' } = {}) {
  if (typeof fetchImpl !== 'function') fail('AGENT_GITHUB_FETCH_REQUIRED', { notDispatched: true });
  const request = async (path, { optional = false, timeoutSeconds = 30 } = {}) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutSeconds * 1000),
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': userAgent, 'x-github-api-version': '2022-11-28',
        },
      });
    } catch (error) {
      fail('AGENT_GITHUB_NETWORK_FAILED', { retryable: true, cause: error });
    }
    if (optional && response.status === 404) return null;
    if (!response.ok) fail(response.status === 404 ? 'AGENT_GITHUB_REPOSITORY_NOT_FOUND' : 'AGENT_GITHUB_UPSTREAM_FAILED',
      { retryable: response.status === 429 || response.status >= 500 });
    return readResponse(response);
  };
  return async ({ request: input, timeoutSeconds = 30 }) => {
    const locator = normalizeGitHubRepositoryLocator(input?.repository);
    const base = `/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repository)}`;
    const metadataText = await request(base, { timeoutSeconds });
    let metadata;
    try { metadata = JSON.parse(metadataText); } catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
    const branch = typeof metadata.default_branch === 'string' && metadata.default_branch ? metadata.default_branch : 'HEAD';
    const [commitText, readmeResponseText] = await Promise.all([
      request(`${base}/commits/${encodeURIComponent(branch)}`, { timeoutSeconds }),
      request(`${base}/readme?ref=${encodeURIComponent(branch)}`, { optional: true, timeoutSeconds }),
    ]);
    let commit;
    try { commit = JSON.parse(commitText); } catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
    if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/u.test(commit.sha)) fail('AGENT_GITHUB_RESPONSE_INVALID');
    let readme = null;
    if (readmeResponseText !== null) {
      let raw;
      try { raw = JSON.parse(readmeResponseText); } catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
      if (raw?.encoding !== 'base64' || typeof raw.content !== 'string' || typeof raw.path !== 'string'
        || raw.path.length < 1 || raw.path.length > 500 || raw.path.split('/').some(part => !part || part === '.' || part === '..')) {
        fail('AGENT_GITHUB_RESPONSE_INVALID');
      }
      const encoded = raw.content.replace(/\s/gu, '');
      if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) fail('AGENT_GITHUB_RESPONSE_INVALID');
      const bytes = Buffer.from(encoded, 'base64');
      readme = {
        canonicalUri: `${locator.canonicalUrl}/blob/${commit.sha}/${raw.path.split('/').map(encodeURIComponent).join('/')}`,
        path: raw.path,
        text: new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\u0000/gu, '').slice(0, 12000),
      };
    }
    const output = {
      schemaVersion: 'github-repository-evidence-v1',
      repository: { key: locator.key, canonicalUrl: locator.canonicalUrl, owner: locator.owner, name: locator.repository },
      sourceVersion: {
        revision: commit.sha,
        canonicalUri: `${locator.canonicalUrl}/tree/${commit.sha}`,
        fetchedAt: new Date().toISOString(),
        contentSha256: '',
      },
      metadata: {
        name: String(metadata.name ?? locator.repository).slice(0, 100),
        fullName: String(metadata.full_name ?? `${locator.owner}/${locator.repository}`).slice(0, 240),
        description: metadata.description == null ? null : String(metadata.description).slice(0, 1000),
        homepage: metadata.homepage == null ? null : String(metadata.homepage).slice(0, 500),
        defaultBranch: branch.slice(0, 240),
        stars: Math.max(0, Number.isSafeInteger(metadata.stargazers_count) ? metadata.stargazers_count : 0),
        forks: Math.max(0, Number.isSafeInteger(metadata.forks_count) ? metadata.forks_count : 0),
        openIssues: Math.max(0, Number.isSafeInteger(metadata.open_issues_count) ? metadata.open_issues_count : 0),
        topics: Array.isArray(metadata.topics) ? metadata.topics.filter(item => typeof item === 'string').slice(0, 30) : [],
        licenseSpdx: typeof metadata.license?.spdx_id === 'string' ? metadata.license.spdx_id.slice(0, 80) : null,
        archived: metadata.archived === true,
        pushedAt: typeof metadata.pushed_at === 'string' ? metadata.pushed_at : null,
      },
      readme,
    };
    output.sourceVersion.contentSha256 = stableHash({ metadata: output.metadata, readme: output.readme });
    validateGitHubRepositoryReadOutput(output);
    return {
      receiptId: `github:${locator.key}@${commit.sha}`,
      output,
      responseRef: {
        sourceType: 'github.repository', canonicalUri: output.sourceVersion.canonicalUri,
        revision: commit.sha, contentSha256: output.sourceVersion.contentSha256,
      },
      usage: { toolCalls: 1, networkRequests: 3 },
    };
  };
}
