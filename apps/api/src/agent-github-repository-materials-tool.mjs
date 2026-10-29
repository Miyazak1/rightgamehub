import { normalizeGitHubRepositoryLocator } from './agent-github-repository-tool.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { githubRateLimitBackoffSeconds, githubRequestHeaders,
  normalizeGitHubResearchToken, AGENT_GITHUB_RESEARCH_LIMITS } from './agent-github-research-runtime.mjs';

const MAX_RESPONSE_BYTES = 262144;
const TEXT_PREFIX_BYTES = 49152;
const MATERIAL_TEXT_CHARS = 12000;
const MAX_MATERIALS = 6;

export const GITHUB_REPOSITORY_MATERIALS_TOOL = Object.freeze({
  toolKey: 'research.github.repository.materials.read',
  contractVersion: 1,
  status: 'active',
  capabilityKey: 'research.github.read',
  riskLevel: 'L1',
  executionClass: 'remote',
  effectClass: 'read-only',
  inputSchema: { key: 'github.repository.materials.read.input', version: 1 },
  outputSchema: { key: 'github.repository.materials.read.output', version: 1 },
  networkPolicy: { allowedOrigins: ['https://api.github.com'], redirects: 'deny', authentication: 'none' },
  filesystemPolicy: { read: false, write: false },
  timeoutSeconds: 45,
  outputLimitBytes: 262144,
});

export class AgentGitHubRepositoryMaterialsToolError extends Error {
  constructor(code, { retryable = false, notDispatched = false, backoffSeconds = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentGitHubRepositoryMaterialsToolError';
    this.code = code;
    this.retryable = retryable;
    this.notDispatched = notDispatched;
    this.backoffSeconds = backoffSeconds;
  }
}

const fail = (code, options) => { throw new AgentGitHubRepositoryMaterialsToolError(code, options); };

export function validateGitHubRepositoryMaterialsInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'repository')) {
    fail('AGENT_GITHUB_MATERIALS_INPUT_INVALID', { notDispatched: true });
  }
  return { repository: normalizeGitHubRepositoryLocator(value.repository).canonicalUrl };
}

function validUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['github.com', 'api.github.com'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

function validMaterial(value) {
  const keys = ['type', 'path', 'canonicalUri', 'sourceRevision', 'publishedAt', 'text', 'truncated', 'contentSha256'];
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key))
    && ['readme', 'license', 'documentation', 'release'].includes(value.type)
    && typeof value.path === 'string' && value.path.length >= 1 && value.path.length <= 500
    && !value.path.split('/').some(part => !part || part === '.' || part === '..')
    && validUri(value.canonicalUri)
    && typeof value.sourceRevision === 'string' && value.sourceRevision.length >= 1 && value.sourceRevision.length <= 240
    && (value.publishedAt === null || typeof value.publishedAt === 'string')
    && typeof value.text === 'string' && value.text.length >= 1 && value.text.length <= MATERIAL_TEXT_CHARS
    && typeof value.truncated === 'boolean'
    && typeof value.contentSha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.contentSha256)
    && value.contentSha256 === stableHash(value.text);
}

export function validateGitHubRepositoryMaterialsOutput(value) {
  const required = ['schemaVersion', 'repository', 'sourceVersion', 'metadata', 'materials'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !required.includes(key)) || required.some(key => !Object.hasOwn(value, key))
    || value.schemaVersion !== 'github-repository-materials-v1'
    || typeof value.repository?.canonicalUrl !== 'string' || !validUri(value.repository.canonicalUrl)
    || typeof value.repository?.key !== 'string'
    || typeof value.sourceVersion?.revision !== 'string' || !/^[a-f0-9]{40}$/u.test(value.sourceVersion.revision)
    || typeof value.sourceVersion?.canonicalUri !== 'string' || !validUri(value.sourceVersion.canonicalUri)
    || typeof value.sourceVersion?.fetchedAt !== 'string'
    || typeof value.sourceVersion?.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sourceVersion.contentSha256)
    || typeof value.metadata?.name !== 'string' || typeof value.metadata?.fullName !== 'string'
    || !Number.isSafeInteger(value.metadata?.stars) || value.metadata.stars < 0
    || !Array.isArray(value.materials) || value.materials.length < 1 || value.materials.length > MAX_MATERIALS
    || value.materials.some(item => !validMaterial(item))
    || new Set(value.materials.map(item => `${item.type}:${item.path}`)).size !== value.materials.length
    || value.sourceVersion.contentSha256 !== stableHash({ metadata: value.metadata, materials: value.materials })) {
    fail('AGENT_GITHUB_MATERIALS_OUTPUT_INVALID');
  }
  return structuredClone(value);
}

