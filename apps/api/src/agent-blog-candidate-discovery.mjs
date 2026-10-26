import { BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { normalizeGitHubRepositoryLocator } from './agent-github-repository-tool.mjs';
import { validateGitHubRepositorySearchInput, validateGitHubRepositorySearchOutput } from './agent-github-repository-search-tool.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

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
      const searched = prerequisite(context, 'search-candidates');
      const artifactIds = searched.artifactIds;
      if (searched.schemaVersion !== 'blog-discovery-search-set-ref-v1' || !Array.isArray(artifactIds)
        || artifactIds.length !== input.queries.length || new Set(artifactIds).size !== artifactIds.length) {
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
      const candidates = [...merged.values()]
        .sort((left, right) => Number(left.previouslyPublished) - Number(right.previouslyPublished)
          || left.bestSearchRank - right.bestSearchRank || right.stars - left.stars || left.key.localeCompare(right.key))
        .slice(0, input.maxCandidates)
        .map((candidate, index) => ({ discoveryRank: index + 1, ...candidate }));
      if (!candidates.length) fail('AGENT_BLOG_DISCOVERY_EMPTY');
      const content = { schemaVersion: 'blog-candidate-set-v1', topicScope: input.topicScope,
        queryPolicy: { queries: input.queries, sort: input.sort, minStars: input.minStars,
          pushedAfter: input.pushedAfter }, candidates };
      const artifact = await artifactRepository.save({
        runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
        leaseToken: execution.leaseToken, artifactKey: 'blog.candidate-set', artifactKind: 'validated-output',
        schema: { key: 'blog.candidate.discovery', version: 1 }, content,
        sourceToolArtifactIds: artifactIds,
      });
      return { outputRef: { artifactId: artifact.id, artifactKey: artifact.artifactKey,
        contentSha256: artifact.contentSha256, candidateCount: candidates.length },
      runOutput: { type: 'blog.candidate-set', id: artifact.id } };
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
