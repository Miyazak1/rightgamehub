import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { githubRateLimitBackoffSeconds, githubRequestHeaders,
  normalizeGitHubResearchToken } from './agent-github-research-runtime.mjs';

const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;
const MAX_RESPONSE_BYTES = 262144;
const README_PREFIX_BYTES = 49152;
const README_TEXT_CHARS = 12000;

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
  constructor(code, { retryable = false, notDispatched = false, backoffSeconds = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentGitHubRepositoryToolError';
    this.code = code;
    this.retryable = retryable;
    this.notDispatched = notDispatched;
    this.backoffSeconds = backoffSeconds;
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

function validReadme(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['canonicalUri', 'path', 'text', 'truncated'].includes(key))
    || !['canonicalUri', 'path', 'text'].every(key => Object.hasOwn(value, key))
    || typeof value.canonicalUri !== 'string' || typeof value.path !== 'string'
    || value.path.length < 1 || value.path.length > 500
    || value.path.split('/').some(part => !part || part === '.' || part === '..')
    || typeof value.text !== 'string' || value.text.length > README_TEXT_CHARS
    || (Object.hasOwn(value, 'truncated') && typeof value.truncated !== 'boolean')) return false;
  try {
    const url = new URL(value.canonicalUri);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['github.com', 'api.github.com'].includes(url.hostname.toLowerCase());
  } catch { return false; }
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
    || !validReadme(value.readme)) {
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

async function readResponsePrefix(response, maxBytes = README_PREFIX_BYTES) {
  const declaredHeader = response.headers.get('content-length');
  const declared = Number(declaredHeader ?? 0);
  if (!response.body || typeof response.body.getReader !== 'function') {
    if (declaredHeader === null || !Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      fail('AGENT_GITHUB_RESPONSE_TOO_LARGE');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) fail('AGENT_GITHUB_RESPONSE_TOO_LARGE');
    return { bytes, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - length;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        length = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      length += value.byteLength;
    }
  } catch (error) {
    fail('AGENT_GITHUB_NETWORK_FAILED', { retryable: true, cause: error });
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated: truncated || (Number.isFinite(declared) && declared > length) };
}

function encodeRefPath(ref) {
  if (typeof ref !== 'string' || ref.length < 1 || ref.length > 240 || /[\\\u0000-\u001f\u007f]/u.test(ref)) {
    fail('AGENT_GITHUB_RESPONSE_INVALID');
  }
  const parts = ref.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail('AGENT_GITHUB_RESPONSE_INVALID');
  return parts.map(encodeURIComponent).join('/');
}

function readmeFilename(response) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/iu)?.[1];
  let value = encoded ?? plain ?? 'README';
  if (encoded) {
    try { value = decodeURIComponent(encoded); } catch { value = 'README'; }
  }
  value = String(value).trim().replace(/[\\/]/gu, '-').slice(0, 200);
  return value || 'README';
}

export function createGitHubRepositoryReadAdapter({ fetchImpl = globalThis.fetch,
  userAgent = 'GameHub-Agent-Research/1.0', token = null } = {}) {
  if (typeof fetchImpl !== 'function') fail('AGENT_GITHUB_FETCH_REQUIRED', { notDispatched: true });
  const researchToken = normalizeGitHubResearchToken(token);
  const request = async (path, { optional = false, timeoutSeconds = 30,
    accept = 'application/vnd.github+json', range = null } = {}) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutSeconds * 1000),
        headers: githubRequestHeaders({ accept, range, userAgent, token: researchToken }),
      });
    } catch (error) {
      fail('AGENT_GITHUB_NETWORK_FAILED', { retryable: true, cause: error });
    }
    if (optional && response.status === 404) return null;
    if (!response.ok) {
      const backoffSeconds = githubRateLimitBackoffSeconds(response);
      fail(response.status === 404 ? 'AGENT_GITHUB_REPOSITORY_NOT_FOUND'
        : backoffSeconds == null ? 'AGENT_GITHUB_UPSTREAM_FAILED' : 'AGENT_GITHUB_RATE_LIMITED',
      { retryable: backoffSeconds != null || response.status >= 500, backoffSeconds });
    }
    return response;
  };
  return async ({ request: input, timeoutSeconds = 30 }) => {
    const locator = normalizeGitHubRepositoryLocator(input?.repository);
    const base = `/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repository)}`;
    const metadataText = await readResponse(await request(base, { timeoutSeconds }));
    let metadata;
    try { metadata = JSON.parse(metadataText); } catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
    const branch = typeof metadata.default_branch === 'string' && metadata.default_branch ? metadata.default_branch : 'HEAD';
    const referenceText = await readResponse(await request(`${base}/git/ref/heads/${encodeRefPath(branch)}`,
      { timeoutSeconds }));
    let reference;
    try { reference = JSON.parse(referenceText); }
    catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
    const revision = reference?.object?.sha;
    if (reference?.object?.type !== 'commit' || typeof revision !== 'string'
      || !/^[a-f0-9]{40}$/u.test(revision)) fail('AGENT_GITHUB_RESPONSE_INVALID');
    const readmePath = `${base}/readme?ref=${encodeURIComponent(revision)}`;
    const readmeResponse = await request(readmePath, { optional: true, timeoutSeconds,
      accept: 'application/vnd.github.raw+json', range: `bytes=0-${README_PREFIX_BYTES - 1}` });
    let readme = null;
    if (readmeResponse !== null) {
      const prefix = await readResponsePrefix(readmeResponse);
      readme = {
        canonicalUri: `https://api.github.com${readmePath}`,
        path: readmeFilename(readmeResponse),
        text: new TextDecoder('utf-8', { fatal: false }).decode(prefix.bytes)
          .replace(/\u0000/gu, '').slice(0, README_TEXT_CHARS),
        truncated: prefix.truncated,
      };
    }
    const output = {
      schemaVersion: 'github-repository-evidence-v1',
      repository: { key: locator.key, canonicalUrl: locator.canonicalUrl, owner: locator.owner, name: locator.repository },
      sourceVersion: {
        revision,
        canonicalUri: `${locator.canonicalUrl}/tree/${revision}`,
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
      receiptId: `github:${locator.key}@${revision}`,
      output,
      responseRef: {
        sourceType: 'github.repository', canonicalUri: output.sourceVersion.canonicalUri,
        revision, contentSha256: output.sourceVersion.contentSha256,
      },
      usage: { toolCalls: 1, networkRequests: 3 },
    };
  };
}
