const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);

test('private blog canary defaults off, forbids publish, and fails closed on every readiness blocker', async () => {
  const { loadAgentBlogPrivateCanaryConfig, evaluateAgentBlogPrivateCanarySnapshot } =
    await load('agent-blog-private-canary-preflight.mjs');
  const disabled = loadAgentBlogPrivateCanaryConfig({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.publishEnabled, false);
  assert.equal(disabled.dailyDiscoveryRunLimit, 1);
  assert.equal(disabled.extraDailyRunAllowance, 0);
  assert.throws(() => loadAgentBlogPrivateCanaryConfig({
    AGENT_BLOG_PRIVATE_CANARY_PUBLISH_ENABLED: 'true',
  }), error => error.code === 'AGENT_BLOG_PRIVATE_CANARY_PUBLISH_FORBIDDEN');
  const enabled = loadAgentBlogPrivateCanaryConfig({
    AGENT_BLOG_PRIVATE_CANARY_ENABLED: 'true',
    AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID: crypto.randomUUID(),
    AGENT_BLOG_PRIVATE_CANARY_MODEL_ID: 'deepseek-flash',
  });
  const readySnapshot = { identityReady: true, capabilityCount: 4, toolCount: 2, workflowCount: 2,
    secretReady: true, modelReady: true, circuitReady: true, activeRuns: 0, uncertainRuns: 0,
    awaitingHandoff: 0, discoveryRunsToday: 0, providerCallsMonth: 0,
    costMicrousdMonth: 0, consecutiveFailures: 0 };
  assert.equal(evaluateAgentBlogPrivateCanarySnapshot(enabled, readySnapshot).ready, true);
  const oneExtraRun = loadAgentBlogPrivateCanaryConfig({
    AGENT_BLOG_PRIVATE_CANARY_ENABLED: 'true',
    AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID: crypto.randomUUID(),
    AGENT_BLOG_PRIVATE_CANARY_DAILY_RUN_LIMIT: '4',
    AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_RUN_ALLOWANCE: '1',
  });
  assert.equal(oneExtraRun.dailyDiscoveryRunLimit, 5);
  assert.equal(oneExtraRun.dailyDiscoveryRunBaseLimit, 4);
  assert.equal(oneExtraRun.extraDailyRunAllowance, 1);
  assert.equal(evaluateAgentBlogPrivateCanarySnapshot(oneExtraRun,
    { ...readySnapshot, discoveryRunsToday: 4 }).ready, true);
  assert.throws(() => loadAgentBlogPrivateCanaryConfig({
    AGENT_BLOG_PRIVATE_CANARY_ENABLED: 'true',
    AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID: crypto.randomUUID(),
    AGENT_BLOG_PRIVATE_CANARY_DAILY_RUN_LIMIT: '4',
    AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_RUN_ALLOWANCE: '2',
  }), error => error.code === 'AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_ALLOWANCE_INVALID');
  assert.throws(() => loadAgentBlogPrivateCanaryConfig({
    AGENT_BLOG_PRIVATE_CANARY_ENABLED: 'true',
    AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID: crypto.randomUUID(),
    AGENT_BLOG_PRIVATE_CANARY_DAILY_RUN_LIMIT: '3',
    AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_RUN_ALLOWANCE: '1',
  }), error => error.code === 'AGENT_BLOG_PRIVATE_CANARY_EXTRA_DAILY_ALLOWANCE_REQUIRES_MAX_BASE');
  const blocked = evaluateAgentBlogPrivateCanarySnapshot(enabled, {
    ...readySnapshot, activeRuns: 1, uncertainRuns: 1, awaitingHandoff: 1,
    discoveryRunsToday: 1, providerCallsMonth: 12, costMicrousdMonth: 1_000_000,
    consecutiveFailures: 2,
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, [
    'AGENT_BLOG_PRIVATE_CANARY_RUN_ACTIVE',
    'AGENT_BLOG_PRIVATE_CANARY_UNCERTAIN',
    'AGENT_BLOG_PRIVATE_CANARY_AWAITING_HANDOFF',
    'AGENT_BLOG_PRIVATE_CANARY_DAILY_LIMIT_REACHED',
    'AGENT_BLOG_PRIVATE_CANARY_PROVIDER_LIMIT_REACHED',
    'AGENT_BLOG_PRIVATE_CANARY_COST_LIMIT_REACHED',
    'AGENT_BLOG_PRIVATE_CANARY_FAILURE_CIRCUIT_OPEN',
  ]);
});
