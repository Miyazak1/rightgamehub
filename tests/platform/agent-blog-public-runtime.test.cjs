const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);

function config(overrides = {}) {
  return { schemaVersion: 'agent-blog-public-runtime-config-v1', enabled: true,
    agentUserId: crypto.randomUUID(), provider: 'deepseek', modelId: 'deepseek-flash',
    dailyPublicationRunLimit: 1, monthlyProviderCallLimit: 120,
    monthlyCostMicrousdLimit: 10_000_000, consecutiveFailureLimit: 2, ...overrides };
}

function readySnapshot(overrides = {}) {
  return { activePublisher: 'foundation', legacyAutomationEnabled: false, identityReady: true,
    capabilityCount: 5, toolCount: 2, workflowCount: 2, secretReady: true, modelReady: true,
    circuitReady: true, activeRuns: 0, uncertainRuns: 0, awaitingHandoff: 0,
    publicationRunsToday: 0, providerCallsMonth: 0, costMicrousdMonth: 0,
    consecutiveFailures: 0, ...overrides };
}

test('public runtime defaults off and requires Foundation ownership plus a quiescent legacy path', async () => {
  const { loadAgentBlogPublicRuntimeConfig, evaluateAgentBlogPublicRuntimeSnapshot } =
    await load('agent-blog-public-runtime-preflight.mjs');
  assert.equal(loadAgentBlogPublicRuntimeConfig({}).enabled, false);
  const value = config();
  assert.equal(evaluateAgentBlogPublicRuntimeSnapshot(value, readySnapshot()).ready, true);
  const blocked = evaluateAgentBlogPublicRuntimeSnapshot(value, readySnapshot({
    activePublisher: 'legacy', legacyAutomationEnabled: true, activeRuns: 1,
    uncertainRuns: 1, publicationRunsToday: 1,
  }));
  assert.deepEqual(blocked.blockers, [
    'AGENT_BLOG_PUBLICATION_OWNER_NOT_FOUNDATION',
    'AGENT_BLOG_LEGACY_AUTOMATION_STILL_ENABLED',
    'AGENT_BLOG_PUBLIC_RUNTIME_RUN_ACTIVE',
    'AGENT_BLOG_PUBLIC_RUNTIME_UNCERTAIN',
    'AGENT_BLOG_PUBLIC_RUNTIME_DAILY_LIMIT_REACHED',
  ]);
});

test('public bootstrap registers the public workflow without creating a Run or changing ownership', async () => {
  const { createAgentBlogPublicRuntimeBootstrap, DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG } =
    await load('agent-blog-public-runtime-bootstrap.mjs');
  const { DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG } = await load('agent-blog-private-canary-bootstrap.mjs');
  const value = config(), operatorUserId = crypto.randomUUID(), workflows = [];
  let registeredModel = null;
  const receipt = await createAgentBlogPublicRuntimeBootstrap({
    config: value,
    identityRepository: { load: async () => ({ agentUserId: value.agentUserId, operatorUserId }) },
    runtimeRepository: {
      registerWorkflow: async ({ manifest }) => {
        workflows.push(manifest.workflowKey);
        return { status: 'draft', manifestSha256: manifest.workflowKey };
      },
      activateWorkflow: async () => ({ status: 'active' }),
    },
    toolRepository: { registerTool: async tool => ({ ...tool, existing: false }) },
    providerRepository: { registerModel: async model => {
      registeredModel = model;
      return { ...model, existing: false };
    } },
  }).run();
  assert.deepEqual(workflows, ['blog.project.discovery-shadow', 'blog.project.single']);
  assert.equal(DEEPSEEK_FLASH_PRIVATE_CANARY_CATALOG.catalogVersion, 1);
  assert.equal(DEEPSEEK_FLASH_PUBLIC_RUNTIME_CATALOG.catalogVersion, 2);
  assert.equal(registeredModel.catalogVersion, 2);
  assert.equal(registeredModel.config.admissionScope, 'agent-blog-public-runtime');
  assert.equal(receipt.model.catalogVersion, 2);
  assert.equal(receipt.runCreated, false);
  assert.equal(receipt.providerInvoked, false);
  assert.equal(receipt.publicationAttempted, false);
  assert.equal(receipt.ownershipChanged, false);
  assert.equal(receipt.scheduleChanged, false);
});

test('public runner executes discovery then the seven-stage publication Run', async () => {
  const { createAgentBlogPublicRuntimeManualRunner } = await load('agent-blog-public-runtime-manual-run.mjs');
  const value = config(), requestId = crypto.randomUUID();
  const discoveryId = crypto.randomUUID(), discoveryArtifactId = crypto.randomUUID();
  const publicationId = crypto.randomUUID(), articleId = crypto.randomUUID();
  const calls = [];
  const worker = (runId, stageCount, outputType, outputId) => {
    let step = 0;
    return { runOnce: async () => {
      step += 1;
      return { status: 'completed', run: step === stageCount
        ? { id: runId, status: 'succeeded', outputType, outputId } : undefined };
    }, stop: async () => {} };
  };
  const runner = createAgentBlogPublicRuntimeManualRunner({
    config: value,
    preflightRepository: { snapshot: async () => readySnapshot() },
    inputRepository: { snapshot: async () => ({
      schemaVersion: 'agent-blog-private-canary-input-snapshot-v1', agentUserId: value.agentUserId,
      topicScope: '开源工具', configuredModelId: 'deepseek-flash',
      behaviorProfileId: crypto.randomUUID(), behaviorProfileVersion: 2,
      behaviorProfile: { schemaVersion: 'agent-behavior-profile-v1', mission: '发现有用工具',
        personality: '好奇', voice: '清晰', audience: '普通读者', selectionPersona: '重视证据',
        interestSignals: ['有用'], allowComparisons: true },
      recentTitles: [], previousRepositoryUrls: [],
    }) },
    discoveryCanary: { createRun: async input => (calls.push(['discovery', input]), { id: discoveryId }) },
    publicHandoff: { createDraftRun: async input => (calls.push(['publication', input]), { id: publicationId }) },
    createDiscoveryWorker: () => worker(discoveryId, 4, 'blog.candidate-set', discoveryArtifactId),
    createPublicationWorker: () => worker(publicationId, 7, 'blog.article', articleId),
  });
  const result = await runner.run({ requestId });
  assert.equal(result.publication.articleId, articleId);
  assert.equal(result.publication.publicationState, 'published');
  assert.equal(result.publicationAttempted, true);
  assert.equal(calls[0][1].idempotencyKey, `public-runtime:${requestId}:discovery`);
  assert.equal(calls[1][1].idempotencyKey, `public-runtime:${requestId}:article`);
});
