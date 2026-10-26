import { normalizeAgentBehaviorProfile } from './agent-behavior-profile.mjs';
import { BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,
  BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { normalizeGitHubRepositoryLocator } from './agent-github-repository-tool.mjs';
import { validateGitHubRepositorySearchInput, validateGitHubRepositorySearchOutput } from './agent-github-repository-search-tool.mjs';
import { parseWholeJson } from './researcher-qa-protocol/model-json.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export const BLOG_DISCOVERY_QUERY_PLAN_SCHEMA = Object.freeze({ key: 'blog.discovery.query-plan', version: 1 });
export const BLOG_DISCOVERY_QUERY_PLAN_PROMPT = `你是小墨鱼的候选发现规划模块。只输出一个 JSON 对象，不要输出 Markdown。
你的任务只是把中文选题范围规划成一至五条 GitHub 仓库搜索词，不得选择项目、写文章或声称任何项目事实。
搜索词只能包含普通文字、数字、空格、点、下划线、加号、井号和连字符；不得包含 URL、斜杠、冒号或 GitHub 搜索限定符。
人格兴趣只用于决定搜索方向，不是事实证据。不得规划时政、敏感或高风险主题。
返回字段必须且只能是 queries、rationale、interestSignals。`;

export class AgentBlogCandidateDiscoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogCandidateDiscoveryError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogCandidateDiscoveryError(code); };
const compact = (value, max) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));

function repositoryList(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 500) fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  let result;
  try { result = value.map(item => normalizeGitHubRepositoryLocator(item).canonicalUrl); }
  catch { fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID'); }
  if (new Set(result.map(item => item.toLowerCase())).size !== result.length) fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  return result;
}

