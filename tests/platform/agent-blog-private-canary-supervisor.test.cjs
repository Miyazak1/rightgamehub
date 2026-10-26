const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/agent-blog-private-canary-supervisor.mjs'));
const requestId = '11111111-1111-4111-8111-111111111111';
const agentUserId = '22222222-2222-4222-8222-222222222222';
const draftRunId = '33333333-3333-4333-8333-333333333333';

function fixture({ verdict = 'passed', automaticScheduleChange = false } = {}) {
  const events = [];
  return { events,
    runner: { async run(input) { events.push(`run:${input.requestId}`); return {
      schemaVersion: 'agent-blog-private-canary-result-v1', requestId, agentUserId,
      discovery: { runId: '44444444-4444-4444-8444-444444444444' },
      draft: { runId: draftRunId, articleId: '55555555-5555-4555-8555-555555555555',
        publicationState: 'draft' }, publicationAttempted: false,
    }; } },
    acceptanceService: {
      async attest(agent, run) { events.push(`attest:${agent}:${run}`); return {
        id: '66666666-6666-4666-8666-666666666666', verdict,
        reasonCodes: verdict === 'passed' ? [] : ['DRAFT_NOT_PRIVATE'],
      }; },
      async readiness(agent) { events.push(`readiness:${agent}`); return {
        consecutivePasses: verdict === 'passed' ? 1 : 0,
        readyForShadowScheduleReview: false, automaticScheduleChange,
      }; },
    },
  };
}

test('supervisor runs one canary, persists its report, and never changes scheduling', async () => {
  const { createAgentBlogPrivateCanarySupervisor } = await import(moduleUrl.href);
  const value = fixture();
  const result = await createAgentBlogPrivateCanarySupervisor(value).run({ requestId });
  assert.deepEqual(value.events, [`run:${requestId}`, `attest:${agentUserId}:${draftRunId}`,
    `readiness:${agentUserId}`]);
  assert.equal(result.acceptance.verdict, 'passed');
  assert.equal(result.safeToReviewPrivateDraft, true);
  assert.equal(result.scheduleDecision, 'unchanged');
  assert.equal(result.publicationAttempted, false);
});

test('failed attestation stays private and returns a review stop rather than changing scheduling', async () => {
  const { createAgentBlogPrivateCanarySupervisor } = await import(moduleUrl.href);
  const result = await createAgentBlogPrivateCanarySupervisor(fixture({ verdict: 'failed' }))
    .run({ requestId });
  assert.equal(result.acceptance.verdict, 'failed');
  assert.equal(result.safeToReviewPrivateDraft, false);
  assert.equal(result.scheduleDecision, 'unchanged');
});

test('supervisor rejects any acceptance implementation that claims schedule authority', async () => {
  const { createAgentBlogPrivateCanarySupervisor } = await import(moduleUrl.href);
  await assert.rejects(() => createAgentBlogPrivateCanarySupervisor(
    fixture({ automaticScheduleChange: true })).run({ requestId }),
  error => error.code === 'AGENT_BLOG_PRIVATE_CANARY_SUPERVISOR_SCHEDULE_AUTHORITY_FORBIDDEN');
});
