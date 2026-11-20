import {randomUUID} from 'node:crypto';
import {PostgresAgentBlogPublicRequestRepository} from './agent-blog-public-request-repository.mjs';
import {runAgentBlogPublicRuntimePreflight} from './agent-blog-public-runtime-preflight.mjs';
import {BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,BLOG_PROJECT_SINGLE_WORKFLOW,BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW} from './agent-blog-foundation-workflows.mjs';
import {normalizeBlogFoundationPublicInput,normalizeBlogFoundationShadowInput,createAgentBlogFoundationShadowHandlers} from './agent-blog-foundation-shadow.mjs';
import {createAgentBlogAutonomousDiscoveryCanary} from './agent-blog-candidate-discovery.mjs';
import {createAgentBlogCandidatePublicHandoff,createAgentBlogCandidateDraftHandoffCanary} from './agent-blog-candidate-handoff.mjs';
import {createAgentRuntimeWorker} from './agent-runtime-worker.mjs';
import {executeAgentBlogPublicRun} from './agent-blog-public-runtime-manual-run.mjs';
import {AGENT_GITHUB_RESEARCH_LIMITS} from './agent-github-research-runtime.mjs';
import {interactionFail,interactionHash,interactionId,AGENT_GITHUB_INSPECT_WORKFLOW} from './agent-interaction-contracts.mjs';

