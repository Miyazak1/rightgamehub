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
const matchesOutput=(expected,actual)=>actual===expected||(expected==='blog.article'&&actual==='blog.publication-skipped')
  ||(expected==='blog.candidate-set'&&actual==='blog.discovery-skipped');

export async function executeAgentBlogPublicRun({ worker, workflow, outputType, runId,
  now = Date.now, sleep = delay, readRun = null, signal }) {
  const expectedStageCount = workflow.stages.length;
  const maxAttempts = workflow.stages.reduce((sum, stage) => sum + stage.maxAttempts, 0);
  const deadline = now() + workflow.defaultBudget.wallClockSeconds * 1000;
  let terminal = null, completed = 0, attempts = 0, waitingRetry = false;
  try {
    if(readRun){
      const initial=await readRun(runId);
      completed=Number(initial?.completedStageCount??0);
      if(initial?.status==='succeeded')terminal=initial;
    }
    if(terminal)completed=expectedStageCount;
    while (completed < expectedStageCount) {
      signal?.throwIfAborted();
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
          && matchesOutput(outputType,persisted.outputType) && UUID.test(persisted.outputId ?? '')) {
          terminal = persisted;
          break;
        }
        if(persisted?.status==='uncertain'||persisted?.status==='failed'||persisted?.status==='cancelled'){
          fail('AGENT_BLOG_PUBLIC_RUNTIME_TERMINAL_FAILURE',{runId,stageErrorCode:persisted.errorCode??result?.stage?.errorCode??result?.error?.code});
        }
        if(Number(persisted?.completedStageCount)>completed){completed=Number(persisted.completedStageCount);continue;}
        if(result?.status==='idle'&&['queued','running'].includes(persisted?.status)){
          await sleep(Math.min(500,Math.max(0,deadline-now())));continue;
        }
      }
      if (result?.status === 'retry-scheduled' && (result.error?.uncertain!==true||workflow.workflowVersion>=4)
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
      if (result.run) {
        terminal = result.run;
        if (outputType === 'blog.article' && terminal.outputType === 'blog.publication-skipped') break;
      }
    }
  } finally {
    await worker.stop();
  }
  if (!terminal || terminal.id !== runId || terminal.status !== 'succeeded'
    || !matchesOutput(outputType,terminal.outputType) || !UUID.test(terminal.outputId ?? '')) {
    fail('AGENT_BLOG_PUBLIC_RUNTIME_OUTPUT_INVALID', { runId, expectedOutputType: outputType });
  }
  return terminal;
}

