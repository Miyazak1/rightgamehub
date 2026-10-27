const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);

test('public operations are scoped to the administrator and durable scheduler', async () => {
  const { createAgentBlogPublicOperationsService } = await load('agent-blog-public-operations-service.mjs');
  const operatorUserId = crypto.randomUUID(), agentUserId = crypto.randomUUID(), calls = [];
  const service = createAgentBlogPublicOperationsService({
    pool: { query: async (_sql, values) => ({ rows: values[0] === agentUserId && values[1] === operatorUserId
      ? [{ user_id: agentUserId }] : [] }) },
    authorizeOperator: async actor => actor.userId === operatorUserId,
    controller: {
      ensure: async input => (calls.push(['ensure', input]), { enabled: input.enabled, blocked: false }),
      requestNow: async input => (calls.push(['run', input]), { queued: true, blocked: false }),
    },
    runtimeConfig: { enabled: true, agentUserId },
    scheduleConfig: { enabled: true, pollMilliseconds: 30000 },
  });
  assert.equal((await service.setSchedule({ userId: operatorUserId }, agentUserId, { enabled: true })).enabled, true);
  assert.equal((await service.runNow({ userId: operatorUserId }, agentUserId)).queued, true);
  assert.deepEqual(calls[0], ['ensure', { agentUserId, enabled: true, resume: true }]);
  assert.deepEqual(calls[1], ['run', { agentUserId, maxHeartbeatAgeMs: 90000 }]);
  await assert.rejects(() => service.runNow({ userId: crypto.randomUUID() }, agentUserId),
    error => error.code === 'AGENT_OPERATOR_REQUIRED');
});

test('public operations fail closed when server-side runtime switches are unavailable', async () => {
  const { createAgentBlogPublicOperationsService } = await load('agent-blog-public-operations-service.mjs');
  const operatorUserId = crypto.randomUUID(), agentUserId = crypto.randomUUID();
  const base = {
    pool: { query: async () => ({ rows: [{ user_id: agentUserId }] }) },
    authorizeOperator: async () => true,
    controller: { ensure: async () => ({ enabled: true }), requestNow: async () => ({ queued: true }) },
    runtimeConfig: { enabled: true, agentUserId },
  };
  const service = createAgentBlogPublicOperationsService({ ...base,
    scheduleConfig: { enabled: false, pollMilliseconds: 30000 } });
  await assert.rejects(() => service.setSchedule({ userId: operatorUserId }, agentUserId, { enabled: true }),
    error => error.code === 'AGENT_PUBLIC_SCHEDULE_DISABLED');
  await assert.rejects(() => service.runNow({ userId: operatorUserId }, agentUserId),
    error => error.code === 'AGENT_PUBLIC_SCHEDULE_DISABLED');
});
