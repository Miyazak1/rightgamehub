import {normalizeInteractionOrigin,interactionFail,interactionUuid} from './agent-interaction-contracts.mjs';
import {verifyAgentChannelSignature} from './agent-channel-protocol.mjs';

export function createAgentWebAssistantAdapter(service){return {
 capabilities:()=>service.capabilities(),
 async send(actor,input){
  const origin={channel:'web',platformUserId:actor.userId,actorRef:actor.userId,conversationRef:input.conversationId??input.requestId,eventRef:input.requestId};
  const value=await service.receive(origin,{requestId:input.requestId,message:input.message,context:input.context??null});
  return {requestId:input.requestId,reply:value.reply,interaction:{id:value.id,state:value.state},agentId:service.agentId,
   ...(value.task?{task:value.task}:{}),...(value.results?{results:value.results}:{}),...(value.actions?{actions:value.actions}:{})};
 },
};}
export function registerAgentInteractionRoutes(app,{service,requireAuth,channelSecret}){
 const run=async(reply,fn)=>{reply.header('Cache-Control','no-store');try{return {data:await fn()};}catch(error){if(/^AGENT_[A-Z0-9_]+$/u.test(error.code??'')){reply.status(error.statusCode??503);return {error:{code:error.code,message:interactionErrorLabel(error.code)}};}reply.status(503);return {error:{code:'AGENT_INTERACTION_UNAVAILABLE',message:'小墨鱼暂时不可用，请稍后查看状态。'}};}};
 app.get('/v1/me/agent/interactions/:id',{preHandler:requireAuth,schema:{params:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string',format:'uuid'}}}}},async(req,reply)=>run(reply,()=>service.status({channel:'web',actorRef:req.actor.userId,platformUserId:req.actor.userId,conversationRef:req.params.id,eventRef:req.params.id},req.params.id)));
 app.get('/v1/admin/agents/:agentId/channel-participants',{preHandler:requireAuth},async(req,reply)=>run(reply,async()=>{if(req.params.agentId!==service.agentId)interactionFail('AGENT_INTERACTION_NOT_FOUND',404);return service.participants(req.actor);}));
 app.put('/v1/admin/agents/:agentId/channel-participants',{preHandler:requireAuth,bodyLimit:4096},async(req,reply)=>run(reply,async()=>{if(req.params.agentId!==service.agentId)interactionFail('AGENT_INTERACTION_NOT_FOUND',404);return service.configureParticipant(req.actor,req.body);}));
 app.post('/v1/internal/agent/qq',{logLevel:'silent',bodyLimit:12000},async(req,reply)=>run(reply,async()=>{
  verifyAgentChannelSignature(channelSecret,req.headers,req.body);
  const body=req.body;if(!body||Object.keys(body).some(k=>!['agentId','operation','origin','input','interactionId'].includes(k))||body.agentId!==service.agentId||!['submit','status'].includes(body.operation)||body.origin?.channel!=='qq')interactionFail('AGENT_CHANNEL_INPUT');
  const origin=normalizeInteractionOrigin(body.origin);
  if(body.operation==='submit'){
   if(Object.hasOwn(body,'interactionId'))interactionFail('AGENT_CHANNEL_INPUT');return service.receive(origin,body.input);
  }
  if(Object.hasOwn(body,'input')||!interactionUuid(body.interactionId))interactionFail('AGENT_CHANNEL_INPUT');return service.status(origin,body.interactionId);
 }));
}
export function interactionErrorLabel(code){return ({AGENT_INTERACTION_INVOKE_DENIED:'当前提问者尚未获准发起小墨鱼的研究写作任务。',AGENT_INTERACTION_CHANNEL_DENIED:'当前群或提问者未获准使用这个小墨鱼入口。',AGENT_INTERACTION_REQUEST_CONFLICT:'这条消息已对应其他请求，请查看原任务。',AGENT_INTERACTION_SETTINGS_CONFLICT:'授权已更新，请刷新后再保存。',AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED:'任务执行器需要完成兼容升级，尚未开始研究写作。',AGENT_INTERACTION_RATE_LIMITED:'请求较多，请等待已有任务完成。',AGENT_INTERACTION_NOT_FOUND:'未找到可访问的任务。'})[code]??'小墨鱼暂时无法完成这次请求，请查看任务状态后重试。';}
