import { blogRequestHash, normalizeBlogContent } from './blog-contract.mjs';

export class AgentBlogFoundationDraftError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentBlogFoundationDraftError';
    this.code = code;
  }
}

const fail = (code, cause) => { throw new AgentBlogFoundationDraftError(code, cause); };
const ACTION = Object.freeze({
  actionKey: 'persist-draft', actionKind: 'domain-write', capabilityKey: 'blog.article.draft',
  contractVersion: 1, riskLevel: 'L2',
});
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const normalizeArtifactIds = value => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32
    || value.some(item => typeof item !== 'string' || !uuidPattern.test(item))
    || new Set(value).size !== value.length) fail('AGENT_BLOG_DRAFT_SOURCE_ARTIFACTS_INVALID');
  return [...value];
};

export function createAgentBlogFoundationDraftGateway({ runtimeRepository, draftRepository, policyService } = {}) {
  if (!runtimeRepository || !draftRepository || !policyService) fail('AGENT_BLOG_DRAFT_GATEWAY_DEPENDENCY_REQUIRED');
  return {
    async persist({ agentUserId, runId, stageId, workerId, leaseToken, idempotencyKey, content: input,
      sourceArtifactIds: inputIds, verificationArtifactId }) {
      if (typeof agentUserId !== 'string' || !uuidPattern.test(agentUserId)) fail('AGENT_BLOG_DRAFT_AGENT_INVALID');
      if (typeof verificationArtifactId !== 'string' || !uuidPattern.test(verificationArtifactId)) {
        fail('AGENT_BLOG_DRAFT_VERIFICATION_INVALID');
      }
      let content;
      try { content = normalizeBlogContent(input); } catch (error) { fail(error.code ?? 'AGENT_BLOG_DRAFT_CONTENT_INVALID', error); }
      const sourceArtifactIds = normalizeArtifactIds(inputIds);
      const contentSha256 = blogRequestHash(content);
      const resource = { type: 'blog.private-draft', owner: agentUserId };
      const decision = await policyService.decide({ runId, stageId, action: ACTION, resource });
      if (decision.agentUserId !== agentUserId) fail('AGENT_BLOG_DRAFT_AGENT_MISMATCH');
      const prepared = await runtimeRepository.createAction({
        runId, stageId, action: ACTION, idempotencyKey,
        request: { schemaVersion: 'blog-private-draft-request-v1', slug: content.slug,
          locale: content.locale, contentSha256, sourceArtifactIds, verificationArtifactId },
        policyDecision: decision,
      });
      const existing = prepared.existing ? await draftRepository.getByAction(prepared.id) : null;
      if (existing) return { status: 'succeeded', replayed: true, ...existing };
      if (decision.decision === 'deny') {
        if (!prepared.existing) await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'prepared', to: 'rejected',
          errorCode: 'AGENT_POLICY_DENIED', errorMessage: decision.reasonCodes.join(',') });
        fail('AGENT_POLICY_DENIED');
      }
      if (decision.decision === 'require-confirmation') {
        if (prepared.existing) fail('AGENT_BLOG_DRAFT_ACTION_IN_PROGRESS');
        await runtimeRepository.waitForActionConfirmation({ actionId: prepared.id, stageId, workerId, leaseToken });
        return { status: 'waiting-confirmation', actionId: prepared.id, decision };
      }
      if (!prepared.existing) {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'prepared', to: 'authorized' });
      } else if (prepared.status !== 'authorized') fail('AGENT_BLOG_DRAFT_ACTION_IN_PROGRESS');
      try {
        const draft = await draftRepository.persist({ actionId: prepared.id, content, contentSha256,
          sourceArtifactIds, verificationArtifactId });
        return { status: 'succeeded', replayed: draft.existing, ...draft };
      } catch (error) {
        try {
          await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'authorized', to: 'failed',
            errorCode: String(error?.code ?? 'AGENT_BLOG_DRAFT_PERSIST_FAILED').slice(0, 120),
            errorMessage: String(error?.message ?? error).slice(0, 500) });
        } catch {}
        throw error;
      }
    },
  };
}
