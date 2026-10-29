import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { PAPER_SEMANTIC_EXTRACTION_SCHEMA, PAPER_SEMANTIC_VERIFICATION_SCHEMA,
  PAPER_SEMANTIC_WORKFLOW_KEY, validatePaperSemanticExtractionV1,
  verifyPaperSemanticExtraction } from './agent-paper-semantic-contracts.mjs';
import { normalizePaperSemanticRunInput, reconstructPaperSections }
  from './agent-paper-semantic-workflow.mjs';

export const PAPER_SEMANTIC_POLICY_VERSION = 'paper-semantic-evidence-gate-v1';
export const PAPER_SEMANTIC_PROMPT_VERSION = 'paper-semantic-reader-v1';

export class AgentPaperSemanticRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperSemanticRuntimeError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperSemanticRuntimeError(code); };

const PAPER_SEMANTIC_PROMPT = `你是小墨鱼的私有论文阅读器。输入只会包含公开 arXiv 全文中的有界证据。你只能依据 evidenceIndex 工作，不得使用外部知识补全事实。
严格返回指定 JSON：
1. author_claim 只表示作者明确主张；observed_result 只表示论文报告的实验或观测结果；xiaomoyu_inference 必须明确保持为系统推断；证据不足用 unknown；冲突用 conflict。
2. 非 unknown 结论必须引用一个或多个 evidenceIndex，并至少有一条 supports 关系；conflict 还必须有 contradicts。
3. 不得创造证据编号、链接、数字、论文结构或作者结论。
4. sections 必须原样复述 suppliedSections 的 key、title、level、evidenceIndexes；这些只是确定性页窗，不代表真实语义标题。
5. 输出 3 到 8 个可继续研究的问题。回答使用简体中文，但 JSON key 不得改变。`;

function prerequisite(context, stageKey) {
  const stage = context.prerequisites.find(item => item.stageKey === stageKey && item.status === 'succeeded');
  if (!stage) fail('AGENT_PAPER_SEMANTIC_PREREQUISITE_INVALID');
  return stage.outputRef ?? {};
}

function modelPolicy(context) {
  const config = context.run.configSnapshot?.model ?? {};
  return { taskClass: 'paper-semantic-analysis', requiresJsonSchema: true,
    maxInputTokens: 60000, maxOutputTokens: 7000, maxCostMicrousd: 50_000_000,
    latencyClass: 'batch',
    ...(typeof config.provider === 'string' ? { preferredProvider: config.provider } : {}),
    ...(typeof config.modelId === 'string' ? { preferredModel: config.modelId } : {}) };
}

const estimatedTokens = value => Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value)) / 3));
const sectionProjection = sections => sections.map(({ key, title, level, evidenceIndexes }) => ({
  key, title, level, evidenceIndexes,
}));