export function normalizeBlogCandidateDiscoveryInput(value) {
  const keys = ['schemaVersion', 'topicScope', 'queries', 'sort', 'minStars', 'pushedAfter',
    'maxCandidates', 'previousRepositoryUrls'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || value.schemaVersion !== 'blog-project-discovery-input-v1') fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  const topicScope = compact(value.topicScope, 2000);
  if (topicScope.length < 2 || !Array.isArray(value.queries) || value.queries.length < 1 || value.queries.length > 5
    || !Number.isSafeInteger(value.maxCandidates) || value.maxCandidates < 1 || value.maxCandidates > 12) {
    fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  }
  const searches = value.queries.map(query => {
    try {
      return validateGitHubRepositorySearchInput({ query, limit: 20, sort: value.sort,
        minStars: value.minStars, pushedAfter: value.pushedAfter });
    } catch { fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID'); }
  });
  if (new Set(searches.map(item => item.query.toLocaleLowerCase('en-US'))).size !== searches.length) {
    fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  }
  return {
    schemaVersion: value.schemaVersion, topicScope, queries: searches.map(item => item.query),
    sort: searches[0].sort, minStars: searches[0].minStars, pushedAfter: searches[0].pushedAfter,
    maxCandidates: value.maxCandidates, previousRepositoryUrls: repositoryList(value.previousRepositoryUrls),
  };
}

export function normalizeAutonomousBlogCandidateDiscoveryInput(value) {
  const keys = ['schemaVersion', 'topicScope', 'searchPolicy', 'previousRepositoryUrls', 'behaviorProfile'];
  const policyKeys = ['sort', 'minStars', 'pushedAfter', 'maxCandidates', 'maxQueries'];
  if (!exact(value, keys) || value.schemaVersion !== 'blog-project-discovery-input-v2'
    || !exact(value.searchPolicy, policyKeys)) fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  const topicScope = compact(value.topicScope, 2000);
  const policy = value.searchPolicy;
  if (topicScope.length < 2 || !Number.isSafeInteger(policy.maxCandidates) || policy.maxCandidates < 1
    || policy.maxCandidates > 12 || !Number.isSafeInteger(policy.maxQueries)
    || policy.maxQueries < 1 || policy.maxQueries > 5) fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  let normalizedPolicy;
  let behaviorProfile;
  try {
    const validated = validateGitHubRepositorySearchInput({ query: 'repository discovery', limit: 20,
      sort: policy.sort, minStars: policy.minStars, pushedAfter: policy.pushedAfter });
    normalizedPolicy = { sort: validated.sort, minStars: validated.minStars,
      pushedAfter: validated.pushedAfter, maxCandidates: policy.maxCandidates, maxQueries: policy.maxQueries };
    behaviorProfile = normalizeAgentBehaviorProfile(value.behaviorProfile);
  } catch { fail('AGENT_BLOG_DISCOVERY_INPUT_INVALID'); }
  return { schemaVersion: value.schemaVersion, topicScope, searchPolicy: normalizedPolicy,
    previousRepositoryUrls: repositoryList(value.previousRepositoryUrls), behaviorProfile };
}

export function validateBlogDiscoveryQueryPlanResponse(value) {
  if (typeof value === 'string') {
    if (!value.trim() || Buffer.byteLength(value) > 65536) fail('AGENT_BLOG_DISCOVERY_PLAN_OUTPUT_INVALID');
    try { value = parseWholeJson(value.trim()); } catch { fail('AGENT_BLOG_DISCOVERY_PLAN_OUTPUT_INVALID'); }
  }
  if (!exact(value, ['queries', 'rationale', 'interestSignals']) || !Array.isArray(value.queries)
    || !Array.isArray(value.interestSignals) || typeof value.rationale !== 'string') {
    fail('AGENT_BLOG_DISCOVERY_PLAN_OUTPUT_INVALID');
  }
  return structuredClone(value);
}

export const BLOG_DISCOVERY_RESPONSE_SCHEMAS = Object.freeze({
  [`${BLOG_DISCOVERY_QUERY_PLAN_SCHEMA.key}@${BLOG_DISCOVERY_QUERY_PLAN_SCHEMA.version}`]:
    validateBlogDiscoveryQueryPlanResponse,
});

function prerequisite(context, stageKey) {
  const stage = context.prerequisites.find(item => item.stageKey === stageKey && item.status === 'succeeded');
  if (!stage) fail('AGENT_BLOG_DISCOVERY_PREREQUISITE_INVALID');
  return stage.outputRef ?? {};
}

function artifactId(result) {
  const id = result?.artifactId ?? result?.responseRef?.artifactId;
  if (typeof id !== 'string') fail('AGENT_BLOG_DISCOVERY_TOOL_ARTIFACT_MISSING');
  return id;
}

function previousKeys(urls) {
  return new Set(urls.map(url => normalizeGitHubRepositoryLocator(url).key));
}

function modelPolicy(context) {
  const config = context.run.configSnapshot?.model ?? {};
  return { taskClass: 'structured-generation', requiresJsonSchema: true,
    maxInputTokens: 10000, maxOutputTokens: 1200, maxCostMicrousd: 10_000_000, latencyClass: 'batch',
    ...(typeof config.provider === 'string' ? { preferredProvider: config.provider } : {}),
    ...(typeof config.modelId === 'string' ? { preferredModel: config.modelId } : {}) };
}

function normalizeQueryPlan(output, input) {
  const maxQueries = input.searchPolicy.maxQueries;
  if (output.queries.length < 1 || output.queries.length > maxQueries
    || output.interestSignals.length < 1 || output.interestSignals.length > 6) {
    fail('AGENT_BLOG_DISCOVERY_PLAN_INVALID');
  }
  const searches = output.queries.map(query => {
    try { return validateGitHubRepositorySearchInput({ query, limit: 20,
      sort: input.searchPolicy.sort, minStars: input.searchPolicy.minStars,
      pushedAfter: input.searchPolicy.pushedAfter }); }
    catch { fail('AGENT_BLOG_DISCOVERY_PLAN_INVALID'); }
  });
  const queries = searches.map(item => item.query);
  if (new Set(queries.map(item => item.toLocaleLowerCase('en-US'))).size !== queries.length) {
    fail('AGENT_BLOG_DISCOVERY_PLAN_INVALID');
  }
  const configured = new Set(input.behaviorProfile.modules.editorial.interestSignals);
  const interestSignals = output.interestSignals.map(item => compact(item, 80));
  const rationale = compact(output.rationale, 500);
  if (rationale.length < 30 || interestSignals.some(item => item.length < 2 || !configured.has(item))) {
    fail('AGENT_BLOG_DISCOVERY_PLAN_INVALID');
  }
  return { queries, rationale, interestSignals };
}

async function finalizeCandidateSet({ context, execution, artifactRepository, input, queries,
  planArtifactId = null }) {
  const searched = prerequisite(context, 'search-candidates');
  const artifactIds = searched.artifactIds;
  if (searched.schemaVersion !== 'blog-discovery-search-set-ref-v1' || !Array.isArray(artifactIds)
    || artifactIds.length !== queries.length || new Set(artifactIds).size !== artifactIds.length) {
    fail('AGENT_BLOG_DISCOVERY_SEARCH_SET_INVALID');
  }
  const artifacts = await Promise.all(artifactIds.map(id => artifactRepository.readToolArtifact({
    runId: context.run.id, artifactId: id,
  })));
  const prior = previousKeys(input.previousRepositoryUrls);
  const merged = new Map();
  for (const artifact of artifacts) {
    let result;
    try { result = validateGitHubRepositorySearchOutput(artifact.content); }
    catch { fail('AGENT_BLOG_DISCOVERY_SEARCH_OUTPUT_INVALID'); }
    if (!queries.includes(result.query.text)) fail('AGENT_BLOG_DISCOVERY_SEARCH_OUTPUT_INVALID');
    for (const [rank, candidate] of result.candidates.entries()) {
      const existing = merged.get(candidate.key);
      if (existing) {
        if (!existing.matchedQueries.includes(result.query.text)) existing.matchedQueries.push(result.query.text);
        existing.bestSearchRank = Math.min(existing.bestSearchRank, rank + 1);
        continue;
      }
      merged.set(candidate.key, { ...candidate, matchedQueries: [result.query.text],
        bestSearchRank: rank + 1, previouslyPublished: prior.has(candidate.key) });
    }
  }
  const maxCandidates = input.maxCandidates ?? input.searchPolicy.maxCandidates;
  const candidates = [...merged.values()]
    .sort((left, right) => Number(left.previouslyPublished) - Number(right.previouslyPublished)
      || left.bestSearchRank - right.bestSearchRank || right.stars - left.stars || left.key.localeCompare(right.key))
    .slice(0, maxCandidates)
    .map((candidate, index) => ({ discoveryRank: index + 1, ...candidate }));
  if (!candidates.length) fail('AGENT_BLOG_DISCOVERY_EMPTY');
  const searchPolicy = input.searchPolicy ?? input;
  const content = { schemaVersion: 'blog-candidate-set-v1', topicScope: input.topicScope,
    queryPolicy: { queries, sort: searchPolicy.sort, minStars: searchPolicy.minStars,
      pushedAfter: searchPolicy.pushedAfter }, candidates };
  const artifact = await artifactRepository.save({
    runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
    leaseToken: execution.leaseToken, artifactKey: 'blog.candidate-set', artifactKind: 'validated-output',
    schema: { key: 'blog.candidate.discovery', version: 1 }, content,
    sourceToolArtifactIds: artifactIds, sourceStageArtifactIds: planArtifactId ? [planArtifactId] : [],
  });
  return { outputRef: { artifactId: artifact.id, artifactKey: artifact.artifactKey,
    contentSha256: artifact.contentSha256, candidateCount: candidates.length },
  runOutput: { type: 'blog.candidate-set', id: artifact.id } };
}

export function createAgentBlogCandidateDiscoveryHandlers({ toolGateway, artifactRepository } = {}) {
  if (!toolGateway || !artifactRepository) fail('AGENT_BLOG_DISCOVERY_DEPENDENCY_REQUIRED');
  const workflow = BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW.workflowKey;
  return {
    [`${workflow}:freeze-brief`]: async context => {
      const input = normalizeBlogCandidateDiscoveryInput(context.run.input);
      if (stableHash(context.run.input) !== context.run.inputSha256) fail('AGENT_BLOG_DISCOVERY_INPUT_HASH_MISMATCH');
      return { outputRef: { schemaVersion: 'blog-discovery-brief-ref-v1', inputSha256: context.run.inputSha256,
        queryCount: input.queries.length, querySetSha256: stableHash(input.queries) } };
    },

    [`${workflow}:search-candidates`]: async (context, execution) => {
      const input = normalizeBlogCandidateDiscoveryInput(context.run.input);
      const frozen = prerequisite(context, 'freeze-brief');
      if (frozen.schemaVersion !== 'blog-discovery-brief-ref-v1' || frozen.inputSha256 !== context.run.inputSha256
        || frozen.queryCount !== input.queries.length || frozen.querySetSha256 !== stableHash(input.queries)) {
        fail('AGENT_BLOG_DISCOVERY_FROZEN_INPUT_INVALID');
      }
      const artifactIds = [];
      for (const [index, query] of input.queries.entries()) {
        const ordinal = String(index + 1).padStart(2, '0');
        const result = await toolGateway.invoke({
          runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
          leaseToken: execution.leaseToken,
          action: { actionKey: `search-repositories-${ordinal}`, actionKind: 'tool',
            capabilityKey: 'research.github.discover', contractVersion: 1, riskLevel: 'L1' },
          idempotencyKey: `blog-discovery:${context.run.id}:${ordinal}`,
          resource: { type: 'github.repository-search', owner: 'public', id: stableHash({ query }).slice(0, 24) },
          tool: { toolKey: 'research.github.repository.search', contractVersion: 1 },
          request: { query, limit: 20, sort: input.sort, minStars: input.minStars, pushedAfter: input.pushedAfter },
        });
        if (result.status !== 'succeeded') fail('AGENT_BLOG_DISCOVERY_TOOL_INCOMPLETE');
        artifactIds.push(artifactId(result));
      }
      return { outputRef: { schemaVersion: 'blog-discovery-search-set-ref-v1', artifactIds,
        queryCount: input.queries.length } };
    },

    [`${workflow}:finalize-candidates`]: async (context, execution) => {
      const input = normalizeBlogCandidateDiscoveryInput(context.run.input);
      return finalizeCandidateSet({ context, execution, artifactRepository, input, queries: input.queries });
    },
  };
}

export function createAgentBlogAutonomousCandidateDiscoveryHandlers({
  providerGateway, toolGateway, artifactRepository,
} = {}) {
  if (!providerGateway || !toolGateway || !artifactRepository) fail('AGENT_BLOG_DISCOVERY_DEPENDENCY_REQUIRED');
  const workflow = BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW.workflowKey;
  return {
    [`${workflow}:freeze-brief`]: async context => {
      const input = normalizeAutonomousBlogCandidateDiscoveryInput(context.run.input);
      if (stableHash(context.run.input) !== context.run.inputSha256) fail('AGENT_BLOG_DISCOVERY_INPUT_HASH_MISMATCH');
      return { outputRef: { schemaVersion: 'blog-autonomous-discovery-brief-ref-v1',
        inputSha256: context.run.inputSha256, profileSha256: stableHash(input.behaviorProfile),
        searchPolicySha256: stableHash(input.searchPolicy) } };
    },

    [`${workflow}:plan-queries`]: async (context, execution) => {
      const input = normalizeAutonomousBlogCandidateDiscoveryInput(context.run.input);
      const frozen = prerequisite(context, 'freeze-brief');
      if (frozen.schemaVersion !== 'blog-autonomous-discovery-brief-ref-v1'
        || frozen.inputSha256 !== context.run.inputSha256
        || frozen.profileSha256 !== stableHash(input.behaviorProfile)
        || frozen.searchPolicySha256 !== stableHash(input.searchPolicy)) {
        fail('AGENT_BLOG_DISCOVERY_FROZEN_INPUT_INVALID');
      }
      const request = { topicScope: input.topicScope, maxQueries: input.searchPolicy.maxQueries,
        agentBehavior: input.behaviorProfile, allowedInterestSignals: input.behaviorProfile.modules.editorial.interestSignals };
      const result = await providerGateway.invoke({
        runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
        leaseToken: execution.leaseToken,
        action: { actionKey: 'plan-queries', actionKind: 'provider',
          capabilityKey: 'provider.text.generate', contractVersion: 1, riskLevel: 'L2' },
        idempotencyKey: `blog-discovery-plan:${context.run.id}`,
        resource: { type: 'provider.model', owner: context.run.agentUserId },
        modelPolicy: modelPolicy(context), promptTemplate: { key: 'blog.discovery.plan', version: 1 },
        responseSchema: BLOG_DISCOVERY_QUERY_PLAN_SCHEMA,
        request: { messages: [{ role: 'system', content: BLOG_DISCOVERY_QUERY_PLAN_PROMPT },
          { role: 'user', content: JSON.stringify(request) }], temperature: 0.2 },
        tokenCeiling: 1200, timeoutSeconds: 150,
        estimatedInputTokens: Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 3)),
      });
      const plan = normalizeQueryPlan(result.output, input);
      const artifact = await artifactRepository.save({
        runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
        leaseToken: execution.leaseToken, actionId: result.actionId,
        artifactKey: 'blog.discovery-plan', artifactKind: 'validated-output',
        schema: BLOG_DISCOVERY_QUERY_PLAN_SCHEMA,
        content: { schemaVersion: 'blog-discovery-query-plan-v1', ...plan },
      });
      return { outputRef: { artifactId: artifact.id, artifactKey: artifact.artifactKey,
        contentSha256: artifact.contentSha256, queryCount: plan.queries.length } };
    },

    [`${workflow}:search-candidates`]: async (context, execution) => {
      const input = normalizeAutonomousBlogCandidateDiscoveryInput(context.run.input);
      const planned = prerequisite(context, 'plan-queries');
      if (planned.artifactKey !== 'blog.discovery-plan' || typeof planned.artifactId !== 'string') {
        fail('AGENT_BLOG_DISCOVERY_PLAN_ARTIFACT_INVALID');
      }
      const artifact = await artifactRepository.read({ runId: context.run.id,
        artifactId: planned.artifactId, expectedArtifactKey: 'blog.discovery-plan' });
      if (artifact.content?.schemaVersion !== 'blog-discovery-query-plan-v1'
        || artifact.contentSha256 !== planned.contentSha256) fail('AGENT_BLOG_DISCOVERY_PLAN_ARTIFACT_INVALID');
      const plan = normalizeQueryPlan(artifact.content, input);
      const artifactIds = [];
      for (const [index, query] of plan.queries.entries()) {
        const ordinal = String(index + 1).padStart(2, '0');
        const result = await toolGateway.invoke({
          runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
          leaseToken: execution.leaseToken,
          action: { actionKey: `search-repositories-${ordinal}`, actionKind: 'tool',
            capabilityKey: 'research.github.discover', contractVersion: 1, riskLevel: 'L1' },
          idempotencyKey: `blog-discovery:${context.run.id}:${ordinal}`,
          resource: { type: 'github.repository-search', owner: 'public', id: stableHash({ query }).slice(0, 24) },
          tool: { toolKey: 'research.github.repository.search', contractVersion: 1 },
          request: { query, limit: 20, sort: input.searchPolicy.sort,
            minStars: input.searchPolicy.minStars, pushedAfter: input.searchPolicy.pushedAfter },
        });
        if (result.status !== 'succeeded') fail('AGENT_BLOG_DISCOVERY_TOOL_INCOMPLETE');
        artifactIds.push(artifactId(result));
      }
      return { outputRef: { schemaVersion: 'blog-discovery-search-set-ref-v1', artifactIds,
        queryCount: plan.queries.length, planArtifactId: artifact.id } };
    },

    [`${workflow}:finalize-candidates`]: async (context, execution) => {
      const input = normalizeAutonomousBlogCandidateDiscoveryInput(context.run.input);
      const searched = prerequisite(context, 'search-candidates');
      if (typeof searched.planArtifactId !== 'string') fail('AGENT_BLOG_DISCOVERY_PLAN_ARTIFACT_INVALID');
      const planArtifact = await artifactRepository.read({ runId: context.run.id,
        artifactId: searched.planArtifactId, expectedArtifactKey: 'blog.discovery-plan' });
      const plan = normalizeQueryPlan(planArtifact.content, input);
      return finalizeCandidateSet({ context, execution, artifactRepository, input,
        queries: plan.queries, planArtifactId: planArtifact.id });
    },
  };
}

