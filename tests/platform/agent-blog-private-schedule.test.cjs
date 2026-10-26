const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/agent-blog-private-schedule.mjs'));
const scheduleId = '11111111-1111-4111-8111-111111111111';
const agentUserId = '22222222-2222-4222-8222-222222222222';
const fireId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';

test('schedule ledger binds Agent identity, deduplicates fire time, and guards terminal facts', () => {
  const migration = fs.readFileSync(path.resolve(__dirname,
    '../../apps/api/migrations/0136_agent_blog_private_schedule.sql'), 'utf8');
  assert.match(migration, /FOREIGN KEY\(schedule_id,agent_user_id\)[\s\S]*REFERENCES agent_schedules\(id,agent_user_id\)/u);
  assert.match(migration, /UNIQUE\(schedule_id,logical_fire_at\)/u);
  assert.match(migration, /OLD\.status<>'running'/u);
  assert.match(migration, /Agent schedule fires cannot be deleted/u);
});

test('daily private schedule resolves the next 10:00 in Asia/Shanghai', async () => {
  const { nextAgentBlogPrivateDailyFire } = await import(moduleUrl.href);
  assert.equal(nextAgentBlogPrivateDailyFire(new Date('2026-10-26T01:00:00.000Z')).toISOString(),
    '2026-10-26T02:00:00.000Z');
  assert.equal(nextAgentBlogPrivateDailyFire(new Date('2026-10-26T02:00:00.000Z')).toISOString(),
    '2026-10-27T02:00:00.000Z');
});

test('schedule request id is stable per logical fire and changes across fires', async () => {
  const { scheduleFireRequestId } = await import(moduleUrl.href);
  const first = scheduleFireRequestId(scheduleId, '2026-10-26T02:00:00.000Z');
  assert.equal(first, scheduleFireRequestId(scheduleId, '2026-10-26T02:00:00.000Z'));
  assert.notEqual(first, scheduleFireRequestId(scheduleId, '2026-10-27T02:00:00.000Z'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test('schedule config requires two explicit gates and keeps 10:00 fixed', async () => {
  const { loadAgentBlogPrivateScheduleConfig } = await import(moduleUrl.href);
  assert.deepEqual(loadAgentBlogPrivateScheduleConfig({}), {
    schemaVersion: 'agent-blog-private-schedule-config-v1', enabled: false,
    pollMilliseconds: 30000, timezone: 'Asia/Shanghai', localTime: '10:00',
  });
  assert.equal(loadAgentBlogPrivateScheduleConfig({ AGENT_BLOG_PRIVATE_SCHEDULE_ENABLED: 'true',
    AGENT_BLOG_PRIVATE_SCHEDULE_POLL_MS: '5000' }).enabled, true);
  assert.throws(() => loadAgentBlogPrivateScheduleConfig({
    AGENT_BLOG_PRIVATE_SCHEDULE_ENABLED: 'yes',
  }), error => error.code === 'AGENT_BLOG_SCHEDULE_ENABLED_INVALID');
});

function controllerFixture({ passes = 3, verdict = 'passed', throwRun = false } = {}) {
  const events = [];
  const fire = { id: fireId, scheduleId, agentUserId, requestId, attemptId,
    logicalFireAt: '2026-10-26T02:00:00.000Z', status: 'running' };
  const repository = {
    async ensureDaily(input) { events.push(['ensure', input]); return { id: scheduleId,
      enabled: input.enabled, nextFireAt: '2026-10-27T02:00:00.000Z' }; },
    async claimDue() { events.push(['claim']); return fire; },
    async finish(id, attempt, result) { events.push(['finish', id, attempt, result]);
      return { ...fire, status: result.status, result: result.result ?? {}, errorCode: result.errorCode ?? null }; },
  };
  const acceptanceService = { async readiness() { events.push(['readiness']); return {
    requiredConsecutivePasses: 3, consecutivePasses: passes,
    readyForShadowScheduleReview: passes >= 3, automaticScheduleChange: false,
  }; } };
  const supervisor = { async run(input) { events.push(['run', input]);
    if (throwRun) throw Object.assign(new Error('provider failed'), { code: 'PROVIDER_FAILED' });
    return { acceptance: { verdict }, publicationAttempted: false, scheduleDecision: 'unchanged',
      canary: { draft: { runId: '66666666-6666-4666-8666-666666666666',
        articleId: '77777777-7777-4777-8777-777777777777' } } };
  } };
  return { repository, acceptanceService, supervisor, events };
}

test('schedule activation is blocked until three consecutive private acceptance passes', async () => {
  const { createAgentBlogPrivateScheduleController } = await import(moduleUrl.href);
  const value = controllerFixture({ passes: 2 });
  const result = await createAgentBlogPrivateScheduleController(value)
    .ensure({ agentUserId, enabled: true });
  assert.equal(result.blocked, true);
  assert.equal(result.enabled, false);
  assert.deepEqual(value.events.find(([event]) => event === 'ensure')[1], { agentUserId, enabled: false });
});

test('due fire uses schedule trigger and persists only a supervised private success', async () => {
  const { createAgentBlogPrivateScheduleController } = await import(moduleUrl.href);
  const value = controllerFixture();
  const controller = createAgentBlogPrivateScheduleController(value);
  assert.equal((await controller.ensure({ agentUserId, enabled: true })).enabled, true);
  const result = await controller.runOnce();
  assert.equal(result.status, 'succeeded');
  const run = value.events.find(([event]) => event === 'run')[1];
  assert.equal(run.requestId, requestId);
  assert.equal(run.triggerKind, 'schedule');
  assert.equal(run.triggerRef, `schedule:${scheduleId}:2026-10-26T02:00:00.000Z`);
  assert.equal(value.events.find(([event]) => event === 'finish')[3].status, 'succeeded');
});

test('failed scheduled run is recorded as failed for repository suspension', async () => {
  const { createAgentBlogPrivateScheduleController } = await import(moduleUrl.href);
  const value = controllerFixture({ throwRun: true });
  const result = await createAgentBlogPrivateScheduleController(value).runOnce();
  assert.equal(result.status, 'failed');
  const finish = value.events.find(([event]) => event === 'finish')[3];
  assert.equal(finish.status, 'failed');
  assert.equal(finish.errorCode, 'PROVIDER_FAILED');
});
