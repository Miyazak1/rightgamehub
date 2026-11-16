import { runAgentBlogPublicRuntimePreflight } from './agent-blog-public-runtime-preflight.mjs';
import { AGENT_GITHUB_RESEARCH_LIMITS } from './agent-github-research-runtime.mjs';
import { BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW, BLOG_PROJECT_SINGLE_WORKFLOW } from './agent-blog-foundation-workflows.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class AgentBlogPublicRuntimeManualRunError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AgentBlogPublicRuntimeManualRunError';
    this.code = code;
    this.details = details;
    this.retryable = false;
  }
}

const fail = (code, details) => { throw new AgentBlogPublicRuntimeManualRunError(code, details); };

export async function executeAgentBlogPublicRun({ worker, workflow, outputType, runId,
  now = Date.now, sleep = delay, readRun = null }) {
  const expectedStageCount = workflow.stages.length;
  const maxAttempts = workflow.stages.reduce((sum, stage) => sum + stage.maxAttempts, 0);
  const deadline = now() + workflow.defaultBudget.wallClockSeconds * 1000;
  let terminal = null, completed = 0, attempts = 0, waitingRetry = false;
  try {
    while (completed < expectedStageCount) {
      if (now() >= deadline || attempts >= maxAttempts) {
        fail('AGENT_BLOG_PUBLIC_RUNTIME_EXECUTION_LIMIT', { runId });
      }
      let result;
      try { result = await worker.runOnce(); }
      catch (error) { result = { status: 'worker-error', error }; }
      if (result?.status !== 'completed' && readRun) {
        // The final stage can commit before the worker loses its acknowledgement.
        const persisted = await readRun(runId);
        if (persisted?.id === runId && persisted.status === 'succeeded'
          && persisted.outputType === outputType && UUID.test(persisted.outputId ?? '')) {
          terminal = persisted;
          break;
        }
      }
      if (result?.status === 'retry-scheduled' && result.error?.uncertain !== true
        && result.stage?.status === 'queued') {
        attempts += 1;
        waitingRetry = true;
        const due = Date.parse(result.stage.availableAt);
        await sleep(Math.min(Math.max(250, Number.isFinite(due) ? due - now() : 1000),
          Math.max(0, deadline - now())));
        continue;
      }
      if (result?.status === 'idle' && waitingRetry) {
        await sleep(Math.min(250, Math.max(0, deadline - now())));
        continue;
      }
      if (result?.status !== 'completed') {
        fail('AGENT_BLOG_PUBLIC_RUNTIME_STAGE_INCOMPLETE', { runId, stageNumber: completed + 1,
          workerStatus: result?.status ?? 'unknown', stageKey: result?.stage?.stageKey ?? null,
          stageErrorCode: result?.stage?.errorCode ?? result?.error?.code ?? null });
      }
      attempts += 1;
      completed += 1;
      waitingRetry = false;
      if (result.run) terminal = result.run;
    }
  } finally {
    await worker.stop();
  }
  if (!terminal || terminal.id !== runId || terminal.status !== 'succeeded'
    || terminal.outputType !== outputType || !UUID.test(terminal.outputId ?? '')) {
    fail('AGENT_BLOG_PUBLIC_RUNTIME_OUTPUT_INVALID', { runId, expectedOutputType: outputType });
  }
  return terminal;
}

