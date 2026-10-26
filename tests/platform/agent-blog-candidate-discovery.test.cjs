const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const uuid = () => crypto.randomUUID();

const input = {
  schemaVersion: 'blog-project-discovery-input-v1',
  topicScope: '发现有趣、有用且证据完整的开源工具',
  queries: ['agent tool', 'open source utility'], sort: 'stars', minStars: 10,
  pushedAfter: '2026-01-01', maxCandidates: 3,
  previousRepositoryUrls: ['https://github.com/old/repeated'],
};

function searchOutput(query, candidates) {
  return { schemaVersion: 'github-repository-search-v1',
    query: { text: query, sort: 'stars', minStars: 10, pushedAfter: '2026-01-01' },
    source: { canonicalUri: `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`,
      fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: 'a'.repeat(64) }, candidates };
}

function candidate(key, stars) {
  const [owner, name] = key.split('/');
  return { key, canonicalUrl: `https://github.com/${owner}/${name}`, owner, name,
    description: 'A useful project', stars, forks: 2, language: 'TypeScript', topics: ['agent'],
    licenseSpdx: 'MIT', pushedAt: '2026-10-25T00:00:00.000Z' };
}

test('candidate discovery freezes plain queries and produces a bounded non-evidence candidate set', async () => {
  const { createAgentBlogCandidateDiscoveryHandlers } = await load('agent-blog-candidate-discovery.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const runId = uuid();
  const calls = [];
  const toolOutputs = new Map();
  const toolGateway = { invoke: async call => {
    calls.push(call);
    const id = uuid();
    const query = call.request.query;
    toolOutputs.set(id, { id, content: searchOutput(query, query === 'agent tool'
      ? [candidate('old/repeated', 1000), candidate('new/useful', 200)]
      : [candidate('new/useful', 200), candidate('another/project', 80)]) });
    return { status: 'succeeded', artifactId: id };
  } };
  let saved = null;
  const artifactRepository = {
    readToolArtifact: async ({ artifactId }) => structuredClone(toolOutputs.get(artifactId)),
    save: async value => {
      saved = structuredClone(value);
      return { id: uuid(), artifactKey: value.artifactKey, contentSha256: 'b'.repeat(64) };
    },
  };
  const handlers = createAgentBlogCandidateDiscoveryHandlers({ toolGateway, artifactRepository });
  const execution = { workerId: 'worker', leaseToken: uuid() };
  const run = { id: runId, agentUserId: uuid(), input: structuredClone(input), inputSha256: stableHash(input) };
  const frozen = await handlers['blog.project.discovery-shadow:freeze-brief']({ run, stage: { id: uuid() }, prerequisites: [] });
  const searched = await handlers['blog.project.discovery-shadow:search-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'freeze-brief', status: 'succeeded', outputRef: frozen.outputRef }] }, execution);
  const finalized = await handlers['blog.project.discovery-shadow:finalize-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'search-candidates', status: 'succeeded', outputRef: searched.outputRef }] }, execution);
  assert.equal(calls.length, 2);
  assert(calls.every(call => call.tool.toolKey === 'research.github.repository.search'
    && call.action.capabilityKey === 'research.github.discover'));
  assert.equal(finalized.runOutput.type, 'blog.candidate-set');
  assert.equal(saved.artifactKey, 'blog.candidate-set');
  assert.deepEqual(saved.sourceToolArtifactIds, searched.outputRef.artifactIds);
  assert.deepEqual(saved.content.candidates.map(item => item.key),
    ['new/useful', 'another/project', 'old/repeated']);
  assert.equal(saved.content.candidates[0].matchedQueries.length, 2);
  assert.equal(saved.content.candidates[2].previouslyPublished, true);
  assert.equal(saved.content.candidates.some(item => Object.hasOwn(item, 'readme')), false);
});

test('candidate discovery is disabled by default and has no provider, draft, or publish authority', async () => {
  const { createAgentBlogCandidateDiscoveryCanary, normalizeBlogCandidateDiscoveryInput } =
    await load('agent-blog-candidate-discovery.mjs');
  const { BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW } = await load('agent-blog-foundation-workflows.mjs');
  const canary = createAgentBlogCandidateDiscoveryCanary({ runtimeRepository: {} });
  await assert.rejects(canary.register(uuid()), error => error.code === 'AGENT_BLOG_DISCOVERY_CANARY_DISABLED');
  assert.deepEqual(BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW.requiredCapabilities,
    [{ key: 'research.github.discover', version: 1 }]);
  assert.equal(BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW.defaultBudget.providerCalls, 0);
  assert.equal(BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW.stages.some(stage => stage.kind === 'provider'
    || stage.kind === 'domain-write' || stage.key.includes('publish')), false);
  assert.throws(() => normalizeBlogCandidateDiscoveryInput({ ...input, queries: ['stars:>100'] }),
    error => error.code === 'AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  assert.throws(() => normalizeBlogCandidateDiscoveryInput({ ...input,
    queries: ['agent tool', 'agent   tool'] }), error => error.code === 'AGENT_BLOG_DISCOVERY_INPUT_INVALID');
});

test('autonomous discovery lets the model plan only bounded queries before governed search', async () => {
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { createAgentBlogAutonomousCandidateDiscoveryHandlers } =
    await load('agent-blog-candidate-discovery.mjs');
  const runId = uuid();
  const autonomousInput = { schemaVersion: 'blog-project-discovery-input-v2',
    topicScope: '发现有趣而有用的开源人工智能工具',
    searchPolicy: { sort: 'stars', minStars: 10, pushedAfter: '2026-01-01', maxCandidates: 4, maxQueries: 3 },
    previousRepositoryUrls: [], behaviorProfile: defaultAgentBehaviorProfile() };
  const stored = new Map();
  const toolOutputs = new Map();
  const providerCalls = [];
  const providerGateway = { invoke: async call => {
    providerCalls.push(call);
    return { status: 'succeeded', actionId: uuid(), output: {
      queries: ['visual ai tool', 'creative agent'],
      rationale: '选题范围强调直观结果和创作空间，因此先搜索可视化人工智能工具，再补充具有创作能力的智能体项目。',
      interestSignals: ['结果直观或可视化', '能够生成或分享作品'],
    } };
  } };
  const toolGateway = { invoke: async call => {
    const id = uuid();
    const candidateKey = call.request.query === 'visual ai tool' ? 'new/visual' : 'new/creative';
    toolOutputs.set(id, { id, content: searchOutput(call.request.query, [candidate(candidateKey, 100)]) });
    return { status: 'succeeded', artifactId: id };
  } };
  const artifactRepository = {
    save: async value => {
      const id = uuid();
      const item = { id, artifactKey: value.artifactKey, contentSha256: stableHash(value.content),
        content: structuredClone(value.content), input: structuredClone(value) };
      stored.set(id, item);
      return item;
    },
    read: async ({ artifactId }) => structuredClone(stored.get(artifactId)),
    readToolArtifact: async ({ artifactId }) => structuredClone(toolOutputs.get(artifactId)),
  };
  const handlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({
    providerGateway, toolGateway, artifactRepository,
  });
  const execution = { workerId: 'worker', leaseToken: uuid() };
  const run = { id: runId, agentUserId: uuid(), configSnapshot: {}, input: autonomousInput,
    inputSha256: stableHash(autonomousInput) };
  const frozen = await handlers['blog.project.discovery-shadow:freeze-brief']({ run, stage: { id: uuid() }, prerequisites: [] });
  const planned = await handlers['blog.project.discovery-shadow:plan-queries']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'freeze-brief', status: 'succeeded', outputRef: frozen.outputRef }] }, execution);
  const searched = await handlers['blog.project.discovery-shadow:search-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'plan-queries', status: 'succeeded', outputRef: planned.outputRef }] }, execution);
  const finalized = await handlers['blog.project.discovery-shadow:finalize-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'search-candidates', status: 'succeeded', outputRef: searched.outputRef }] }, execution);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].action.actionKey, 'plan-queries');
  assert.equal(providerCalls[0].action.capabilityKey, 'provider.text.generate');
  assert.deepEqual(providerCalls[0].promptTemplate, { key: 'blog.discovery.plan', version: 2 });
  assert.equal(searched.outputRef.artifactIds.length, 2);
  const candidateSet = stored.get(finalized.outputRef.artifactId);
  assert.deepEqual(candidateSet.content.queryPolicy.queries, ['visual ai tool', 'creative agent']);
  assert.deepEqual(candidateSet.content.queryPolicy.plannedQueries, ['visual ai tool', 'creative agent']);
  assert.deepEqual(candidateSet.content.queryPolicy.fallbackQueries, []);
  assert.deepEqual(candidateSet.content.queryPolicy.fallbackLineage, []);
  assert.deepEqual(candidateSet.input.sourceStageArtifactIds, [planned.outputRef.artifactId]);
  const planArtifact = stored.get(planned.outputRef.artifactId);
  assert.equal(planArtifact.input.actionId == null, false);
  assert.deepEqual(planArtifact.input.sourceToolArtifactIds, undefined);
});