export function createAgentPaperSemanticHandlers({ repository, providerGateway,
  artifactRepository, semanticGateway } = {}) {
  if (!repository || !providerGateway || !artifactRepository || !semanticGateway) {
    fail('AGENT_PAPER_SEMANTIC_DEPENDENCY_REQUIRED');
  }
  return Object.freeze({
    [`${PAPER_SEMANTIC_WORKFLOW_KEY}:verify-eligibility`]: async context => {
      const input = normalizePaperSemanticRunInput(context.run.input);
      if (stableHash(context.run.input) !== context.run.inputSha256) fail('AGENT_PAPER_SEMANTIC_INPUT_HASH_MISMATCH');
      const source = await repository.loadTrustedPaper({ agentUserId: context.run.agentUserId,
        paperVersionId: input.paperVersionId });
      if (source.externalProcessingClass !== 'public-arxiv-open-fulltext') {
        fail('AGENT_PAPER_SEMANTIC_EXTERNAL_PROCESSING_FORBIDDEN');
      }
      return { outputRef: { schemaVersion: 'paper-semantic-eligibility-ref-v1',
        paperVersionId: input.paperVersionId, sourceContentSha256: source.contentSha256,
        layoutSha256: source.layoutSha256, parseAssessmentSha256: source.parseAssessmentSha256,
        evidenceManifestSha256: source.evidenceManifestSha256,
        evidenceCount: source.evidence.length, eligible: true,
        externalProcessingClass: source.externalProcessingClass,
        publicPublicationEnabled: false } };
    },

    [`${PAPER_SEMANTIC_WORKFLOW_KEY}:reconstruct-sections`]: async context => {
      const input = normalizePaperSemanticRunInput(context.run.input);
      const eligible = prerequisite(context, 'verify-eligibility');
      const source = await repository.loadTrustedPaper({ agentUserId: context.run.agentUserId,
        paperVersionId: input.paperVersionId });
      if (eligible.eligible !== true || eligible.externalProcessingClass !== source.externalProcessingClass
        || eligible.paperVersionId !== source.paperVersionId
        || eligible.sourceContentSha256 !== source.contentSha256 || eligible.layoutSha256 !== source.layoutSha256
        || eligible.parseAssessmentSha256 !== source.parseAssessmentSha256
        || eligible.evidenceManifestSha256 !== source.evidenceManifestSha256
        || eligible.evidenceCount !== source.evidence.length) fail('AGENT_PAPER_SEMANTIC_SOURCE_DRIFT');
      const manifest = reconstructPaperSections(source.evidence);
      return { outputRef: { ...manifest, paperVersionId: source.paperVersionId,
        evidenceManifestSha256: source.evidenceManifestSha256 } };
    },

    [`${PAPER_SEMANTIC_WORKFLOW_KEY}:extract-semantics`]: async (context, execution) => {
      const input = normalizePaperSemanticRunInput(context.run.input);
      const sectionRef = prerequisite(context, 'reconstruct-sections');
      const source = await repository.loadTrustedPaper({ agentUserId: context.run.agentUserId,
        paperVersionId: input.paperVersionId });
      if (source.externalProcessingClass !== 'public-arxiv-open-fulltext') {
        fail('AGENT_PAPER_SEMANTIC_EXTERNAL_PROCESSING_FORBIDDEN');
      }
      const sectionManifest = reconstructPaperSections(source.evidence);
      if (sectionRef.paperVersionId !== source.paperVersionId
        || sectionRef.evidenceManifestSha256 !== source.evidenceManifestSha256
        || sectionRef.manifestSha256 !== sectionManifest.manifestSha256) fail('AGENT_PAPER_SEMANTIC_SOURCE_DRIFT');
      const requestPayload = { schemaVersion: 'paper-semantic-provider-request-v1',
        externalProcessingClass: source.externalProcessingClass, paper: source.identity,
        suppliedSections: sectionProjection(sectionManifest.sections),
        evidence: source.evidence.map(item => ({ evidenceIndex: item.index,
          quoteText: Array.from(item.quoteText).slice(0, 1200).join(''), locator: item.locator })) };
      const result = await providerGateway.invoke({ runId: context.run.id, stageId: context.stage.id,
        workerId: execution.workerId, leaseToken: execution.leaseToken,
        action: { actionKey: 'extract-semantics', actionKind: 'provider',
          capabilityKey: 'provider.text.generate', contractVersion: 1, riskLevel: 'L2' },
        idempotencyKey: `paper-semantic:${context.run.id}`,
        resource: { type: 'provider.model', owner: context.run.agentUserId },
        modelPolicy: modelPolicy(context), promptTemplate: { key: 'paper.semantic.reader', version: 1 },
        responseSchema: PAPER_SEMANTIC_EXTRACTION_SCHEMA,
        request: { messages: [{ role: 'system', content: PAPER_SEMANTIC_PROMPT },
          { role: 'user', content: JSON.stringify(requestPayload) }], temperature: 0.1 },
        tokenCeiling: 7000, timeoutSeconds: 540, estimatedInputTokens: estimatedTokens(requestPayload) });
      if (result.status !== 'succeeded') fail('AGENT_PAPER_SEMANTIC_PROVIDER_INCOMPLETE');
      const extraction = validatePaperSemanticExtractionV1(result.output);
      if (stableHash(extraction.sections) !== stableHash(sectionProjection(sectionManifest.sections))) {
        fail('AGENT_PAPER_SEMANTIC_SECTION_DRIFT');
      }
      const artifact = await artifactRepository.save({ runId: context.run.id, stageId: context.stage.id,
        workerId: execution.workerId, leaseToken: execution.leaseToken, actionId: result.actionId,
        artifactKey: 'paper.semantic-extraction', artifactKind: 'validated-output',
        schema: PAPER_SEMANTIC_EXTRACTION_SCHEMA, content: extraction });
      return { outputRef: { schemaVersion: 'paper-semantic-extraction-ref-v1', artifactId: artifact.id,
        artifactKey: artifact.artifactKey, contentSha256: artifact.contentSha256,
        provider: result.provider, modelId: result.modelId,
        sectionManifestSha256: sectionManifest.manifestSha256,
        evidenceManifestSha256: source.evidenceManifestSha256 } };
    },

    [`${PAPER_SEMANTIC_WORKFLOW_KEY}:verify-semantics`]: async (context, execution) => {
      const input = normalizePaperSemanticRunInput(context.run.input);
      const extracted = prerequisite(context, 'extract-semantics');
      const source = await repository.loadTrustedPaper({ agentUserId: context.run.agentUserId,
        paperVersionId: input.paperVersionId });
      const sectionManifest = reconstructPaperSections(source.evidence);
      if (extracted.artifactKey !== 'paper.semantic-extraction'
        || extracted.evidenceManifestSha256 !== source.evidenceManifestSha256
        || extracted.sectionManifestSha256 !== sectionManifest.manifestSha256) fail('AGENT_PAPER_SEMANTIC_SOURCE_DRIFT');
      const artifact = await artifactRepository.read({ runId: context.run.id,
        artifactId: extracted.artifactId, expectedArtifactKey: 'paper.semantic-extraction' });
      const verified = verifyPaperSemanticExtraction({ extraction: artifact.content, evidence: source.evidence });
      const { analysisSha256: ignored, ...verifiedBody } = verified;
      const proofBody = { ...verifiedBody, paperVersionId: source.paperVersionId, sectionManifest,
        provider: extracted.provider, modelId: extracted.modelId,
        policyVersion: PAPER_SEMANTIC_POLICY_VERSION, promptVersion: PAPER_SEMANTIC_PROMPT_VERSION,
        externalProcessingClass: source.externalProcessingClass, publicPublicationEnabled: false };
      const proof = { ...proofBody, analysisSha256: stableHash(proofBody) };
      const verification = await artifactRepository.save({ runId: context.run.id,
        stageId: context.stage.id, workerId: execution.workerId, leaseToken: execution.leaseToken,
        artifactKey: 'paper.semantic-verification', artifactKind: 'verification',
        schema: PAPER_SEMANTIC_VERIFICATION_SCHEMA, content: proof,
        sourceStageArtifactIds: [artifact.id] });
      return { outputRef: { schemaVersion: 'paper-semantic-verification-ref-v1',
        artifactId: verification.id, artifactKey: verification.artifactKey,
        analysisSha256: proof.analysisSha256, approved: true, paperVersionId: source.paperVersionId } };
    },

    [`${PAPER_SEMANTIC_WORKFLOW_KEY}:persist-analysis`]: async (context, execution) => {
      const verified = prerequisite(context, 'verify-semantics');
      if (verified.approved !== true || verified.artifactKey !== 'paper.semantic-verification') {
        fail('AGENT_PAPER_SEMANTIC_VERIFICATION_INVALID');
      }
      const artifact = await artifactRepository.read({ runId: context.run.id,
        artifactId: verified.artifactId, expectedArtifactKey: 'paper.semantic-verification' });
      if (artifact.content?.analysisSha256 !== verified.analysisSha256
        || artifact.content?.paperVersionId !== verified.paperVersionId) fail('AGENT_PAPER_SEMANTIC_VERIFICATION_INVALID');
      const saved = await semanticGateway.persist({ agentUserId: context.run.agentUserId,
        runId: context.run.id, stageId: context.stage.id, workerId: execution.workerId,
        leaseToken: execution.leaseToken, verificationArtifactId: artifact.id, analysis: artifact.content });
      if (!saved?.id) fail('AGENT_PAPER_SEMANTIC_PERSIST_INCOMPLETE');
      return { outputRef: { analysisId: saved.id, paperVersionId: saved.paperVersionId,
        analysisSha256: saved.analysisSha256, private: true, publicationAttempted: false },
      runOutput: { type: 'paper.semantic-analysis', id: saved.id } };
    },
  });
}