async function readBytes(response, maxBytes, { truncate = false } = {}) {
  const declaredHeader = response.headers.get('content-length');
  const declared = Number(declaredHeader ?? 0);
  if (!truncate && declaredHeader !== null && declared > maxBytes) fail('AGENT_GITHUB_RESPONSE_TOO_LARGE');
  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!truncate && bytes.byteLength > maxBytes) fail('AGENT_GITHUB_RESPONSE_TOO_LARGE');
    return { bytes: bytes.subarray(0, maxBytes), truncated: bytes.byteLength > maxBytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let truncated = false;
  while (true) {
    let next;
    try { next = await reader.read(); }
    catch (error) { fail('AGENT_GITHUB_NETWORK_FAILED', { retryable: true, cause: error }); }
    if (next.done) break;
    const remaining = maxBytes - length;
    if (next.value.byteLength > remaining) {
      if (!truncate) fail('AGENT_GITHUB_RESPONSE_TOO_LARGE');
      if (remaining > 0) chunks.push(next.value.subarray(0, remaining));
      length = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(next.value);
    length += next.value.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated: truncated || (declaredHeader !== null && declared > length) };
}

async function readResponse(response, maxBytes = MAX_RESPONSE_BYTES) {
  const { bytes } = await readBytes(response, maxBytes);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function readPrefix(response, maxBytes = TEXT_PREFIX_BYTES) {
  const { bytes: prefix, truncated } = await readBytes(response, maxBytes, { truncate: true });
  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(prefix).replace(/\u0000/gu, '').slice(0, MATERIAL_TEXT_CHARS),
    truncated,
  };
}

function encodeRefPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500 || /[\\\u0000-\u001f\u007f]/u.test(value)) {
    fail('AGENT_GITHUB_RESPONSE_INVALID');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail('AGENT_GITHUB_RESPONSE_INVALID');
  return parts.map(encodeURIComponent).join('/');
}

function filename(response, fallback) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/iu)?.[1];
  let value = encoded ?? plain ?? fallback;
  if (encoded) {
    try { value = decodeURIComponent(encoded); } catch { value = fallback; }
  }
  value = String(value).trim().replace(/[\\/]/gu, '-').slice(0, 200);
  return value || fallback;
}

function material({ type, path, canonicalUri, sourceRevision, publishedAt = null, text, truncated = false }) {
  const normalized = String(text ?? '').trim().slice(0, MATERIAL_TEXT_CHARS);
  if (!normalized) return null;
  return { type, path, canonicalUri, sourceRevision, publishedAt,
    text: normalized, truncated, contentSha256: stableHash(normalized) };
}

function documentationCandidates(value) {
  if (!Array.isArray(value)) return [];
  const score = name => /^(readme|index|overview|introduction|getting[-_ ]?started)\.(md|mdx|txt)$/iu.test(name) ? 0
    : /\.(md|mdx|txt)$/iu.test(name) ? 1 : 2;
  return value.filter(item => item?.type === 'file' && typeof item.path === 'string'
      && item.path.startsWith('docs/') && score(item.name ?? '') < 2)
    .sort((left, right) => score(left.name ?? '') - score(right.name ?? '') || left.path.localeCompare(right.path))
    .slice(0, 2);
}

