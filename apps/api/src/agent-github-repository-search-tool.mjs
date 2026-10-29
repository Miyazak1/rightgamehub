import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { githubRateLimitBackoffSeconds, githubRequestHeaders,
  normalizeGitHubResearchToken } from './agent-github-research-runtime.mjs';

const MAX_RESPONSE_BYTES = 262144;
const QUERY = /^[\p{L}\p{N} ._+#-]{2,120}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export const GITHUB_REPOSITORY_SEARCH_TOOL = Object.freeze({
  toolKey: 'research.github.repository.search',
  contractVersion: 1,
  status: 'active',
  capabilityKey: 'research.github.discover',
  riskLevel: 'L1',
  executionClass: 'remote',
  effectClass: 'read-only',
  inputSchema: { key: 'github.repository.search.input', version: 1 },
  outputSchema: { key: 'github.repository.search.output', version: 1 },
  networkPolicy: { allowedOrigins: ['https://api.github.com'], redirects: 'deny', authentication: 'none' },
  filesystemPolicy: { read: false, write: false },
  timeoutSeconds: 30,
  outputLimitBytes: 131072,
});

export class AgentGitHubRepositorySearchToolError extends Error {
  constructor(code, { retryable = false, notDispatched = false, backoffSeconds = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentGitHubRepositorySearchToolError';
    this.code = code;
    this.retryable = retryable;
    this.notDispatched = notDispatched;
    this.backoffSeconds = backoffSeconds;
  }
}

const fail = (code, options) => { throw new AgentGitHubRepositorySearchToolError(code, options); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isoDay = value => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) fail('AGENT_GITHUB_SEARCH_INPUT_INVALID', { notDispatched: true });
  return value;
};

export function validateGitHubRepositorySearchInput(value) {
  const keys = ['query', 'limit', 'sort', 'minStars', 'pushedAfter'];
  if (!exact(value, keys) || typeof value.query !== 'string') {
    fail('AGENT_GITHUB_SEARCH_INPUT_INVALID', { notDispatched: true });
  }
  if (/[\r\n\t]/u.test(value.query)) fail('AGENT_GITHUB_SEARCH_INPUT_INVALID', { notDispatched: true });
  const query = value.query.replace(/\s+/gu, ' ').trim();
  if (!QUERY.test(query) || query.includes(':') || !integer(value.limit, 1, 20)
    || !['stars', 'updated'].includes(value.sort) || !integer(value.minStars, 0, 10_000_000)) {
    fail('AGENT_GITHUB_SEARCH_INPUT_INVALID', { notDispatched: true });
  }
  return { query, limit: value.limit, sort: value.sort, minStars: value.minStars, pushedAfter: isoDay(value.pushedAfter) };
}

function validCandidate(value) {
  const keys = ['key', 'canonicalUrl', 'owner', 'name', 'description', 'stars', 'forks', 'language',
    'topics', 'licenseSpdx', 'pushedAt'];
  return exact(value, keys) && typeof value.key === 'string' && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(value.key)
    && typeof value.canonicalUrl === 'string' && value.canonicalUrl.startsWith('https://github.com/')
    && typeof value.owner === 'string' && typeof value.name === 'string'
    && (value.description === null || typeof value.description === 'string')
    && integer(value.stars, 0, Number.MAX_SAFE_INTEGER) && integer(value.forks, 0, Number.MAX_SAFE_INTEGER)
    && (value.language === null || typeof value.language === 'string') && Array.isArray(value.topics)
    && value.topics.length <= 20 && value.topics.every(item => typeof item === 'string')
    && (value.licenseSpdx === null || typeof value.licenseSpdx === 'string')
    && (value.pushedAt === null || (typeof value.pushedAt === 'string' && !Number.isNaN(Date.parse(value.pushedAt))));
}

export function validateGitHubRepositorySearchOutput(value) {
  if (!exact(value, ['schemaVersion', 'query', 'source', 'candidates'])
    || value.schemaVersion !== 'github-repository-search-v1'
    || !exact(value.query, ['text', 'sort', 'minStars', 'pushedAfter'])
    || typeof value.query.text !== 'string' || !['stars', 'updated'].includes(value.query.sort)
    || !integer(value.query.minStars, 0, 10_000_000)
    || (value.query.pushedAfter !== null && typeof value.query.pushedAfter !== 'string')
    || !exact(value.source, ['canonicalUri', 'fetchedAt', 'contentSha256'])
    || typeof value.source.canonicalUri !== 'string' || !value.source.canonicalUri.startsWith('https://api.github.com/search/repositories?')
    || typeof value.source.fetchedAt !== 'string' || Number.isNaN(Date.parse(value.source.fetchedAt))
    || typeof value.source.contentSha256 !== 'string' || !SHA256.test(value.source.contentSha256)
    || !Array.isArray(value.candidates) || value.candidates.length > 20
    || value.candidates.some(candidate => !validCandidate(candidate))
    || new Set(value.candidates.map(candidate => candidate.key)).size !== value.candidates.length) {
    fail('AGENT_GITHUB_SEARCH_OUTPUT_INVALID');
  }
  return structuredClone(value);
}

