import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { PAPER_ANALYSIS_READ_TOOL } from './agent-paper-analysis-tool.mjs';
import { createAgentPaperArticleGenerationHandlers } from './agent-paper-article-generation.mjs';

export const PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: 'paper.article.draft-shadow',
  workflowVersion: 1,
  inputSchema: 'paper-article-draft-input-v1',
  outputSchema: 'blog-private-draft-output-v1',
  requiredCapabilities: [
    { key: 'research.paper.read', version: 1 },
    { key: 'provider.text.generate', version: 1 },
    { key: 'blog.article.draft', version: 1 },
  ],
  defaultBudget: { providerCalls: 2, toolCalls: 2, inputTokens: 60000,
    outputTokens: 8000, wallClockSeconds: 1200 },
  stages: [
    { key: 'freeze-input', kind: 'deterministic', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30 },
    { key: 'collect-evidence', kind: 'tool', dependsOn: ['freeze-input'], maxAttempts: 2,
      timeoutSeconds: 60, capability: { key: 'research.paper.read', version: 1 }, idempotencyMode: 'key' },
    { key: 'compose', kind: 'provider', dependsOn: ['collect-evidence'], maxAttempts: 2,
      timeoutSeconds: 600, capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' },
    { key: 'verify', kind: 'deterministic', dependsOn: ['compose'], maxAttempts: 1, timeoutSeconds: 120 },
    { key: 'persist-draft', kind: 'domain-write', dependsOn: ['verify'], maxAttempts: 1,
      timeoutSeconds: 60, capability: { key: 'blog.article.draft', version: 1 }, idempotencyMode: 'queryable' },
  ],
});

export class AgentPaperArticleWorkflowError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperArticleWorkflowError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperArticleWorkflowError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizePaperArticleDraftInput(value) {
  const keys = ['schemaVersion', 'analysisId', 'behaviorProfile'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || value.schemaVersion !== 'paper-article-draft-input-v1'
    || !UUID.test(value.analysisId ?? '')
    || (Object.hasOwn(value, 'behaviorProfile')
      && (!value.behaviorProfile || typeof value.behaviorProfile !== 'object'
        || Array.isArray(value.behaviorProfile)))) fail('AGENT_PAPER_ARTICLE_INPUT_INVALID');
  return structuredClone(value);
}

function prerequisite(context, stageKey) {
  const stage = context.prerequisites.find(item => item.stageKey === stageKey && item.status === 'succeeded');
  if (!stage) fail('AGENT_PAPER_ARTICLE_PREREQUISITE_INVALID');
  return stage.outputRef ?? {};
}

function artifactId(result) {
  const id = result?.artifactId ?? result?.responseRef?.artifactId;
  if (!UUID.test(id ?? '')) fail('AGENT_PAPER_ARTICLE_TOOL_ARTIFACT_MISSING');
  return id;
}

