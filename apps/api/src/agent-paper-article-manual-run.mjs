import { PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW,
  normalizePaperArticleDraftInput } from './agent-paper-article-workflow.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AgentPaperArticleManualRunError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AgentPaperArticleManualRunError';
    this.code = code;
    this.details = details;
    this.retryable = false;
  }
}

const fail = (code, details) => { throw new AgentPaperArticleManualRunError(code, details); };

async function executeRun({ worker, runId }) {
  let terminal = null;
  try {
    for (let index = 0; index < PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.stages.length; index += 1) {
      const result = await worker.runOnce();
      if (result?.status !== 'completed') {
        fail('AGENT_PAPER_ARTICLE_STAGE_INCOMPLETE', { runId, stageNumber: index + 1,
          workerStatus: result?.status ?? 'unknown', stageKey: result?.stage?.stageKey ?? null,
          stageErrorCode: result?.stage?.errorCode ?? result?.error?.code ?? null });
      }
      if (result.run) terminal = result.run;
    }
  } finally {
    await worker.stop();
  }
  if (!terminal || terminal.id !== runId || terminal.status !== 'succeeded'
    || terminal.outputType !== 'blog.private-draft' || !UUID.test(terminal.outputId ?? '')) {
    fail('AGENT_PAPER_ARTICLE_OUTPUT_INVALID', { runId });
  }
  return terminal;
}

export function createAgentPaperArticleManualRunner({ config, inputRepository, runtimeRepository,
  createWorker, readRun } = {}) {
  if (!config || !inputRepository || !runtimeRepository || typeof createWorker !== 'function'
    || typeof readRun !== 'function') {
    fail('AGENT_PAPER_ARTICLE_RUNTIME_DEPENDENCY_REQUIRED');
  }
  return Object.freeze({
    async run({ analysisId, requestId }) {
      if (!UUID.test(analysisId ?? '') || !UUID.test(requestId ?? '')) {
        fail('AGENT_PAPER_ARTICLE_RUNTIME_INPUT_INVALID');
      }
      const frozen = await inputRepository.snapshot(config.agentUserId);
      if (frozen?.schemaVersion !== 'agent-blog-private-canary-input-snapshot-v2'
        || frozen.agentUserId !== config.agentUserId || frozen.configuredModelId !== config.modelId) {
        fail('AGENT_PAPER_ARTICLE_RUNTIME_CONFIG_DRIFT');
      }
      const input = normalizePaperArticleDraftInput({ schemaVersion: 'paper-article-draft-input-v1',
        analysisId, behaviorProfile: frozen.behaviorProfile });
      const run = await runtimeRepository.createRun({ agentUserId: config.agentUserId,
        workflowKey: PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.workflowKey,
        workflowVersion: PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.workflowVersion,
        triggerKind: 'manual', triggerRef: requestId,
        idempotencyKey: `paper-article:${analysisId}:${requestId}`, input,
        config: { model: { provider: config.provider, modelId: config.modelId },
          behaviorProfileId: frozen.behaviorProfileId,
          behaviorProfileVersion: frozen.behaviorProfileVersion } });
      let terminal = run.existing === true ? await readRun(run.id) : null;
      if (!terminal || !['succeeded', 'failed', 'rejected', 'cancelled', 'uncertain'].includes(terminal.status)) {
        terminal = await executeRun({ worker: createWorker(run.id, requestId), runId: run.id });
      }
      if (terminal.status !== 'succeeded' || terminal.outputType !== 'blog.private-draft'
        || !UUID.test(terminal.outputId ?? '')) {
        fail('AGENT_PAPER_ARTICLE_OUTPUT_INVALID', { runId: run.id,
          status: terminal.status, errorCode: terminal.errorCode ?? null });
      }
      return Object.freeze({ schemaVersion: 'agent-paper-article-manual-run-result-v1', requestId,
        agentUserId: config.agentUserId, analysisId, runId: run.id, articleId: terminal.outputId,
        publicationState: 'draft', publicationAttempted: false,
        behaviorProfileVersion: frozen.behaviorProfileVersion });
    },
  });
}
