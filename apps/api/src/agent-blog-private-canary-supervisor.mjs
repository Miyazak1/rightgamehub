const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AgentBlogPrivateCanarySupervisorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogPrivateCanarySupervisorError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogPrivateCanarySupervisorError(code); };

export function createAgentBlogPrivateCanarySupervisor({ runner, acceptanceService } = {}) {
  if (!runner || typeof runner.run !== 'function' || !acceptanceService
    || typeof acceptanceService.attest !== 'function' || typeof acceptanceService.readiness !== 'function') {
    fail('AGENT_BLOG_PRIVATE_CANARY_SUPERVISOR_DEPENDENCY_REQUIRED');
  }
  return {
    async run({ requestId }) {
      const canary = await runner.run({ requestId });
      if (canary?.schemaVersion !== 'agent-blog-private-canary-result-v1'
        || !UUID.test(canary.agentUserId ?? '') || !UUID.test(canary.draft?.runId ?? '')
        || canary.draft?.publicationState !== 'draft' || canary.publicationAttempted !== false) {
        fail('AGENT_BLOG_PRIVATE_CANARY_SUPERVISOR_RESULT_INVALID');
      }
      const report = await acceptanceService.attest(canary.agentUserId, canary.draft.runId);
      const readiness = await acceptanceService.readiness(canary.agentUserId);
      if (readiness?.automaticScheduleChange !== false) {
        fail('AGENT_BLOG_PRIVATE_CANARY_SUPERVISOR_SCHEDULE_AUTHORITY_FORBIDDEN');
      }
      return Object.freeze({
        schemaVersion: 'agent-blog-private-canary-supervised-result-v1',
        canary,
        acceptance: report,
        readiness,
        safeToReviewPrivateDraft: report?.verdict === 'passed',
        scheduleDecision: 'unchanged',
        publicationAttempted: false,
      });
    },
  };
}