export function createAgentBlogPublicRuntimeManualRunner({
  config, preflightRepository, inputRepository, discoveryCanary, publicHandoff,
  createDiscoveryWorker, createPublicationWorker, readRun = null,
} = {}) {
  if (!config || !preflightRepository || !inputRepository || !discoveryCanary || !publicHandoff
    || typeof createDiscoveryWorker !== 'function' || typeof createPublicationWorker !== 'function'
    || (readRun !== null && typeof readRun !== 'function')) {
    fail('AGENT_BLOG_PUBLIC_RUNTIME_DEPENDENCY_REQUIRED');
  }
  return {
    async run({ requestId, triggerKind = 'manual', triggerRef = requestId }) {
      if (!UUID.test(requestId ?? '')) fail('AGENT_BLOG_PUBLIC_RUNTIME_REQUEST_ID_INVALID');
      if (!['manual', 'schedule'].includes(triggerKind) || typeof triggerRef !== 'string'
        || triggerRef.length < 1 || triggerRef.length > 240) {
        fail('AGENT_BLOG_PUBLIC_RUNTIME_TRIGGER_INVALID');
      }
      const preflight = await runAgentBlogPublicRuntimePreflight({ repository: preflightRepository, config });
      if (!preflight.ready) fail('AGENT_BLOG_PUBLIC_RUNTIME_PREFLIGHT_BLOCKED', { blockers: preflight.blockers });
      const frozen = await inputRepository.snapshot(config.agentUserId);
      if (frozen?.schemaVersion !== 'agent-blog-private-canary-input-snapshot-v2'
        || frozen.agentUserId !== config.agentUserId) fail('AGENT_BLOG_PUBLIC_RUNTIME_INPUT_INVALID');
      if (frozen.configuredModelId !== config.modelId) {
        fail('AGENT_BLOG_PUBLIC_RUNTIME_MODEL_DRIFT', {
          configuredModelId: frozen.configuredModelId, requestedModelId: config.modelId,
        });
      }
      const modelConfig = { model: { provider: config.provider, modelId: config.modelId },
        behaviorProfileId: frozen.behaviorProfileId,
        behaviorProfileVersion: frozen.behaviorProfileVersion };
      const discovery = await discoveryCanary.createRun({
        agentUserId: config.agentUserId, triggerKind, triggerRef,
        idempotencyKey: `public-runtime:${requestId}:discovery`, config: modelConfig,
        input: {
          schemaVersion: 'blog-project-discovery-input-v2', topicScope: frozen.topicScope,
          searchPolicy: { sort: 'stars', minStars: 10, pushedAfter: null,
            maxCandidates: AGENT_GITHUB_RESEARCH_LIMITS.maxCandidates,
            maxQueries: AGENT_GITHUB_RESEARCH_LIMITS.maxSearchRequests },
          previousRepositoryUrls: frozen.previousRepositoryUrls,
          behaviorProfile: frozen.behaviorProfile,
        },
      });
      const discoveryOutput = await executeAgentBlogPublicRun({
        worker: createDiscoveryWorker(discovery.id, requestId), workflow: BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,
        outputType: 'blog.candidate-set', runId: discovery.id, readRun,
      });
      const publication = await publicHandoff.createDraftRun({
        agentUserId: config.agentUserId, discoveryRunId: discovery.id,
        discoveryArtifactId: discoveryOutput.outputId,
        idempotencyKey: `public-runtime:${requestId}:article`, triggerKind, triggerRef,
        recentTitles: frozen.recentTitles, previousRepositoryUrls: frozen.previousRepositoryUrls,
        editorialMemory: frozen.editorialMemory,
        behaviorProfile: frozen.behaviorProfile, config: modelConfig,
      });
      const publicationOutput = await executeAgentBlogPublicRun({
        worker: createPublicationWorker(publication.id, requestId), workflow: BLOG_PROJECT_SINGLE_WORKFLOW,
        outputType: 'blog.article', runId: publication.id, readRun,
      });
      return Object.freeze({
        schemaVersion: 'agent-blog-public-runtime-result-v1', requestId,
        agentUserId: config.agentUserId, preflight: 'passed',
        behaviorProfileVersion: frozen.behaviorProfileVersion,
        discovery: { runId: discovery.id, artifactId: discoveryOutput.outputId },
        publication: { runId: publication.id, articleId: publicationOutput.outputId,
          publicationState: 'published' },
        publicationAttempted: true,
      });
    },
  };
}