test('autonomous discovery broadens empty planned searches deterministically and preserves query lineage', async () => {
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { createAgentBlogAutonomousCandidateDiscoveryHandlers } =
    await load('agent-blog-candidate-discovery.mjs');
  const autonomousInput = { schemaVersion: 'blog-project-discovery-input-v2',
    topicScope: '发现有趣而有用的开源人工智能工具',
    searchPolicy: { sort: 'stars', minStars: 10, pushedAfter: '2026-01-01', maxCandidates: 4, maxQueries: 3 },
    previousRepositoryUrls: [], behaviorProfile: defaultAgentBehaviorProfile() };
  const stored = new Map();
  const toolOutputs = new Map();
  const queries = [];
  const providerGateway = { invoke: async () => ({ status: 'succeeded', actionId: uuid(), output: {
    queries: ['visual artificial intelligence', 'creative autonomous agent'],
    rationale: '选题范围强调直观结果与创作空间，因此分别检索可视化智能项目和具有自主创作能力的智能体项目。',
    interestSignals: ['结果直观或可视化', '能够生成或分享作品'],
  } }) };
  const toolGateway = { invoke: async call => {
    queries.push(call.request.query);
    const id = uuid();
    const candidates = call.request.query === 'visual artificial' ? [candidate('new/fallback', 120)] : [];
    toolOutputs.set(id, { id, content: searchOutput(call.request.query, candidates) });
    return { status: 'succeeded', artifactId: id };
  } };
  const artifactRepository = {
    save: async value => {
      const id = uuid();
      const item = { id, artifactKey: value.artifactKey, contentSha256: stableHash(value.content),
        content: structuredClone(value.content), input: structuredClone(value) };
      stored.set(id, item);
      return item;
    },
    read: async ({ artifactId }) => structuredClone(stored.get(artifactId)),
    readToolArtifact: async ({ artifactId }) => structuredClone(toolOutputs.get(artifactId)),
  };
  const handlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({
    providerGateway, toolGateway, artifactRepository,
  });
  const execution = { workerId: 'worker', leaseToken: uuid() };
  const run = { id: uuid(), agentUserId: uuid(), configSnapshot: {}, input: autonomousInput,
    inputSha256: stableHash(autonomousInput) };
  const frozen = await handlers['blog.project.discovery-shadow:freeze-brief']({
    run, stage: { id: uuid() }, prerequisites: [],
  });
  const planned = await handlers['blog.project.discovery-shadow:plan-queries']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'freeze-brief', status: 'succeeded', outputRef: frozen.outputRef }] }, execution);
  const searched = await handlers['blog.project.discovery-shadow:search-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'plan-queries', status: 'succeeded', outputRef: planned.outputRef }] }, execution);
  const finalized = await handlers['blog.project.discovery-shadow:finalize-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'search-candidates', status: 'succeeded', outputRef: searched.outputRef }] }, execution);
  assert.deepEqual(queries,
    ['visual artificial intelligence', 'creative autonomous agent', 'visual artificial']);
  assert.deepEqual(searched.outputRef.candidateCounts, [0, 0, 1]);
  assert.deepEqual(searched.outputRef.fallbackLineage,
    [{ query: 'visual artificial', sourceQuery: 'visual artificial intelligence' }]);
  const candidateSet = stored.get(finalized.outputRef.artifactId);
  assert.deepEqual(candidateSet.content.queryPolicy.plannedQueries,
    ['visual artificial intelligence', 'creative autonomous agent']);
  assert.deepEqual(candidateSet.content.queryPolicy.queries,
    ['visual artificial intelligence', 'creative autonomous agent', 'visual artificial']);
  assert.deepEqual(candidateSet.content.queryPolicy.fallbackQueries, ['visual artificial']);
  assert.deepEqual(candidateSet.content.candidates.map(item => item.key), ['new/fallback']);
});

