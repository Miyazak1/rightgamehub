export class AgentBlogFoundationPublicationError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentBlogFoundationPublicationError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = (code, cause) => { throw new AgentBlogFoundationPublicationError(code, cause); };
const ACTION = Object.freeze({
  actionKey: 'publish', actionKind: 'domain-write', capabilityKey: 'blog.article.publish',
  contractVersion: 1, riskLevel: 'L3',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createAgentBlogFoundationPublicationGateway({
  runtimeRepository, publicationRepository, policyService,
} = {}) {
  if (!runtimeRepository || !publicationRepository || !policyService) {
    fail('AGENT_BLOG_PUBLICATION_GATEWAY_DEPENDENCY_REQUIRED');
  }
  return {
    async publish({ agentUserId, runId, stageId, workerId, leaseToken, idempotencyKey,
      articleId, revisionId, contentSha256 }) {
      if (![agentUserId, runId, stageId, articleId, revisionId].every(value => UUID.test(value ?? ''))
        || typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256)) {
        fail('AGENT_BLOG_PUBLICATION_INPUT_INVALID');
      }
      const resource = { type: 'blog.article', owner: agentUserId, id: articleId };
      const decision = await policyService.decide({ runId, stageId, action: ACTION, resource });
      if (decision.agentUserId !== agentUserId) fail('AGENT_BLOG_PUBLICATION_AGENT_MISMATCH');
      const prepared = await runtimeRepository.createAction({
        runId, stageId, action: ACTION, idempotencyKey,
        request: { schemaVersion: 'blog-foundation-publication-request-v1', articleId,
          revisionId, contentSha256 }, policyDecision: decision,
      });
      const existing = prepared.existing
        ? await publicationRepository.getByAction(prepared.id) : null;
      if (existing) return { status: 'succeeded', replayed: true, ...existing };
      if (decision.decision === 'deny') {
        if (!prepared.existing) await runtimeRepository.transitionAction({
          actionId: prepared.id, from: 'prepared', to: 'rejected',
          errorCode: 'AGENT_POLICY_DENIED', errorMessage: decision.reasonCodes.join(','),
        });
        fail('AGENT_POLICY_DENIED');
      }
      if (decision.decision === 'require-confirmation') {
        if (prepared.existing) fail('AGENT_BLOG_PUBLICATION_ACTION_IN_PROGRESS');
        await runtimeRepository.waitForActionConfirmation({
          actionId: prepared.id, stageId, workerId, leaseToken,
        });
        return { status: 'waiting-confirmation', actionId: prepared.id, decision };
      }
      if (!prepared.existing) {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'prepared', to: 'authorized' });
      } else if (prepared.status !== 'authorized') fail('AGENT_BLOG_PUBLICATION_ACTION_IN_PROGRESS');
      try {
        const publication = await publicationRepository.publish({
          actionId: prepared.id, articleId, revisionId, contentSha256,
        });
        return { status: 'succeeded', replayed: publication.existing, ...publication };
      } catch (error) {
        try {
          await runtimeRepository.transitionAction({
            actionId: prepared.id, from: 'authorized', to: 'failed',
            errorCode: String(error?.code ?? 'AGENT_BLOG_PUBLICATION_FAILED').slice(0, 120),
            errorMessage: String(error?.message ?? error).slice(0, 500),
          });
        } catch {}
        throw error;
      }
    },
  };
}
