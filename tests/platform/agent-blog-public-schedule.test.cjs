const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);
const agentUserId = crypto.randomUUID(), scheduleId = crypto.randomUUID();
const fireId = crypto.randomUUID(), attemptId = crypto.randomUUID(), requestId = crypto.randomUUID();

const runtimeConfig = {
  schemaVersion: 'agent-blog-public-runtime-config-v1', enabled: true, agentUserId,
  provider: 'deepseek', modelId: 'deepseek-flash', dailyPublicationRunLimit: 1,
  monthlyProviderCallLimit: 120, monthlyCostMicrousdLimit: 10_000_000,
  consecutiveFailureLimit: 2,
};
const snapshot = overrides => ({ activePublisher: 'foundation', legacyAutomationEnabled: false,
  identityReady: true, capabilityCount: 5, toolCount: 2, workflowCount: 2,
  secretReady: true, modelReady: true, circuitReady: true, activeRuns: 0,
  uncertainRuns: 0, awaitingHandoff: 0, publicationRunsToday: 0,
  providerCallsMonth: 0, costMicrousdMonth: 0, consecutiveFailures: 0, ...overrides });

function fixture({ observed = snapshot(), publicationState = 'published', throwRun = false } = {}) {
  const events = [];
  const fire = { id: fireId, scheduleId, agentUserId, requestId, attemptId,
    logicalFireAt: '2026-10-27T02:00:00.000Z' };
  return {
    events,
    repository: {
      ensureDaily: async input => (events.push(['ensure', input]), { id: scheduleId,
        enabled: input.enabled, mode: 'foundation-public', nextFireAt: '2026-10-27T02:00:00.000Z' }),
      claimDue: async () => (events.push(['claim']), fire),
      finish: async (id, attempt, result) => (events.push(['finish', id, attempt, result]),
        { ...fire, status: result.status, result: result.result ?? {}, errorCode: result.errorCode ?? null }),
      heartbeat: async input => (events.push(['heartbeat', input]), input),
    },
    preflightRepository: { snapshot: async () => observed },
    runtimeConfig,
    runner: { run: async input => {
      events.push(['run', input]);
      if (throwRun) throw Object.assign(new Error('provider failed'), { code: 'PROVIDER_FAILED' });
      return { publicationAttempted: true,
        publication: { runId: crypto.randomUUID(), articleId: crypto.randomUUID(), publicationState } };
    } },
  };
}

test('public schedule is disabled by default and fixed to Asia/Shanghai 10:00', async () => {
  const { loadAgentBlogPublicScheduleConfig } = await load('agent-blog-public-schedule.mjs');
  assert.deepEqual(loadAgentBlogPublicScheduleConfig({}), {
    schemaVersion: 'agent-blog-public-schedule-config-v1', enabled: false,
    pollMilliseconds: 30000, timezone: 'Asia/Shanghai', localTime: '10:00',
  });
});

test('public schedule activation ignores only a spent current-day public quota', async () => {
  const { createAgentBlogPublicScheduleController } = await load('agent-blog-public-schedule.mjs');
  const daily = fixture({ observed: snapshot({ publicationRunsToday: 1 }) });
  const activated = await createAgentBlogPublicScheduleController(daily)
    .ensure({ agentUserId, enabled: true });
  assert.equal(activated.enabled, true);
  assert.deepEqual(activated.blockers, []);

  const unsafe = fixture({ observed: snapshot({ activePublisher: 'legacy', publicationRunsToday: 1 }) });
  const blocked = await createAgentBlogPublicScheduleController(unsafe)
    .ensure({ agentUserId, enabled: true });
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.blockers, ['AGENT_BLOG_PUBLICATION_OWNER_NOT_FOUNDATION']);
  assert.equal(unsafe.events.some(([event]) => event === 'ensure'), false);
});

test('public scheduled fire succeeds only after an article is publicly committed', async () => {
  const { createAgentBlogPublicScheduleController } = await load('agent-blog-public-schedule.mjs');
  const value = fixture();
  const result = await createAgentBlogPublicScheduleController(value).runOnce();
  assert.equal(result.status, 'succeeded');
  const run = value.events.find(([event]) => event === 'run')[1];
  assert.equal(run.triggerKind, 'schedule');
  assert.equal(run.requestId, requestId);
  assert.equal(value.events.find(([event]) => event === 'finish')[3].status, 'succeeded');
});

test('public scheduler heartbeats are explicit and delegated to durable storage', async () => {
  const { createAgentBlogPublicScheduleController } = await load('agent-blog-public-schedule.mjs');
  const value = fixture(), instanceId = crypto.randomUUID();
  await createAgentBlogPublicScheduleController(value)
    .heartbeat({ agentUserId, instanceId, state: 'idle' });
  assert.deepEqual(value.events[0], ['heartbeat', { agentUserId, instanceId, state: 'idle' }]);
});

test('incomplete or failed public fire is persisted as failed for schedule suspension', async () => {
  const { createAgentBlogPublicScheduleController } = await load('agent-blog-public-schedule.mjs');
  const incomplete = fixture({ publicationState: 'draft' });
  assert.equal((await createAgentBlogPublicScheduleController(incomplete).runOnce()).status, 'failed');
  assert.equal(incomplete.events.find(([event]) => event === 'finish')[3].errorCode,
    'AGENT_BLOG_PUBLIC_SCHEDULE_PUBLICATION_INCOMPLETE');
  const failed = fixture({ throwRun: true });
  assert.equal((await createAgentBlogPublicScheduleController(failed).runOnce()).status, 'failed');
  assert.equal(failed.events.find(([event]) => event === 'finish')[3].errorCode, 'PROVIDER_FAILED');
});
