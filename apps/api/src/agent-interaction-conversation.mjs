import {randomUUID} from 'node:crypto';
import {createPlatformAssistantProvider,createPlatformAssistantService} from './platform-assistant.mjs';
import {parseAssistantOutput} from './assistant-output.mjs';
import {createAgentRuntimeWorker} from './agent-runtime-worker.mjs';
import {AGENT_CONVERSATION_WORKFLOW,AGENT_CONVERSATION_ATTEMPT_WORKFLOW,interactionFail,interactionId} from './agent-interaction-contracts.mjs';
import {AGENT_CONTEXT_CONVERSATION_WORKFLOW,conversationContextMode,quotedContextData} from './agent-context-conversation.mjs';

export const CONVERSATION_RESPONSE_SCHEMA=Object.freeze({key:'agent.conversation.completion',version:1});
export const CONVERSATION_ATTEMPT_SCHEMA=Object.freeze({key:'agent.conversation.attempt',version:1});
export function validateConversationOutput(raw){
 const value=typeof raw==='string'?parseAssistantOutput(raw):raw;
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  if(typeof value.reply==='string'&&value.reply.trim()&&value.reply.length<=12000&&Object.keys(value).every(k=>k==='reply'))return {reply:value.reply.trim()};
  const call=value.toolCall;
  if(Object.keys(value).every(k=>['toolCall','reply'].includes(k))&&call&&typeof call==='object'&&!Array.isArray(call)&&Object.keys(call).every(k=>['name','arguments'].includes(k))&&typeof call.name==='string'&&call.name.length<=100&&call.arguments&&typeof call.arguments==='object'&&!Array.isArray(call.arguments))return {toolCall:call};
 }
 interactionFail('AGENT_INTERACTION_OUTPUT_INVALID',502);
}
export function validateConversationAttempt(raw){
 if(Buffer.byteLength(typeof raw==='string'?raw:JSON.stringify(raw)??'')>65536)interactionFail('AGENT_INTERACTION_OUTPUT_INVALID',502);
 try{return {accepted:true,completion:validateConversationOutput(raw)};}
 catch{return {accepted:false,rawOutput:structuredClone(raw),validationCode:'AGENT_INTERACTION_OUTPUT_INVALID'};}
}
export function createAgentConversationExecutor({repository,service,ports,practiceService,platformTools,contextMode='legacy',contextService=null}){
 const mode=conversationContextMode(contextMode,contextService);
 if(mode!=='legacy'&&contextService.agentId!==service.agentId)interactionFail('AGENT_CONTEXT_CONFIG_REQUIRED',503);
 const {runtimeRepository,providerGateway}=ports,pool=repository.pool;
 const readRun=async id=>(await pool.query('SELECT id,status,workflow_version,output_id,error_code,input_json FROM agent_runs WHERE id=$1 AND agent_user_id=$2',[id,service.agentId])).rows[0];
 return async function execute(row,{signal}={}){
  const {agent,principal}=await service.authorize(row.origin_json);
  const id=interactionId([row.id,'conversation-run']);let run=await readRun(id);
  if(run?.workflow_version===3&&mode!=='unified')interactionFail('AGENT_CONTEXT_RESUME_DISABLED',409);
  const unified=run?run.workflow_version===3:mode==='unified';
  const workflow=unified?AGENT_CONTEXT_CONVERSATION_WORKFLOW:run?.workflow_version===1||!ports.conversationAttempts?AGENT_CONVERSATION_WORKFLOW:AGENT_CONVERSATION_ATTEMPT_WORKFLOW;
  const access={origin:row.origin_json,interactionId:row.id};
  if(!run){
   if(mode==='shadow')await contextService.shadow(access);
   const projection=unified?await contextService.assemble(access):null;
   await runtimeRepository.createRun({id,agentUserId:agent.id,workflowKey:workflow.workflowKey,workflowVersion:workflow.workflowVersion,
    triggerKind:'manual',triggerRef:'interaction:'+row.id,idempotencyKey:'interaction:'+row.id,
    input:{schemaVersion:unified?'agent-conversation-input-v2':'agent-conversation-input-v1',interactionId:row.id,message:row.input_json.message,context:row.input_json.context,
     history:projection?projection.compatibility.history:await repository.history(row),...(projection?{contextV2:projection}:{})},
    config:{model:{provider:'deepseek',modelId:agent.model},agentIdentity:{id:agent.id,displayName:agent.display_name,profile:agent.profile}},budget:workflow.defaultBudget});
   run=await readRun(id);
  }
  await repository.setRun(row,id);
  const savedReply=(await repository.get(row.id))?.checkpoint_json;
  const validateContext=async input=>unified?contextService.revalidate(access,input.contextV2):null;
  if(savedReply){if(unified)await validateContext(run.input_json);return savedReply;}
  const respond=async(context,execution)=>{
   const current=await repository.get(row.id);await service.authorize(current.origin_json);
   const freshContext=await validateContext(context.run.input);
   if(current.checkpoint_json)return {outputRef:{interactionId:row.id},runOutput:{type:'agent.interaction',id:row.id}};
   let ordinal=0;
   const provider=createPlatformAssistantProvider({managed:true,invoke:async({request,tokenCeiling,timeoutSeconds})=>{
    if(unified){await validateContext(context.run.input);if(Buffer.byteLength(JSON.stringify(request))>freshContext.limits.maxPromptBytes)interactionFail('AGENT_CONTEXT_PROMPT_BUDGET_EXCEEDED',413);}
    const n=++ordinal;const generated=await providerGateway.invoke({runId:id,stageId:context.stage.id,workerId:execution.workerId,leaseToken:execution.leaseToken,
     action:{actionKey:'conversation-'+n,actionKind:'provider',capabilityKey:'provider.text.generate',contractVersion:1,riskLevel:'L1'},
     idempotencyKey:'interaction:'+row.id+':completion:'+n,resource:{type:'provider.model',owner:agent.id},
     modelPolicy:{taskClass:'structured-generation',requiresJsonSchema:true,maxInputTokens:60000,maxOutputTokens:2400,maxCostMicrousd:50000000,latencyClass:'interactive',preferredProvider:'deepseek',preferredModel:context.run.configSnapshot.model.modelId},
     promptTemplate:{key:'agent.conversation',version:workflow.workflowVersion},responseSchema:workflow.workflowVersion>=2?CONVERSATION_ATTEMPT_SCHEMA:CONVERSATION_RESPONSE_SCHEMA,request,tokenCeiling,timeoutSeconds,signal:execution.signal});
    if(unified)await validateContext(context.run.input);
    const output=workflow.workflowVersion>=2?(generated.output.accepted?JSON.stringify(generated.output.completion):typeof generated.output.rawOutput==='string'?generated.output.rawOutput:JSON.stringify(generated.output.rawOutput)):JSON.stringify(generated.output);
    return {...generated,output,responseRef:{finishReason:'stop'}};
   }});
   const baseTools=await service.tools(current,{platformTools,actor:principal.actor});
   const tools=unified?{...baseTools,execute:async(...args)=>{await validateContext(context.run.input);return baseTools.execute(...args);}}:baseTools;
   const assistant=createPlatformAssistantService({practiceService,tools,provider,agentIdentity:context.run.configSnapshot.agentIdentity,
    quotedData:quotedContextData(freshContext),
    receiptResolver:async(_actor,requestId)=>service.historicalReceipt(row,requestId)});
   const result=await assistant.send(principal.actor,{requestId:row.id,message:context.run.input.message,context:context.run.input.context,history:context.run.input.history});
   if(unified)await validateContext(context.run.input);
   await repository.checkpoint(row,{...result,agent:{id:agent.id,displayName:context.run.configSnapshot.agentIdentity.displayName}});
   return {outputRef:{interactionId:row.id},runOutput:{type:'agent.interaction',id:row.id}};
  };
  if(run.status!=='succeeded'){
   if(['failed','uncertain','cancelled','rejected'].includes(run.status))throw Object.assign(new Error(run.error_code??'AGENT_INTERACTION_RUN_FAILED'),{code:run.error_code??'AGENT_INTERACTION_RUN_FAILED',uncertain:run.status==='uncertain'});
   const worker=createAgentRuntimeWorker({repository:runtimeRepository,targetRunId:id,recoverTargetRun:true,workerId:'interaction-chat-'+row.id,instanceId:randomUUID(),handlers:{'agent.conversation.turn:respond':respond},leaseSeconds:180,heartbeatSeconds:30,signal});
   try{const result=await worker.runOnce();if(result.status!=='completed'){
    const persisted=await readRun(id);if(persisted?.status!=='succeeded'){
     const error=Object.assign(new Error(persisted?.error_code??'AGENT_INTERACTION_RUN_WAITING'),{code:persisted?.error_code??'AGENT_INTERACTION_RUN_WAITING',retryable:['queued','running','waiting'].includes(persisted?.status),uncertain:persisted?.status==='uncertain'});throw error;
    }
   }}finally{await worker.stop();}
  }
  const completed=await repository.get(row.id);if(!completed.checkpoint_json)interactionFail('AGENT_INTERACTION_RESULT_MISSING',503);
  if(unified)await validateContext(run.input_json);
  return completed.checkpoint_json;
 };
}