export function createAgentBlogAutonomousDiscoveryCanary({ runtimeRepository, enabled = false } = {}) {
  if (!runtimeRepository) fail('AGENT_BLOG_DISCOVERY_RUNTIME_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail('AGENT_BLOG_DISCOVERY_CANARY_DISABLED'); };
  const workflow = BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW;
  return {
    async register(actorUserId) {
      requireEnabled();
      const registered = await runtimeRepository.registerWorkflow({ actorUserId, manifest: workflow, status: 'draft' });
      if (registered.status === 'draft') await runtimeRepository.activateWorkflow(workflow.workflowKey, workflow.workflowVersion);
      return workflow;
    },
    async createRun({ agentUserId, triggerKind = 'manual', triggerRef = null, idempotencyKey, input, config = {} }) {
      requireEnabled();
      const normalized = normalizeAutonomousBlogCandidateDiscoveryInput(input);
      return runtimeRepository.createRun({ agentUserId, workflowKey: workflow.workflowKey,
        workflowVersion: workflow.workflowVersion, triggerKind, triggerRef, idempotencyKey,
        input: normalized, config, budget: workflow.defaultBudget });
    },
  };
}

export function createAgentBlogCandidateDiscoveryCanary({ runtimeRepository, enabled = false } = {}) {
  if (!runtimeRepository) fail('AGENT_BLOG_DISCOVERY_RUNTIME_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail('AGENT_BLOG_DISCOVERY_CANARY_DISABLED'); };
  return {
    async register(actorUserId) {
      requireEnabled();
      const workflow = BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW;
      const registered = await runtimeRepository.registerWorkflow({ actorUserId, manifest: workflow, status: 'draft' });
      if (registered.status === 'draft') await runtimeRepository.activateWorkflow(workflow.workflowKey, workflow.workflowVersion);
      return workflow;
    },
    async createRun({ agentUserId, triggerKind = 'manual', triggerRef = null, idempotencyKey, input, config = {} }) {
      requireEnabled();
      const normalized = normalizeBlogCandidateDiscoveryInput(input);
      const workflow = BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW;
      return runtimeRepository.createRun({ agentUserId, workflowKey: workflow.workflowKey,
        workflowVersion: workflow.workflowVersion, triggerKind, triggerRef, idempotencyKey,
        input: normalized, config, budget: workflow.defaultBudget });
    },
  };
}