export function createGitHubRepositoryMaterialsAdapter({ fetchImpl = globalThis.fetch,
  userAgent = 'GameHub-Agent-Research/1.0', token = null } = {}) {
  if (typeof fetchImpl !== 'function') fail('AGENT_GITHUB_FETCH_REQUIRED', { notDispatched: true });
  const researchToken = normalizeGitHubResearchToken(token);
  return async ({ request: input, timeoutSeconds = 45 }) => {
    const locator = normalizeGitHubRepositoryLocator(input?.repository);
    const base = `/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repository)}`;
    let networkRequests = 0;
    const request = async (path, { optional = false, accept = 'application/vnd.github+json' } = {}) => {
      if (networkRequests >= AGENT_GITHUB_RESEARCH_LIMITS.maxMaterialRequestsPerRepository) {
        fail('AGENT_GITHUB_REQUEST_BUDGET_EXCEEDED', { notDispatched: true });
      }
      let response;
      try {
        networkRequests += 1;
        response = await fetchImpl(`https://api.github.com${path}`, {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutSeconds * 1000),
          headers: githubRequestHeaders({ accept, range: `bytes=0-${TEXT_PREFIX_BYTES - 1}`,
            userAgent, token: researchToken }),
        });
      } catch (error) { fail('AGENT_GITHUB_NETWORK_FAILED', { retryable: true, cause: error }); }
      if (optional && response.status === 404) return null;
      if (!response.ok) {
        const backoffSeconds = githubRateLimitBackoffSeconds(response);
        fail(response.status === 404 ? 'AGENT_GITHUB_REPOSITORY_NOT_FOUND'
          : backoffSeconds == null ? 'AGENT_GITHUB_UPSTREAM_FAILED' : 'AGENT_GITHUB_RATE_LIMITED',
        { retryable: backoffSeconds != null || response.status >= 500, backoffSeconds });
      }
      return response;
    };

    const metadataResponse = await request(base);
    let metadata;
    try { metadata = JSON.parse(await readResponse(metadataResponse)); }
    catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
    const branch = typeof metadata.default_branch === 'string' && metadata.default_branch ? metadata.default_branch : 'HEAD';
    let reference;
    try { reference = JSON.parse(await readResponse(await request(`${base}/git/ref/heads/${encodeRefPath(branch)}`))); }
    catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
    const revision = reference?.object?.sha;
    if (reference?.object?.type !== 'commit' || typeof revision !== 'string' || !/^[a-f0-9]{40}$/u.test(revision)) {
      fail('AGENT_GITHUB_RESPONSE_INVALID');
    }

    const materials = [];
    const raw = 'application/vnd.github.raw+json';
    const readmePath = `${base}/readme?ref=${encodeURIComponent(revision)}`;
    const readmeResponse = await request(readmePath, { optional: true, accept: raw });
    if (readmeResponse) {
      const content = await readPrefix(readmeResponse);
      const path = filename(readmeResponse, 'README.md');
      const item = material({ type: 'readme', path, sourceRevision: revision, ...content,
        canonicalUri: `${locator.canonicalUrl}/blob/${revision}/${encodeRefPath(path)}` });
      if (item) materials.push(item);
    }

    const licensePath = `${base}/license?ref=${encodeURIComponent(revision)}`;
    const licenseResponse = await request(licensePath, { optional: true, accept: raw });
    if (licenseResponse) {
      const content = await readPrefix(licenseResponse);
      const path = filename(licenseResponse, 'LICENSE');
      const item = material({ type: 'license', path, sourceRevision: revision, ...content,
        canonicalUri: `${locator.canonicalUrl}/blob/${revision}/${encodeRefPath(path)}` });
      if (item) materials.push(item);
    }

    const docsPath = `${base}/contents/docs?ref=${encodeURIComponent(revision)}`;
    const docsResponse = await request(docsPath, { optional: true });
    if (docsResponse) {
      let listing;
      try { listing = JSON.parse(await readResponse(docsResponse)); }
      catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
      for (const entry of documentationCandidates(listing)) {
        const path = encodeRefPath(entry.path);
        const response = await request(`${base}/contents/${path}?ref=${encodeURIComponent(revision)}`, { accept: raw });
        const content = await readPrefix(response);
        const item = material({ type: 'documentation', path: entry.path, sourceRevision: revision, ...content,
          canonicalUri: `${locator.canonicalUrl}/blob/${revision}/${path}` });
        if (item) materials.push(item);
      }
    }

    const releaseResponse = await request(`${base}/releases/latest`, { optional: true });
    if (releaseResponse) {
      let release;
      try { release = JSON.parse(await readResponse(releaseResponse)); }
      catch (error) { fail('AGENT_GITHUB_RESPONSE_INVALID', { cause: error }); }
      const tag = typeof release.tag_name === 'string' && release.tag_name ? release.tag_name.slice(0, 240) : 'latest';
      const text = [release.name, release.tag_name, release.body].filter(item => typeof item === 'string' && item.trim()).join('\n\n');
      const item = material({ type: 'release', path: `releases/${tag}`, sourceRevision: tag,
        publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
        text, truncated: text.length > MATERIAL_TEXT_CHARS,
        canonicalUri: typeof release.html_url === 'string' && validUri(release.html_url)
          ? release.html_url : `${locator.canonicalUrl}/releases/tag/${encodeURIComponent(tag)}` });
      if (item) materials.push(item);
    }
    if (!materials.length) fail('AGENT_GITHUB_MATERIALS_EMPTY');

    const output = {
      schemaVersion: 'github-repository-materials-v1',
      repository: { key: locator.key, canonicalUrl: locator.canonicalUrl, owner: locator.owner, name: locator.repository },
      sourceVersion: { revision, canonicalUri: `${locator.canonicalUrl}/tree/${revision}`,
        fetchedAt: new Date().toISOString(), contentSha256: '' },
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
      materials: materials.slice(0, MAX_MATERIALS),
    };
    output.sourceVersion.contentSha256 = stableHash({ metadata: output.metadata, materials: output.materials });
    validateGitHubRepositoryMaterialsOutput(output);
    return {
      receiptId: `github-materials:${locator.key}@${revision}`,
      output,
      responseRef: { sourceType: 'github.repository.materials', canonicalUri: output.sourceVersion.canonicalUri,
        revision, contentSha256: output.sourceVersion.contentSha256 },
      usage: { toolCalls: 1, networkRequests },
    };
  };
}
