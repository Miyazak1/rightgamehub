import crypto from 'node:crypto';
import { extractPaperPdf } from './agent-arxiv-paper-tool.mjs';
import { validatePaperArticleEvidencePack } from './agent-paper-article-generation.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { createAgentRuntimeWorker } from './agent-runtime-worker.mjs';
import { PostgresPaperStudyRepository, paperStudyError } from './paper-study-persistent-repository.mjs';
import { createPersistentPaperStudyService } from './paper-study-persistent-service.mjs';
import { createPaperStudyRedis } from './paper-study-redis.mjs';

export function paperStudyWorkflow(operation) {
  return {schemaVersion:'agent-workflow-v1',workflowKey:operation==='import'?'paper.study.import':`paper.study.offline-${operation}`,workflowVersion:1,
    inputSchema:'paper-study-task-v1',outputSchema:'paper-study-private-result-v1',requiredCapabilities:[],
    defaultBudget:{providerCalls:0,toolCalls:0,inputTokens:0,outputTokens:0,wallClockSeconds:300},
    stages:[{key:'process',kind:'deterministic',dependsOn:[],maxAttempts:3,timeoutSeconds:240}]};
}
export function createPaperStudyDurableRuntime({pool,redisUrl,executionAgentUserId,workerId='paper-study-worker',offlineProcessor=null,extract=extractPaperPdf,afterCheckpoint=async()=>{},signals:providedSignals}) {
  if(offlineProcessor && offlineProcessor.executionKind!=='offline-verified-recording')throw paperStudyError('PAPER_STUDY_OFFLINE_PROCESSOR_REQUIRED');
  const repository=new PostgresPaperStudyRepository(pool),runtime=new PostgresAgentRuntimeRepository(pool);
  const signals=providedSignals??createPaperStudyRedis({url:redisUrl});
  const operations=offlineProcessor?['import','analyze','draft']:['import'];
  const service=createPersistentPaperStudyService({repository,signals,executionAgentUserId,allowOfflineFixtures:!!offlineProcessor});
  service.ready=async()=>{try {const identity=(await pool.query("SELECT a.user_id FROM agent_accounts a JOIN users u ON u.id=a.user_id JOIN agent_policy_profile_assignments p ON p.agent_user_id=a.user_id WHERE a.user_id=$1 AND a.status='active' AND u.status='active'",[executionAgentUserId])).rows[0];return !!identity&&await signals.ready();}catch{return false;}};
  let initialized;
  const initialize=()=>initialized??=(async()=>{
    const identity=(await pool.query(`SELECT a.operator_user_id FROM agent_accounts a JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.status='active' AND u.status='active'`,[executionAgentUserId])).rows[0];
    if(!identity)throw paperStudyError('PAPER_STUDY_EXECUTION_AGENT_INACTIVE');
    for(const operation of operations){const manifest=paperStudyWorkflow(operation);const r=await runtime.registerWorkflow({actorUserId:identity.operator_user_id,manifest});if(r.status==='draft')await runtime.activateWorkflow(manifest.workflowKey,1);}
  })().catch(e=>{initialized=null;throw e;});
  const dispatch=async()=>{
    await initialize();
    for(const task of await repository.pending(executionAgentUserId,operations)){
      const manifest=paperStudyWorkflow(task.operation);
      const run=await runtime.createRun({id:task.desired_run_id,agentUserId:executionAgentUserId,workflowKey:manifest.workflowKey,workflowVersion:1,
        triggerKind:'interaction',triggerRef:task.document_id,idempotencyKey:'paper-study:'+task.id,
        input:{taskId:task.id,documentId:task.document_id,ownerUserId:task.owner_user_id,sourceSha256:task.source_sha256},
        config:{modelCallsEnabled:false,publicationEnabled:false,executionMode:task.operation==='import'?'local-parse':'offline-verified-recording'}});
      await repository.attach(task.id,run.id);
    }
  };
  const process=async(context,execution)=>{
    const task=await repository.execution(context);
    if(task.result_json){if(stableHash(task.result_json)!==task.result_sha256)throw paperStudyError('PAPER_STUDY_CHECKPOINT_CORRUPT');return task.result_json;}
    let patch;
    if(task.operation==='import'){
      patch=await extract(new Uint8Array(task.pdf_bytes),task.document_id);
      if(!patch.pages?.length||patch.pageCount>80)throw paperStudyError('PAPER_STUDY_PAGE_LIMIT');
    }else{
      // No live provider adapter is accepted here. Production has no offline
      // processor; its model routes remain closed before a task is created.
      if(!offlineProcessor||context.run.configSnapshot.executionMode!=='offline-verified-recording')throw paperStudyError('PAPER_STUDY_MODELS_DISABLED');
      if(task.operation==='analyze'){
        if(!task.parsed_json?.qualityAssessment?.permittedUses?.includes('analysis'))throw paperStudyError('PAPER_STUDY_QUALITY_BLOCKED');
        const value=await offlineProcessor.analyze({sourceSha256:task.source_sha256,arxivId:task.arxiv_id,parsed:task.parsed_json});
        if(value.sourceSha256!==task.source_sha256)throw paperStudyError('PAPER_STUDY_SOURCE_DRIFT');
        patch=validatePaperArticleEvidencePack(value.pack);
        if(patch.readingScope?.publicPublicationEnabled!==false||patch.readingScope?.manualReviewRequired!==true||patch.evidence.some(e=>e.locator.pages.some(p=>p>task.parsed_json.pageCount)))throw paperStudyError('PAPER_STUDY_SCOPE_REQUIRED');
      }else{
        const composition=await offlineProcessor.compose(task.analysis_json);await offlineProcessor.verify(composition,task.analysis_json);
        if(stableHash(composition.selection?.readingScope)!==stableHash(task.analysis_json.readingScope))throw paperStudyError('PAPER_STUDY_SCOPE_DRIFT');
        patch={id:crypto.randomUUID(),content:composition.content,paragraphEvidenceBindings:composition.paragraphEvidenceBindings,readingScope:task.analysis_json.readingScope,
          contentSha256:stableHash(composition.content),publicationState:'draft',private:true,manualReviewRequired:true,publicPublicationEnabled:false};
      }
    }
    const result={outputRef:{documentId:task.document_id,resultSha256:stableHash(patch)},runOutput:{type:'paper.study.private',id:task.document_id}};
    await repository.checkpoint(context,execution,result,patch);await afterCheckpoint({task,context,execution});await signals.notify(task.document_id);return result;
  };
  const handlers=Object.fromEntries(operations.map(op=>[paperStudyWorkflow(op).workflowKey+':process',process]));
  const worker=createAgentRuntimeWorker({repository:runtime,handlers,workerId,scopeRecoveryToHandlers:true,metadata:{role:'paper-study',modelsEnabled:false,publicationEnabled:false}});
  return {service,repository,runtime,worker,initialize,dispatch,async runOnce(){await dispatch();return worker.runOnce();},async close(){await worker.stop();await signals.close();}};
}
