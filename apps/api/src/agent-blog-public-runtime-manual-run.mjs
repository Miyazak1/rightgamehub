import { runAgentBlogPublicRuntimePreflight } from './agent-blog-public-runtime-preflight.mjs';
import { AGENT_GITHUB_RESEARCH_LIMITS } from './agent-github-research-runtime.mjs';

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

async function executeRun({ worker, expectedStageCount, outputType, runId }) {
  let terminal = null;
  try {
    for (let index = 0; index < expectedStageCount; index += 1) {
      const result = await worker.runOnce();
      if (result?.status !== 'completed') {
        fail('AGENT_BLOG_PUBLIC_RUNTIME_STAGE_INCOMPLETE', { runId, stageNumber: index + 1,
          workerStatus: result?.status ?? 'unknown', stageKey: result?.stage?.stageKey ?? null,
          stageErrorCode: result?.stage?.errorCode ?? result?.error?.code ?? null });
      }
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
  createDiscoveryWorker, createPublicationWorker,
} = {}) {
  if (!config || !preflightRepository || !inputRepository || !discoveryCanary || !publicHandoff
    || typeof createDiscoveryWorker !== 'function' || typeof createPublicationWorker !== 'function') {
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
      const discoveryOutput = await executeRun({
        worker: createDiscoveryWorker(discovery.id, requestId), expectedStageCount: 4,
        outputType: 'blog.candidate-set', runId: discovery.id,
      });
      const publication = await publicHandoff.createDraftRun({
        agentUserId: config.agentUserId, discoveryRunId: discovery.id,
        discoveryArtifactId: discoveryOutput.outputId,
        idempotencyKey: `public-runtime:${requestId}:article`, triggerKind, triggerRef,
        recentTitles: frozen.recentTitles, previousRepositoryUrls: frozen.previousRepositoryUrls,
        editorialMemory: frozen.editorialMemory,
        behaviorProfile: frozen.behaviorProfile, config: modelConfig,
      });
      const publicationOutput = await executeRun({
        worker: createPublicationWorker(publication.id, requestId), expectedStageCount: 7,
        outputType: 'blog.article', runId: publication.id,
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
