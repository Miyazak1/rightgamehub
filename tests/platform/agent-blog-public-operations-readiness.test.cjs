const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);
const agentUserId = crypto.randomUUID();
const now = new Date('2026-10-26T02:00:00.000Z');
const runtimeConfig = overrides => ({
  schemaVersion: 'agent-blog-public-runtime-config-v1', enabled: true, agentUserId,
  provider: 'deepseek', modelId: 'deepseek-flash', dailyPublicationRunLimit: 1,
  monthlyProviderCallLimit: 120, monthlyCostMicrousdLimit: 10_000_000,
  consecutiveFailureLimit: 2, ...overrides,
});
const scheduleConfig = overrides => ({
  schemaVersion: 'agent-blog-public-schedule-config-v1', enabled: true,
  pollMilliseconds: 30000, timezone: 'Asia/Shanghai', localTime: '10:00', ...overrides,
});
const preflight = overrides => ({
  schemaVersion: 'agent-blog-public-runtime-preflight-v1', ready: true, blockers: [],
  limits: { dailyPublicationRuns: 1, monthlyProviderCalls: 120,
    monthlyCostMicrousd: 10_000_000, consecutiveFailures: 2 },
  observed: { providerCallsMonth: 3, costMicrousdMonth: 2000, publicationRunsToday: 0 },
  ...overrides,
});

test('public operations readiness requires both exact executor policy and a fresh scheduler heartbeat', async () => {
  const { evaluateAgentBlogPublicOperationsReadiness } =
    await load('agent-blog-public-operations-readiness.mjs');
  const value = evaluateAgentBlogPublicOperationsReadiness({
    agentUserId, runtimeConfig: runtimeConfig(), scheduleConfig: scheduleConfig(),
    runtimePreflight: preflight(), now,
    schedule: { enabled: true, mode: 'foundation-public', worker: {
      instanceId: crypto.randomUUID(), state: 'idle', heartbeatAt: '2026-10-26T01:59:40.000Z',
    } },
  });
  assert.equal(value.manualRun.ready, true);
  assert.equal(value.scheduler.ready, true);
  assert.equal(value.scheduler.workerLive, true);
  assert.equal(value.scheduler.automaticActivation, false);
});

test('public operations readiness exposes disabled switches, agent mismatch and stale workers', async () => {
  const { evaluateAgentBlogPublicOperationsReadiness } =
    await load('agent-blog-public-operations-readiness.mjs');
  const otherAgent = crypto.randomUUID();
  const value = evaluateAgentBlogPublicOperationsReadiness({
    agentUserId, runtimeConfig: runtimeConfig({ enabled: false, agentUserId: otherAgent }),
    scheduleConfig: scheduleConfig({ enabled: false }),
    runtimePreflight: preflight({ ready: false, blockers: ['AGENT_BLOG_PUBLIC_RUNTIME_DISABLED'] }), now,
    schedule: { enabled: true, mode: 'foundation-public', worker: {
      instanceId: crypto.randomUUID(), state: 'idle', heartbeatAt: '2026-10-26T01:55:00.000Z',
    } },
  });
  assert.deepEqual(value.manualRun.blockers, [
    'AGENT_BLOG_PUBLIC_RUNTIME_DISABLED', 'AGENT_BLOG_PUBLIC_RUNTIME_AGENT_MISMATCH',
  ]);
  assert.equal(value.scheduler.ready, false);
  assert.ok(value.scheduler.blockers.includes('AGENT_BLOG_PUBLIC_SCHEDULE_DISABLED'));
  assert.ok(value.scheduler.blockers.includes('AGENT_BLOG_PUBLIC_SCHEDULER_HEARTBEAT_STALE'));
});