test('autonomous discovery rejects Chinese promotional phrases before any GitHub search', async () => {
  const { defaultAgentBehaviorProfile } = await load('agent-behavior-profile.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { createAgentBlogAutonomousCandidateDiscoveryHandlers } =
    await load('agent-blog-candidate-discovery.mjs');
  const autonomousInput = { schemaVersion: 'blog-project-discovery-input-v2',
    topicScope: '发现有趣而有用的开源人工智能工具',
    searchPolicy: { sort: 'stars', minStars: 10, pushedAfter: null, maxCandidates: 4, maxQueries: 3 },
    previousRepositoryUrls: [], behaviorProfile: defaultAgentBehaviorProfile() };
  const providerGateway = { invoke: async () => ({ status: 'succeeded', actionId: uuid(), output: {
    queries: ['开源 人工智能 插件 智能体 工具'],
    rationale: '选题范围强调面向普通用户的人工智能工具，因此先从容易理解且具有实际用途的项目开始搜索。',
    interestSignals: ['可以快速体验'],
  } }) };
  let toolCalls = 0;
  const handlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({ providerGateway,
    toolGateway: { invoke: async () => { toolCalls += 1; } },
    artifactRepository: { save: async () => { throw new Error('must not save invalid plan'); } },
  });
  const run = { id: uuid(), agentUserId: uuid(), configSnapshot: {}, input: autonomousInput,
    inputSha256: stableHash(autonomousInput) };
  const frozen = await handlers['blog.project.discovery-shadow:freeze-brief']({
    run, stage: { id: uuid() }, prerequisites: [],
  });
  await assert.rejects(handlers['blog.project.discovery-shadow:plan-queries']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'freeze-brief', status: 'succeeded', outputRef: frozen.outputRef }] },
  { workerId: 'worker', leaseToken: uuid() }),
  error => error.code === 'AGENT_BLOG_DISCOVERY_PLAN_INVALID');
  assert.equal(toolCalls, 0);
});
