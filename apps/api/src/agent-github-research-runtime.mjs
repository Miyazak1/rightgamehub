const TOKEN_MIN_LENGTH = 20;
const TOKEN_MAX_LENGTH = 255;
const MAX_SEARCH_REQUESTS = 3;
const MAX_CANDIDATES = 5;
const MAX_MATERIAL_REQUESTS_PER_REPOSITORY = 8;

export const AGENT_GITHUB_RESEARCH_LIMITS = Object.freeze({
  maxSearchRequests: MAX_SEARCH_REQUESTS,
  maxCandidates: MAX_CANDIDATES,
  maxMaterialRequestsPerRepository: MAX_MATERIAL_REQUESTS_PER_REPOSITORY,
  requestBudgetPerRun: MAX_SEARCH_REQUESTS
    + (MAX_CANDIDATES * MAX_MATERIAL_REQUESTS_PER_REPOSITORY),
});

export class AgentGitHubResearchRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentGitHubResearchRuntimeError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentGitHubResearchRuntimeError(code); };

export function normalizeGitHubResearchToken(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') fail('AGENT_GITHUB_RESEARCH_TOKEN_INVALID');
  const token = value.trim();
  if (token !== value || token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH
    || /[\s\u0000-\u001f\u007f]/u.test(token)) {
    fail('AGENT_GITHUB_RESEARCH_TOKEN_INVALID');
  }
  return token;
}

export function githubRequestHeaders({ accept, range = null, userAgent, token = null }) {
  const normalizedToken = normalizeGitHubResearchToken(token);
  return {
    accept,
    ...(range ? { range } : {}),
    ...(normalizedToken ? { authorization: `Bearer ${normalizedToken}` } : {}),
    'user-agent': userAgent,
    'x-github-api-version': '2022-11-28',
  };
}

const boundedBackoff = value => Math.max(1, Math.min(3600, Math.ceil(value)));

export function githubRateLimitBackoffSeconds(response, now = Date.now()) {
  if (!response?.headers) return null;
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfterSeconds = retryAfterHeader == null ? Number.NaN : Number(retryAfterHeader);
  const retryAfterDate = retryAfterHeader == null ? Number.NaN : Date.parse(retryAfterHeader);
  const remaining = response.headers.get('x-ratelimit-remaining');
  const resetEpochSeconds = Number(response.headers.get('x-ratelimit-reset'));
  const rateLimited = response.status === 429 || (response.status === 403
    && (remaining === '0' || retryAfterHeader !== null));
  if (!rateLimited) return null;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return boundedBackoff(retryAfterSeconds || 1);
  }
  if (Number.isFinite(retryAfterDate)) return boundedBackoff((retryAfterDate - now) / 1000);
  if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
    return boundedBackoff(resetEpochSeconds - (now / 1000));
  }
  return 60;
}