export function createAgentPaperArticleDraftHandlers({ toolGateway, providerGateway, artifactRepository,
  draftGateway, researchEvidenceRepository } = {}) {
  if (!toolGateway || !providerGateway || !artifactRepository || !draftGateway
    || !researchEvidenceRepository) fail('AGENT_PAPER_ARTICLE_DEPENDENCY_REQUIRED');
  const workflow = PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.workflowKey;
  const generated = createAgentPaperArticleGenerationHandlers({ providerGateway, artifactRepository,
    workflowKey: workflow });
  return {
    [`${workflow}:freeze-input`]: async context => {
      const input = normalizePaperArticleDraftInput(context.run.input);
      if (stableHash(context.run.input) !== context.run.inputSha256) {
        fail('AGENT_PAPER_ARTICLE_INPUT_HASH_MISMATCH');
      }
      return { outputRef: { schemaVersion: 'paper-article-frozen-input-v1',
        inputSha256: context.run.inputSha256, analysisId: input.analysisId } };
    },

    [`${workflow}:collect-evidence`]: async (context, execution) => {
      const input = normalizePaperArticleDraftInput(context.run.input);
      const frozen = prerequisite(context, 'freeze-input');
      if (frozen.schemaVersion !== 'paper-article-frozen-input-v1'
        || frozen.inputSha256 !== context.run.inputSha256 || frozen.analysisId !== input.analysisId) {
        fail('AGENT_PAPER_ARTICLE_FROZEN_INPUT_INVALID');
      }
      const result = await toolGateway.invoke({
        runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
        leaseToken: execution.leaseToken,
        action: { actionKey: 'read-paper-analysis', actionKind: 'tool',
          capabilityKey: 'research.paper.read', contractVersion: 1, riskLevel: 'L1' },
        idempotencyKey: `paper-article-evidence:${context.run.id}`,
        resource: { type: 'paper.arxiv', owner: context.run.agentUserId, id: input.analysisId },
        tool: { toolKey: PAPER_ANALYSIS_READ_TOOL.toolKey,
          contractVersion: PAPER_ANALYSIS_READ_TOOL.contractVersion },
        request: { analysisId: input.analysisId },
      });
      if (result.status !== 'succeeded') fail('AGENT_PAPER_ARTICLE_TOOL_INCOMPLETE');
      const sourceArtifactId = artifactId(result);
      const archived = await researchEvidenceRepository.archivePaperAnalysisArtifact({
        runId: context.run.id, stageId: context.stage.id, actionId: result.actionId,
        toolArtifactId: sourceArtifactId, workerId: execution.workerId,
        leaseToken: execution.leaseToken,
      });
      if (!archived || archived.evidenceCount < 1) fail('AGENT_PAPER_ARTICLE_EVIDENCE_ARCHIVE_INVALID');
      return { outputRef: { schemaVersion: 'paper-article-evidence-set-ref-v1',
        artifactIds: [sourceArtifactId], researchEvidenceBindingIds: [archived.id],
        analysisId: input.analysisId, evidenceCount: archived.evidenceCount } };
    },

    ...generated,

    [`${workflow}:persist-draft`]: async (context, execution) => {
      const verifiedRef = prerequisite(context, 'verify');
      if (verifiedRef.artifactKey !== 'blog.verification' || verifiedRef.approved !== true
        || !UUID.test(verifiedRef.artifactId ?? '') || !UUID.test(verifiedRef.compositionArtifactId ?? '')) {
        fail('AGENT_PAPER_ARTICLE_VERIFICATION_INVALID');
      }
      const verification = await artifactRepository.read({ runId: context.run.id,
        artifactId: verifiedRef.artifactId, expectedArtifactKey: 'blog.verification' });
      const proof = verification.content;
      if (proof?.schemaVersion !== 'blog-article-verification-v1' || proof.approved !== true
        || proof.compositionArtifactId !== verifiedRef.compositionArtifactId) {
        fail('AGENT_PAPER_ARTICLE_VERIFICATION_INVALID');
      }
      const composition = await artifactRepository.read({ runId: context.run.id,
        artifactId: proof.compositionArtifactId, expectedArtifactKey: 'blog.composition' });
      const packageContent = composition.content;
      if (packageContent?.schemaVersion !== 'blog-article-composition-v1'
        || proof.contentSha256 !== composition.contentSha256
        || stableHash(packageContent.sourceToolArtifactIds) !== stableHash(proof.sourceToolArtifactIds)) {
        fail('AGENT_PAPER_ARTICLE_COMPOSITION_INVALID');
      }
      const draft = await draftGateway.persist({
        agentUserId: context.run.agentUserId, runId: context.run.id, stageId: context.stage.id,
        workerId: execution.workerId, leaseToken: execution.leaseToken,
        idempotencyKey: `paper-article-private-draft:${context.run.id}`,
        content: packageContent.content, sourceArtifactIds: packageContent.sourceToolArtifactIds,
        verificationArtifactId: verification.id,
      });
      if (draft.status !== 'succeeded' || draft.publicationState !== 'draft') {
        fail('AGENT_PAPER_ARTICLE_DRAFT_INCOMPLETE');
      }
      return { outputRef: { articleId: draft.articleId, revisionId: draft.revisionId,
        publicationState: 'draft', verificationArtifactId: verification.id,
        compositionArtifactId: composition.id, sourceArtifactIds: packageContent.sourceToolArtifactIds,
        contentSha256: draft.contentSha256 },
      runOutput: { type: 'blog.private-draft', id: draft.articleId } };
    },
  };
}
