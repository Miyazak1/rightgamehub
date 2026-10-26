const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/agent-runtime-read-service.mjs'));

test('runtime overview exposes canary readiness without enabling scheduling', async () => {
  const { createAgentRuntimeReadService } = await import(moduleUrl.href);
  const operatorId = crypto.randomUUID(), agentUserId = crypto.randomUUID();
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT user_id FROM agent_accounts/u.test(sql)) return { rows: [{ user_id: agentUserId }] };
    if (/agent_blog_canary_acceptance_reports/u.test(sql)) return { rows: [
      { verdict: 'passed', reason_codes: [], created_at: new Date('2026-10-26T02:00:00Z') },
      { verdict: 'passed', reason_codes: [], created_at: new Date('2026-10-25T02:00:00Z') },
      { verdict: 'failed', reason_codes: ['STAGE_RETRY_OBSERVED'], created_at: new Date('2026-10-24T02:00:00Z') },
    ] };
    if (/FROM agent_schedules/u.test(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const service = createAgentRuntimeReadService({ pool,
    authorizeOperator: async actor => actor.userId === operatorId });
  const overview = await service.blogOverview({ userId: operatorId }, agentUserId);
  assert.equal(overview.schemaVersion, 'agent-blog-foundation-overview-v1');
  assert.equal(overview.acceptance.policyVersion, 2);
  assert.equal(overview.acceptance.consecutivePasses, 2);
  assert.equal(overview.acceptance.requiredConsecutivePasses, 3);
  assert.equal(overview.acceptance.readyForShadowScheduleReview, false);
  assert.equal(overview.acceptance.automaticScheduleChange, false);
  assert.equal(overview.schedule, null);
  assert.equal(calls[1].params[2], 3);
});
