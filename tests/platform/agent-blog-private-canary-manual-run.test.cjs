const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/agent-blog-private-canary-manual-run.mjs'));
const agentUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const discoveryRunId = '33333333-3333-4333-8333-333333333333';
const artifactId = '44444444-4444-4444-8444-444444444444';
const draftRunId = '55555555-5555-4555-8555-555555555555';
const articleId = '66666666-6666-4666-8666-666666666666';
const profile = { schemaVersion: 'agent-behavior-v1', core: {
  mission: '发现并研究真正有用或者有趣的开放项目，诚实说明所有证据边界。',
  personality: '好奇、审慎、有判断力，关注小而巧的创意，也不盲目追逐热点。',
  voice: '使用自然、具体和克制的简体中文。', audience: '关注开放工具和数字创作的普通中文读者。',
}, modules: { editorial: { persona: '像一位好奇而审慎的科技编辑，所有判断必须来自候选仓库证据。',
  comparisonEnabled: true, interestSignals: ['可以快速体验'] } } };
const editorialMemory = { schemaVersion: 'blog-editorial-memory-input-v1',
  capturedAt: '2026-10-27T00:00:00.000Z', activeCooldowns: [] };

function completedWorker(runId, count, outputType, outputId, events) {
  let index = 0;
  return {
    async runOnce() {
      index += 1; events.push(`stage:${runId}:${index}`);
      return { status: 'completed', run: index === count
        ? { id: runId, status: 'succeeded', outputType, outputId } : null };
    },
    async stop() { events.push(`stop:${runId}`); },
  };
}

function fixture({ discoveryStatus = 'completed' } = {}) {
  const events = [];
  const config = { schemaVersion: 'agent-blog-private-canary-config-v1', enabled: true,
    publishEnabled: false, agentUserId, provider: 'deepseek', modelId: 'deepseek-flash',
    githubResearchAuthenticated: true,
    dailyDiscoveryRunLimit: 1, monthlyProviderCallLimit: 12,
    monthlyCostMicrousdLimit: 1000000, consecutiveFailureLimit: 2 };
  const preflightRepository = { async snapshot() { events.push('preflight'); return { identityReady: true,
    capabilityCount: 4, toolCount: 3, workflowCount: 2, secretReady: true, modelReady: true, circuitReady: true,
    activeRuns: 0, uncertainRuns: 0, awaitingHandoff: 0, discoveryRunsToday: 0,
    providerCallsMonth: 0, costMicrousdMonth: 0, consecutiveFailures: 0 }; } };
  const inputRepository = { async snapshot() { events.push('snapshot'); return {
    schemaVersion: 'agent-blog-private-canary-input-snapshot-v2',
    agentUserId, topicScope: '有趣而且实用的开源工具', configuredModelId: 'deepseek-flash',
    behaviorProfileId: '77777777-7777-4777-8777-777777777777', behaviorProfileVersion: 3,
    behaviorProfile: profile, recentTitles: ['旧文章'],
    previousRepositoryUrls: ['https://github.com/old/project'], editorialMemory,
  }; } };
  const discoveryCanary = { async createRun(input) { events.push('create-discovery');
    assert.equal(input.input.schemaVersion, 'blog-project-discovery-input-v2');
    assert.deepEqual(input.input.previousRepositoryUrls, ['https://github.com/old/project']);
    return { id: discoveryRunId }; } };
  const handoffCanary = { async createDraftRun(input) { events.push('handoff');
    assert.equal(input.discoveryArtifactId, artifactId);
    assert.deepEqual(input.editorialMemory, editorialMemory); return { id: draftRunId }; } };
  const createDiscoveryWorker = runId => discoveryStatus === 'completed'
    ? completedWorker(runId, 4, 'blog.candidate-set', artifactId, events)
    : { async runOnce() { events.push('stage-failed'); return { status: discoveryStatus }; },
      async stop() { events.push(`stop:${runId}`); } };
  const createDraftWorker = runId => completedWorker(runId, 6, 'blog.private-draft', articleId, events);
  return { events, runnerOptions: { config, preflightRepository, inputRepository,
    discoveryCanary, handoffCanary, createDiscoveryWorker, createDraftWorker } };
}

test('manual private canary runs one isolated discovery and one private draft handoff', async () => {
  const { createAgentBlogPrivateCanaryManualRunner } = await import(moduleUrl.href);
  const value = fixture();
  const result = await createAgentBlogPrivateCanaryManualRunner(value.runnerOptions).run({ requestId });
  assert.equal(result.discovery.artifactId, artifactId);
  assert.equal(result.draft.articleId, articleId);
  assert.equal(result.publicationAttempted, false);
  assert.equal(value.events.filter(item => item.startsWith('stage:')).length, 10);
  assert(value.events.indexOf('handoff') > value.events.indexOf(`stop:${discoveryRunId}`));
});

test('manual private canary stops before handoff when discovery is not fully successful', async () => {
  const { createAgentBlogPrivateCanaryManualRunner } = await import(moduleUrl.href);
  const value = fixture({ discoveryStatus: 'retry-scheduled' });
  await assert.rejects(() => createAgentBlogPrivateCanaryManualRunner(value.runnerOptions).run({ requestId }), error => {
    assert.equal(error.code, 'AGENT_BLOG_PRIVATE_CANARY_STAGE_INCOMPLETE');
    assert.equal(error.details.workerStatus, 'retry-scheduled');
    assert.equal(error.details.stageNumber, 1);
    return true;
  });
  assert(!value.events.includes('handoff'));
  assert(value.events.includes(`stop:${discoveryRunId}`));
});

test('manual private canary remains read-only when preflight blocks execution', async () => {
  const { createAgentBlogPrivateCanaryManualRunner } = await import(moduleUrl.href);
  const value = fixture();
  value.runnerOptions.preflightRepository.snapshot = async () => ({ identityReady: false,
    capabilityCount: 0, toolCount: 0, workflowCount: 0, secretReady: false, modelReady: false, circuitReady: false,
    activeRuns: 0, uncertainRuns: 0, awaitingHandoff: 0, discoveryRunsToday: 0,
    providerCallsMonth: 0, costMicrousdMonth: 0, consecutiveFailures: 0 });
  await assert.rejects(() => createAgentBlogPrivateCanaryManualRunner(value.runnerOptions).run({ requestId }),
    error => error.code === 'AGENT_BLOG_PRIVATE_CANARY_PREFLIGHT_BLOCKED');
  assert(!value.events.includes('snapshot'));
  assert(!value.events.includes('create-discovery'));
});

test('private canary rejects unknown trigger kinds before preflight or external work', async () => {
  const { createAgentBlogPrivateCanaryManualRunner } = await import(moduleUrl.href);
  const value = fixture();
  await assert.rejects(() => createAgentBlogPrivateCanaryManualRunner(value.runnerOptions)
    .run({ requestId, triggerKind: 'cron', triggerRef: 'unsafe' }),
  error => error.code === 'AGENT_BLOG_PRIVATE_CANARY_TRIGGER_INVALID');
  assert.deepEqual(value.events, []);
});