async function readResponse(response) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) fail('AGENT_GITHUB_SEARCH_RESPONSE_TOO_LARGE');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) fail('AGENT_GITHUB_SEARCH_RESPONSE_TOO_LARGE');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createGitHubRepositorySearchAdapter({ fetchImpl = globalThis.fetch,
  userAgent = 'GameHub-Agent-Discovery/1.0', token = null } = {}) {
  if (typeof fetchImpl !== 'function') fail('AGENT_GITHUB_SEARCH_FETCH_REQUIRED', { notDispatched: true });
  const researchToken = normalizeGitHubResearchToken(token);
  return async ({ request: raw, timeoutSeconds = 30 }) => {
    const input = validateGitHubRepositorySearchInput(raw);
    const search = `${input.query} archived:false fork:false stars:>=${input.minStars}`
      + (input.pushedAfter ? ` pushed:>=${input.pushedAfter}` : '');
    const params = new URLSearchParams({ q: search, sort: input.sort, order: 'desc', per_page: String(input.limit) });
    const canonicalUri = `https://api.github.com/search/repositories?${params.toString()}`;
    let response;
    try {
      response = await fetchImpl(canonicalUri, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutSeconds * 1000),
        headers: githubRequestHeaders({ accept: 'application/vnd.github+json', userAgent, token: researchToken }),
      });
    } catch (error) {
      fail('AGENT_GITHUB_SEARCH_NETWORK_FAILED', { retryable: true, cause: error });
    }
    if (!response.ok) {
      const backoffSeconds = githubRateLimitBackoffSeconds(response);
      fail(backoffSeconds == null ? 'AGENT_GITHUB_SEARCH_UPSTREAM_FAILED' : 'AGENT_GITHUB_RATE_LIMITED', {
        retryable: backoffSeconds != null || response.status >= 500, backoffSeconds,
      });
    }
    let payload;
    try { payload = JSON.parse(await readResponse(response)); }
    catch (error) { fail('AGENT_GITHUB_SEARCH_RESPONSE_INVALID', { cause: error }); }
    if (!Array.isArray(payload?.items)) fail('AGENT_GITHUB_SEARCH_RESPONSE_INVALID');
    const candidates = payload.items.slice(0, input.limit).map(item => {
      const owner = String(item?.owner?.login ?? '').slice(0, 100);
      const name = String(item?.name ?? '').slice(0, 100);
      if (!owner || !name || item?.archived === true || item?.fork === true) return null;
      return {
        key: `${owner}/${name}`.toLowerCase(), canonicalUrl: `https://github.com/${owner}/${name}`,
        owner, name, description: item.description == null ? null : String(item.description).slice(0, 1000),
        stars: Math.max(0, Number.isSafeInteger(item.stargazers_count) ? item.stargazers_count : 0),
        forks: Math.max(0, Number.isSafeInteger(item.forks_count) ? item.forks_count : 0),
        language: item.language == null ? null : String(item.language).slice(0, 80),
        topics: Array.isArray(item.topics) ? item.topics.filter(topic => typeof topic === 'string').slice(0, 20) : [],
        licenseSpdx: typeof item.license?.spdx_id === 'string' ? item.license.spdx_id.slice(0, 80) : null,
        pushedAt: typeof item.pushed_at === 'string' && !Number.isNaN(Date.parse(item.pushed_at)) ? item.pushed_at : null,
      };
    }).filter(Boolean);
    const unique = [...new Map(candidates.map(candidate => [candidate.key, candidate])).values()];
    const contentSha256 = stableHash(unique);
    const output = {
      schemaVersion: 'github-repository-search-v1',
      query: { text: input.query, sort: input.sort, minStars: input.minStars, pushedAfter: input.pushedAfter },
      source: { canonicalUri, fetchedAt: new Date().toISOString(), contentSha256 },
      candidates: unique,
    };
    validateGitHubRepositorySearchOutput(output);
    return { receiptId: `github-search:${stableHash({ input, contentSha256 })}`, output,
      responseRef: { sourceType: 'github.repository-search', canonicalUri, contentSha256 },
      usage: { toolCalls: 1, networkRequests: 1, candidates: unique.length } };
  };
}