export function createAgentBlogPublicRuntimeManualRunner({
  config, preflightRepository, inputRepository, discoveryCanary, publicHandoff,
  createDiscoveryWorker, createPublicationWorker, readRun = null, requestRepository = null,
} = {}) {
  if (!config || !preflightRepository || !inputRepository || !discoveryCanary || !publicHandoff
    || typeof createDiscoveryWorker !== 'function' || typeof createPublicationWorker !== 'function'
    || (readRun !== null && typeof readRun !== 'function')
    || (requestRepository !== null && typeof requestRepository.findCompleted !== 'function')) {
    fail('AGENT_BLOG_PUBLIC_RUNTIME_DEPENDENCY_REQUIRED');
  }
  return {
    async pending() { return requestRepository?.pending?.(config.agentUserId) ?? null; },
    async run({ requestId, triggerKind = 'manual', triggerRef = requestId, signal }) {
      if (!UUID.test(requestId ?? '')) fail('AGENT_BLOG_PUBLIC_RUNTIME_REQUEST_ID_INVALID');
      if (!['manual', 'schedule'].includes(triggerKind) || typeof triggerRef !== 'string'
        || triggerRef.length < 1 || triggerRef.length > 240) {
        fail('AGENT_BLOG_PUBLIC_RUNTIME_TRIGGER_INVALID');
      }
      const completed = await requestRepository?.findCompleted({ agentUserId:config.agentUserId, requestId });
      if (completed) {
        await requestRepository?.reconcileCompleted?.(config.agentUserId,requestId,completed);
        return completed;
      }
      let checkpoint=await requestRepository?.checkpoint?.(config.agentUserId,requestId);
      if(checkpoint?.status==='needs-review')throw Object.assign(new AgentBlogPublicRuntimeManualRunError('AGENT_PUBLIC_REQUEST_NEEDS_REVIEW',{requestId}),{requestNeedsReview:true});
      const existing=await requestRepository?.runs?.(config.agentUserId,requestId)??{};
      if(!checkpoint&&existing.discovery&&requestRepository?.prepare){
        const current=await inputRepository.snapshot(config.agentUserId);
        const source=existing.discovery,article=existing.publication;
        const configSnapshot=source.config_snapshot;
        const frozen={...current,topicScope:source.input_json.topicScope,
          configuredModelId:configSnapshot.model?.modelId??current.configuredModelId,
          behaviorProfileId:configSnapshot.behaviorProfileId??source.behavior_profile_id,
          behaviorProfileVersion:configSnapshot.behaviorProfileVersion??current.behaviorProfileVersion,
          behaviorProfile:source.input_json.behaviorProfile,
          previousRepositoryUrls:source.input_json.previousRepositoryUrls,
          ...(article?{recentTitles:article.input_json.recentTitles,editorialMemory:article.input_json.editorialMemory}:{} )};
        checkpoint=await requestRepository.prepare({agentUserId:config.agentUserId,requestId,
          triggerKind:source.trigger_kind,triggerRef:source.trigger_ref,snapshot:frozen});
        await requestRepository.event(config.agentUserId,requestId,'legacy-request-adopted',
          {discoveryRunId:source.id,publicationRunId:article?.id??null,handoffSnapshotCreated:!article});
      }
      if(checkpoint&&await requestRepository.reviewIsFenced(config.agentUserId,requestId)){
        const owned=await requestRepository.claim(config.agentUserId,requestId);
        await requestRepository.settle(config.agentUserId,requestId,owned.lease_token,
          {errorCode:'AGENT_PUBLIC_REQUEST_NEEDS_REVIEW',needsReview:true,safeForNext:true});
        throw Object.assign(new AgentBlogPublicRuntimeManualRunError('AGENT_PUBLIC_REQUEST_NEEDS_REVIEW',{requestId}),{requestNeedsReview:true});
      }
      const recovering=Boolean(checkpoint);
      const preflight = await runAgentBlogPublicRuntimePreflight({ repository: preflightRepository, config });
      const ownActive=Object.values(existing).filter(run=>['queued','running','waiting'].includes(run.status)).length;
      const blockers=preflight.blockers.filter(code=>!(recovering&&(
        (code==='AGENT_BLOG_PUBLIC_RUNTIME_RUN_ACTIVE'&&preflight.observed.activeRuns===ownActive)
        ||(code==='AGENT_BLOG_PUBLIC_RUNTIME_AWAITING_HANDOFF'&&existing.discovery?.status==='succeeded'
          &&!existing.publication&&preflight.observed.awaitingHandoff===1))));
      if (blockers.length) fail('AGENT_BLOG_PUBLIC_RUNTIME_PREFLIGHT_BLOCKED', { blockers });
      let frozen = checkpoint?.snapshot_json??await inputRepository.snapshot(config.agentUserId);
      if (frozen?.schemaVersion !== 'agent-blog-private-canary-input-snapshot-v2'
        || frozen.agentUserId !== config.agentUserId) fail('AGENT_BLOG_PUBLIC_RUNTIME_INPUT_INVALID');
      if (frozen.configuredModelId !== config.modelId) {
        fail('AGENT_BLOG_PUBLIC_RUNTIME_MODEL_DRIFT', {
          configuredModelId: frozen.configuredModelId, requestedModelId: config.modelId,
        });
      }
      if(requestRepository?.prepare){
        checkpoint??=await requestRepository.prepare({agentUserId:config.agentUserId,requestId,triggerKind,triggerRef,snapshot:frozen});
        frozen=checkpoint.snapshot_json;
        // Identity belongs to the original accepted request, including on retries.
        triggerKind=checkpoint.trigger_kind;triggerRef=checkpoint.trigger_ref;
        checkpoint=await requestRepository.claim(config.agentUserId,requestId);
      }
      const modelConfig = { model: { provider: config.provider, modelId: config.modelId },
        behaviorProfileId: frozen.behaviorProfileId,behaviorProfileVersion: frozen.behaviorProfileVersion };
      const owner=new AbortController();
      const relay=()=>owner.abort(signal.reason);
      if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
      let timer, renewing=false;
      if(checkpoint?.lease_token){
        timer=setInterval(async()=>{
          if(renewing)return;renewing=true;
          try{await requestRepository.heartbeat(config.agentUserId,requestId,checkpoint.lease_token,180);}
          catch(error){owner.abort(error);}finally{renewing=false;}
        },30000);timer.unref?.();
      }
      try {
      owner.signal.throwIfAborted();
      const discovery = existing.discovery??await discoveryCanary.createRun({
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
        worker: createDiscoveryWorker(discovery.id, requestId, owner.signal), workflow: BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,
        outputType: 'blog.candidate-set', runId: discovery.id, readRun,signal:owner.signal,
      });
      if(discoveryOutput.outputType==='blog.discovery-skipped'){
        const result={schemaVersion:'agent-blog-public-runtime-result-v1',requestId,agentUserId:config.agentUserId,
          preflight:'passed',behaviorProfileVersion:frozen.behaviorProfileVersion,
          discovery:{runId:discovery.id,artifactId:discoveryOutput.outputId},
          publication:{runId:null,articleId:null,publicationState:'skipped'},publicationAttempted:false};
        if(checkpoint?.lease_token)await requestRepository.settle(config.agentUserId,requestId,checkpoint.lease_token,{result});
        return Object.freeze(result);
      }
      const publication = existing.publication??await publicHandoff.createDraftRun({
        agentUserId: config.agentUserId, discoveryRunId: discovery.id,
        discoveryArtifactId: discoveryOutput.outputId,
        idempotencyKey: `public-runtime:${requestId}:article`, triggerKind, triggerRef,
        recentTitles: frozen.recentTitles, previousRepositoryUrls: frozen.previousRepositoryUrls,
        editorialMemory: frozen.editorialMemory,
        behaviorProfile: frozen.behaviorProfile, config: modelConfig,
      });
      const publicationOutput = await executeAgentBlogPublicRun({
        worker: createPublicationWorker(publication.id, requestId, owner.signal), workflow: BLOG_PROJECT_SINGLE_WORKFLOW,
        outputType: 'blog.article', runId: publication.id, readRun,signal:owner.signal,
      });
      const result=Object.freeze({
        schemaVersion: 'agent-blog-public-runtime-result-v1', requestId,
        agentUserId: config.agentUserId, preflight: 'passed',
        behaviorProfileVersion: frozen.behaviorProfileVersion,
        discovery: { runId: discovery.id, artifactId: discoveryOutput.outputId },
        publication: { runId: publication.id,
          articleId: publicationOutput.outputType === 'blog.article' ? publicationOutput.outputId : null,
          publicationState: publicationOutput.outputType === 'blog.article' ? 'published' : 'skipped' },
        publicationAttempted: publicationOutput.outputType === 'blog.article',
      });
      if(checkpoint?.lease_token)await requestRepository.settle(config.agentUserId,requestId,checkpoint.lease_token,{result});
      return result;
      } catch(error){
        const receipt=await requestRepository?.findCompleted({agentUserId:config.agentUserId,requestId}).catch(()=>null);
        if(receipt){
          if(checkpoint?.lease_token)await requestRepository.settle(config.agentUserId,requestId,checkpoint.lease_token,{result:receipt});
          return receipt;
        }
        if(checkpoint?.lease_token){
          const terminal=await requestRepository.reviewIsFenced(config.agentUserId,requestId).catch(()=>false);
          await requestRepository.settle(config.agentUserId,requestId,checkpoint.lease_token,
            {errorCode:error.code??'AGENT_PUBLIC_REQUEST_INTERRUPTED',needsReview:terminal,safeForNext:terminal}).catch(()=>{});
          if(terminal)error.requestNeedsReview=true;
        }
        throw error;
      } finally {clearInterval(timer);signal?.removeEventListener('abort',relay);}
    },
  };
}
