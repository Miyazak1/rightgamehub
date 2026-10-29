const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/agent-blog-canary-acceptance.mjs'));
const ids = {
  agent: '11111111-1111-4111-8111-111111111111', discovery: '22222222-2222-4222-8222-222222222222',
  candidate: '33333333-3333-4333-8333-333333333333', handoff: '44444444-4444-4444-8444-444444444444',
  draft: '55555555-5555-4555-8555-555555555555', article: '66666666-6666-4666-8666-666666666666',
  verify: '77777777-7777-4777-8777-777777777777', compose: '88888888-8888-4888-8888-888888888888',
};

function evidence() {
  return {
    schemaVersion: 'agent-blog-canary-evidence-v1', agentUserId: ids.agent,
    discovery: { id: ids.discovery, workflowKey: 'blog.project.discovery-shadow', workflowVersion: 3,
      triggerRef: '99999999-9999-4999-8999-999999999999', status: 'succeeded',
      outputType: 'blog.candidate-set', outputId: ids.candidate },
    handoff: { id: ids.handoff, sourceRunId: ids.discovery, sourceArtifactId: ids.candidate, targetRunId: ids.draft },
    draft: { id: ids.draft, workflowKey: 'blog.project.single.draft-shadow', workflowVersion: 2,
      triggerRef: '99999999-9999-4999-8999-999999999999', status: 'succeeded',
      outputType: 'blog.private-draft', outputId: ids.article },
    execution: { discoveryStages: 4, draftStages: 6, nonSucceededStages: 0, stageRetries: 0,
      nonSucceededActions: 0, publishStages: 0, publishActions: 0, wallClockSeconds: 240 },
    publication: { articleId: ids.article, state: 'draft', revisionState: 'working',
      publishedRevisionId: null, publishEvents: 0 },
    lineage: { candidateHashMatches: true, inputHashMatches: true, sourceArtifactCount: 1,
      verificationArtifactId: ids.verify, compositionArtifactId: ids.compose },
    usage: { providerCalls: 3, toolCalls: 3, failedOrUncertainProviderCalls: 0,
      failedOrUncertainToolCalls: 0, inputTokens: 1200, outputTokens: 2400, costMicrousd: 5000 },
  };
}

test('canary acceptance passes only a complete private evidence graph', async () => {
  const { evaluateAgentBlogCanaryAcceptance } = await import(moduleUrl.href);
  const result = evaluateAgentBlogCanaryAcceptance(evidence());
  assert.equal(result.verdict, 'passed');
  assert.deepEqual(result.reasonCodes, []);
  assert.match(result.evidenceSha256, /^[a-f0-9]{64}$/u);
  assert.match(result.reportSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Object.hasOwn(result, 'content'), false);
});

test('canary acceptance exposes deterministic reason codes without article or provider content', async () => {
  const { evaluateAgentBlogCanaryAcceptance } = await import(moduleUrl.href);
  const input = evidence();
  input.execution.publishActions = 1;
  input.execution.stageRetries = 1;
  input.publication.state = 'published';
  input.publication.publishEvents = 1;
  input.usage.providerCalls = 4;
  const result = evaluateAgentBlogCanaryAcceptance(input);
  assert.equal(result.verdict, 'failed');
  assert.deepEqual(result.reasonCodes, ['STAGE_RETRY_OBSERVED', 'PUBLISH_AUTHORITY_OBSERVED',
    'DRAFT_NOT_PRIVATE', 'PROVIDER_CALL_COUNT_INVALID']);
  assert.deepEqual(Object.keys(result.metrics), ['wallClockSeconds', 'stageRetries', 'providerCalls',
    'toolCalls', 'inputTokens', 'outputTokens', 'costMicrousd']);
});

test('acceptance service is idempotent and three passes only recommend a schedule review', async () => {
  const { createAgentBlogCanaryAcceptanceService } = await import(moduleUrl.href);
  const reports = [1, 2, 3].map(index => ({ id: String(index), verdict: 'passed' }));
  const repository = {
    async snapshot() { return evidence(); },
    async persist({ evaluation }) { return { id: 'report', verdict: evaluation.verdict, existing: false }; },
    async recent() { return reports; },
  };
  const service = createAgentBlogCanaryAcceptanceService({ repository });
  assert.equal((await service.attest(ids.agent, ids.draft)).recommendation,
    'retain-private-and-collect-more-samples');
  assert.deepEqual(await service.readiness(ids.agent), {
    schemaVersion: 'agent-blog-canary-readiness-v1', policyVersion: 2,
    requiredConsecutivePasses: 3, consecutivePasses: 3,
    readyForShadowScheduleReview: true, automaticScheduleChange: false,
  });
});

test('non-terminal canary graphs cannot be attested', async () => {
  const { evaluateAgentBlogCanaryAcceptance } = await import(moduleUrl.href);
  const input = evidence(); input.draft.status = 'running';
  assert.throws(() => evaluateAgentBlogCanaryAcceptance(input),
    /AGENT_BLOG_CANARY_ACCEPTANCE_NOT_TERMINAL/u);
});