export function createAgentGitHubInteractionExecutor({repository,service,runtime}){
 const pool=repository.pool,ports=runtime.interactionPorts,requests=new PostgresAgentBlogPublicRequestRepository(pool);
 const {runtimeRepository,artifactRepository}=ports;
 const discovery=createAgentBlogAutonomousDiscoveryCanary({runtimeRepository,enabled:true});
 const publishedHandoff=createAgentBlogCandidatePublicHandoff({runtimeRepository,artifactRepository,enabled:true});
 const draftHandoff=createAgentBlogCandidateDraftHandoffCanary({runtimeRepository,artifactRepository,enabled:true});
 const draftHandlers=createAgentBlogFoundationShadowHandlers({...ports,publicationGateway:null,researchEvidenceRepository:ports.researchEvidenceRepository});
 async function requireSchedulerProtocol(){
  const row=(await pool.query(`SELECT config_json->'worker' AS worker FROM agent_schedules WHERE agent_user_id=$1 AND workflow_key='blog.project.discovery-shadow'`,[service.agentId])).rows[0];
  const age=Date.now()-Date.parse(row?.worker?.heartbeatAt);
  if(row?.worker?.interactionProtocolVersion!==1||row.worker.state==='stopped'||!Number.isFinite(age)||age< -30000||age>120000)interactionFail('AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED',503);
 }
 const readRun=async runId=>{
  const row=(await pool.query(`SELECT id,status,output_type,output_id,error_code,(SELECT count(*)::int FROM agent_run_stages WHERE run_id=agent_runs.id AND status='succeeded') AS completed FROM agent_runs WHERE id=$1 AND agent_user_id=$2`,[runId,service.agentId])).rows[0];
  return row?{id:row.id,status:row.status,outputType:row.output_type,outputId:row.output_id,errorCode:row.error_code,completedStageCount:row.completed}:null;
 };
 async function receipt(row,runs){
  const spec=row.input_json;
  if(spec.kind==='github-search'&&spec.repositoryUrl){
   const read=await readRun(interactionId([row.id,'github-inspect']));if(read?.status!=='succeeded')return null;
   const artifact=await artifactRepository.read({runId:read.id,artifactId:read.outputId,expectedArtifactKey:'agent.github.repository'}),source=artifact.content;
   return {reply:`${source.metadata.fullName}\n${source.repository.canonicalUrl}\n${source.metadata.description??''}\nStars：${source.metadata.stars}\n证据版本：${source.sourceVersion.revision}\n`+source.materials.filter(m=>['readme','documentation'].includes(m.type)).slice(0,2).map(m=>m.text.slice(0,1800)).join('\n\n'),repository:{name:source.metadata.fullName,url:source.repository.canonicalUrl,revision:source.sourceVersion.revision},runId:read.id};
  }
  if(spec.kind==='github-search'){
   const source=runs.discovery&&await readRun(runs.discovery.id);if(source?.status!=='succeeded')return null;
   if(source.outputType==='blog.discovery-skipped')return {reply:'本次没有找到符合要求的 GitHub 项目。',repositories:[],discoveryRunId:source.id};
   const artifact=await artifactRepository.read({runId:source.id,artifactId:source.outputId,expectedArtifactKey:'blog.candidate-set'});
   const repositories=artifact.content.candidates.slice(0,5).map(item=>({name:item.name??item.key??item.canonicalUrl,url:item.canonicalUrl,description:item.description??''}));
   return {reply:'小墨鱼找到以下 GitHub 项目：\n'+repositories.map((r,i)=>`${i+1}. ${r.name}\n${r.url}\n${r.description}`).join('\n\n'),repositories,discoveryRunId:source.id};
  }
  const article=runs.publication&&await readRun(runs.publication.id);
  if(!article||article.status!=='succeeded'){
   const empty=runs.discovery&&await readRun(runs.discovery.id);
   if(empty?.status==='succeeded'&&empty.outputType==='blog.discovery-skipped')return {reply:'本次未找到适合写作的 GitHub 项目，没有创建或发布文章。',publicationState:'skipped',discoveryRunId:empty.id};
   return null;
  }
  if(article.outputType==='blog.publication-skipped')return {reply:'小墨鱼完成了选题检查，本次没有适合发布的项目，未发布文章。',publicationState:'skipped',runId:article.id};
  if(article.outputType==='blog.publication-skipped')return {reply:'本次研究未通过现有选题或发布门禁，没有发布文章。',publicationState:'skipped',runId:article.id};
  const result=await repository.articleResult(service.agentId,article.outputId);
  if(!result)interactionFail('AGENT_INTERACTION_ARTICLE_RECEIPT_MISSING',503);
  const published=result.publication_state==='published'&&article.outputType==='blog.article';
  return published?{reply:'小墨鱼已完成 GitHub 项目研究并发布文章：'+result.title+'\n/blog/'+encodeURIComponent(result.slug),publicationState:'published',articleId:result.id,url:'/blog/'+encodeURIComponent(result.slug),runId:article.id}
   :{reply:'小墨鱼已完成 GitHub 项目研究并保存文章草稿，请到网站后台查看。',publicationState:'draft',articleId:result.id,runId:article.id};
 }
 return async function execute(row,{signal}={}){
  const {agent}=await service.authorize(row.origin_json,{invoke:row.kind==='github-article'});
  let checkpoint=await requests.checkpoint(agent.id,row.id);
  if(checkpoint&&checkpoint.snapshot_json.executionSource!=='agent-interaction-v1')interactionFail('AGENT_INTERACTION_REQUEST_CONFLICT',409);
  if(checkpoint&&interactionHash(checkpoint.snapshot_json.interactionSpec)!==interactionHash(row.input_json))interactionFail('AGENT_INTERACTION_REQUEST_CONFLICT',409);
  if(checkpoint?.status==='completed')return checkpoint.result_json;
  const existing=await requests.runs(agent.id,row.id),completed=await receipt(row,existing);
  if(completed){
   if(!checkpoint)interactionFail('AGENT_INTERACTION_REQUEST_ORIGIN_MISSING',409);
   if(!await requests.completeInteractionReceipt(agent.id,row.id,completed))throw Object.assign(new Error('AGENT_INTERACTION_RECEIPT_OWNER_ACTIVE'),{code:'AGENT_INTERACTION_RECEIPT_OWNER_ACTIVE',retryable:true});
   return completed;
  }
  await requireSchedulerProtocol();
  if(!checkpoint){
   const base=await ports.inputRepository.snapshot(agent.id);
   if(base.configuredModelId!==runtime.config.modelId)interactionFail('AGENT_BLOG_PUBLIC_RUNTIME_MODEL_DRIFT',409);
   const publication=row.kind==='github-search'||row.input_json.publication==='draft'||agent.policy_json.autoPublish!==true?'draft':'published';
   checkpoint=await requests.prepare({agentUserId:agent.id,requestId:row.id,triggerKind:'manual',triggerRef:'interaction:'+row.id,
    snapshot:{...base,topicScope:row.input_json.topic,executionSource:'agent-interaction-v1',interactionSpec:row.input_json,publication}});
  }
  if(checkpoint.status==='needs-review')interactionFail('AGENT_PUBLIC_REQUEST_NEEDS_REVIEW',409);
  const frozen=checkpoint.snapshot_json,publication=frozen.publication;
  const preflight=await runAgentBlogPublicRuntimePreflight({repository:ports.preflightRepository,config:runtime.config});
  const ownActive=Object.values(existing).filter(r=>['queued','running','waiting'].includes(r.status)).length;
  const blockers=preflight.blockers.filter(code=>!(
   (code==='AGENT_BLOG_PUBLIC_RUNTIME_RUN_ACTIVE'&&preflight.observed.activeRuns===ownActive)
   ||(code==='AGENT_BLOG_PUBLIC_RUNTIME_AWAITING_HANDOFF'&&existing.discovery?.status==='succeeded'&&!existing.publication&&preflight.observed.awaitingHandoff===1)
   ||(code==='AGENT_BLOG_PUBLIC_RUNTIME_DAILY_LIMIT_REACHED'&&publication==='draft')));
  if(blockers.length){const error=Object.assign(new Error(blockers[0]),{code:blockers[0],retryable:/RUN_ACTIVE|AWAITING_HANDOFF|LIMIT_REACHED|CIRCUIT_OPEN/u.test(blockers[0])});await requests.deferInteraction(agent.id,row.id,{errorCode:error.code,needsReview:!error.retryable});throw error;}
  checkpoint=await requests.claim(agent.id,row.id);
  const owner=new AbortController(),relay=()=>owner.abort(signal?.reason);if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
  let renewing=false;const timer=setInterval(async()=>{if(renewing)return;renewing=true;try{await requireSchedulerProtocol();await service.authorize(row.origin_json,{invoke:row.kind==='github-article'});await requests.heartbeat(agent.id,row.id,checkpoint.lease_token,180);}catch(error){owner.abort(error);}finally{renewing=false;}},30000);timer.unref?.();
  const config={model:{provider:runtime.config.provider,modelId:frozen.configuredModelId},behaviorProfileId:frozen.behaviorProfileId,behaviorProfileVersion:frozen.behaviorProfileVersion};
  const createWorker=(runId,handlers)=>createAgentRuntimeWorker({repository:runtimeRepository,targetRunId:runId,recoverTargetRun:true,workerId:'interaction-github-'+row.id,instanceId:randomUUID(),leaseSeconds:180,heartbeatSeconds:30,signal:owner.signal,
   handlers:Object.fromEntries(Object.entries(handlers).map(([key,fn])=>[key,async(context,execution)=>{await requireSchedulerProtocol();await service.authorize(row.origin_json,{invoke:row.kind==='github-article'});return fn(context,execution);}]))});
  try{
   let discoveryRun=existing.discovery,articleRun=existing.publication;
   if(row.kind==='github-search'&&row.input_json.repositoryUrl){
    const workflow=AGENT_GITHUB_INSPECT_WORKFLOW,id=interactionId([row.id,'github-inspect']);
    let current=await readRun(id);
    if(!current)await runtimeRepository.createRun({id,agentUserId:agent.id,workflowKey:workflow.workflowKey,workflowVersion:1,triggerKind:'manual',triggerRef:'interaction:'+row.id,idempotencyKey:'public-runtime:'+row.id+':discovery',config,input:{schemaVersion:'agent-github-inspect-input-v1',repository:row.input_json.repositoryUrl},budget:workflow.defaultBudget});
    await repository.setRun(row,id);
    const handler=async(context,execution)=>{
     const saved=(await pool.query("SELECT id FROM agent_runtime_stage_artifacts WHERE run_id=$1 AND stage_id=$2 AND artifact_key='agent.github.repository'",[id,context.stage.id])).rows[0];
     if(saved)return {outputRef:{artifactId:saved.id},runOutput:{type:'agent.github.repository',id:saved.id}};
     const result=await ports.toolGateway.invoke({runId:id,stageId:context.stage.id,workerId:execution.workerId,leaseToken:execution.leaseToken,
      action:{actionKey:'read-repository',actionKind:'tool',capabilityKey:'research.github.read',contractVersion:1,riskLevel:'L1'},idempotencyKey:'interaction-inspect:'+row.id+':'+context.stage.attempt,
      resource:{type:'github.repository',owner:'public',id:row.input_json.repositoryUrl},tool:{toolKey:'research.github.repository.materials.read',contractVersion:1},request:{repository:row.input_json.repositoryUrl},signal:execution.signal});
     if(result.status!=='succeeded')interactionFail('AGENT_INTERACTION_GITHUB_READ_INCOMPLETE',503);
     const artifact=await artifactRepository.save({runId:id,stageId:context.stage.id,workerId:execution.workerId,leaseToken:execution.leaseToken,artifactKey:'agent.github.repository',artifactKind:'validated-output',schema:{key:'agent.github.repository',version:1},content:result.output,sourceToolArtifactIds:[result.artifactId]});
     return {outputRef:{artifactId:artifact.id},runOutput:{type:'agent.github.repository',id:artifact.id}};
    };
    await executeAgentBlogPublicRun({worker:createWorker(id,{'agent.github.inspect:read':handler}),workflow,outputType:'agent.github.repository',runId:id,readRun,signal:owner.signal});
     const result=await receipt(row,{});await requests.settleInteraction(agent.id,row.id,checkpoint.lease_token,{result,safeForNext:true});return result;
   }
   if(!row.input_json.repositoryUrl){
    discoveryRun??=await discovery.createRun({agentUserId:agent.id,triggerKind:'manual',triggerRef:'interaction:'+row.id,idempotencyKey:'public-runtime:'+row.id+':discovery',config,
     input:{schemaVersion:'blog-project-discovery-input-v2',topicScope:frozen.topicScope,searchPolicy:{sort:'stars',minStars:10,pushedAfter:null,maxCandidates:AGENT_GITHUB_RESEARCH_LIMITS.maxCandidates,maxQueries:AGENT_GITHUB_RESEARCH_LIMITS.maxSearchRequests},previousRepositoryUrls:frozen.previousRepositoryUrls,behaviorProfile:frozen.behaviorProfile}});
    await repository.setRun(row,discoveryRun.id);
    const found=await executeAgentBlogPublicRun({worker:createWorker(discoveryRun.id,ports.discoveryHandlers),workflow:BLOG_PROJECT_AUTONOMOUS_DISCOVERY_SHADOW_WORKFLOW,outputType:'blog.candidate-set',runId:discoveryRun.id,readRun,signal:owner.signal});
    if(row.kind==='github-search'||found.outputType==='blog.discovery-skipped'){
     const result=await receipt(row,{discovery:discoveryRun});if(!result)interactionFail('AGENT_INTERACTION_RESULT_MISSING',503);
     await requests.settleInteraction(agent.id,row.id,checkpoint.lease_token,{result,safeForNext:true});return result;
    }
    if(!articleRun)articleRun=await (publication==='published'?publishedHandoff:draftHandoff).createDraftRun({agentUserId:agent.id,discoveryRunId:discoveryRun.id,discoveryArtifactId:found.outputId,
     idempotencyKey:'public-runtime:'+row.id+':article',triggerKind:'manual',triggerRef:'interaction:'+row.id,config,recentTitles:frozen.recentTitles,previousRepositoryUrls:frozen.previousRepositoryUrls,behaviorProfile:frozen.behaviorProfile,editorialMemory:frozen.editorialMemory});
   }else if(!articleRun){
    const workflow=publication==='published'?BLOG_PROJECT_SINGLE_WORKFLOW:BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW;
    const normalize=publication==='published'?normalizeBlogFoundationPublicInput:normalizeBlogFoundationShadowInput;
    articleRun=await runtimeRepository.createRun({agentUserId:agent.id,workflowKey:workflow.workflowKey,workflowVersion:workflow.workflowVersion,triggerKind:'manual',triggerRef:'interaction:'+row.id,idempotencyKey:'public-runtime:'+row.id+':article',config,
     input:normalize({schemaVersion:publication==='published'?'blog-project-single-input-v2':'blog-project-single-shadow-input-v2',topicScope:frozen.topicScope,candidateRepositories:[row.input_json.repositoryUrl],recentTitles:frozen.recentTitles,previousRepositoryUrls:frozen.previousRepositoryUrls,behaviorProfile:frozen.behaviorProfile,editorialMemory:frozen.editorialMemory}),budget:workflow.defaultBudget});
   }
   await repository.setRun(row,articleRun.id);
   await executeAgentBlogPublicRun({worker:createWorker(articleRun.id,publication==='published'?ports.publicationHandlers:draftHandlers),workflow:publication==='published'?BLOG_PROJECT_SINGLE_WORKFLOW:BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW,outputType:publication==='published'?'blog.article':'blog.private-draft',runId:articleRun.id,readRun,signal:owner.signal});
   const result=await receipt(row,{discovery:discoveryRun,publication:articleRun});if(!result)interactionFail('AGENT_INTERACTION_RESULT_MISSING',503);
   await requests.settleInteraction(agent.id,row.id,checkpoint.lease_token,{result,safeForNext:true});return result;
  }catch(error){
   const runs=await requests.runs(agent.id,row.id).catch(()=>({})),result=await receipt(row,runs).catch(()=>null);
   if(result){await requests.settleInteraction(agent.id,row.id,checkpoint.lease_token,{result,safeForNext:true});return result;}
   const fenced=error.retryable!==true||error.code==='AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED'||await requests.reviewIsFenced(agent.id,row.id).catch(()=>false);
   await requests.settleInteraction(agent.id,row.id,checkpoint.lease_token,{errorCode:error.code??'AGENT_INTERACTION_GITHUB_FAILED',needsReview:fenced,safeForNext:fenced,delaySeconds:60}).catch(()=>{});
   throw error;
  }finally{clearInterval(timer);signal?.removeEventListener('abort',relay);}
 };
}

