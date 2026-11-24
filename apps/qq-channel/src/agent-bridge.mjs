import {createHash,randomUUID} from 'node:crypto';
import {agentChannelSignature} from '../../api/src/agent-channel-protocol.mjs';
import {validateArticleImage} from './article-image.mjs';
const fail=(code,retryable=false)=>{throw Object.assign(new Error(code),{code,retryable});};
export function agentRequestId(parts){const h=createHash('sha256').update(JSON.stringify(parts)).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
export function createQQAgentClient({url,secret,agentId,fetchImpl=fetch}){
 const endpoint=new URL('/v1/internal/agent/qq',url);
 if(!['api','localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.protocol!=='http:'||endpoint.username||endpoint.password||!/^[a-f0-9]{64}$/i.test(secret??'')||!/^[a-f0-9-]{36}$/i.test(agentId??''))fail('QQ_AGENT_CONFIG_INVALID');
 return async(body,{signal}={})=>{
  const timestamp=String(Date.now()),requestId=randomUUID(),payload={agentId,...body};
  let response;try{response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])]),headers:{'content-type':'application/json','x-agent-channel-time':timestamp,'x-agent-channel-request':requestId,'x-agent-channel-signature':agentChannelSignature(secret,timestamp,requestId,payload)},body:JSON.stringify(payload)});}catch{fail('QQ_AGENT_UNAVAILABLE',true);}
  const reader=response.body.getReader();let size=0;const chunks=[];
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>(body.operation==='article-image'?1500000:131072)){await reader.cancel();fail('QQ_AGENT_RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('QQ_AGENT_RESPONSE_INVALID',true);}
  if(!response.ok)fail(/^[A-Z0-9_]{1,100}$/.test(result?.error?.code??'')?result.error.code:'QQ_AGENT_REJECTED',response.status>=500||response.status===429);
  if(body.operation==='article-image')return validateArticleImage(result?.data);
  if(typeof result?.data?.id!=='string'||!['queued','running','waiting','completed','failed','needs-review'].includes(result.data.state)||typeof result.data.reply!=='string')fail('QQ_AGENT_RESPONSE_INVALID');
  return result.data;
 };
}
export const qqAgentReply=text=>{const bytes=Buffer.from(String(text));return bytes.length<=8000?String(text):bytes.subarray(0,7900).toString('utf8').replace(/\uFFFD$/u,'')+'\n（完整结果请查看任务记录）';};
export class QQAgentBridge{
 constructor({repository,client}){Object.assign(this,{repository,client});}
 origin(row,config){return {channel:'qq',actorRef:row.user_id,botId:config.botId,groupId:row.origin_group_id??config.groupId,conversationRef:[config.botId,row.origin_group_id??config.groupId,row.user_id].join(':'),eventRef:row.message_id};}
 async verifyImageAccess(row,config,signal){return this.client({operation:'article-image-access',origin:this.origin(row,config),interactionId:row.image_task_id},{signal});}
 async queued(c,row,config,signal){
  const repo=this.repository,link=await repo.agentLink(c,row),origin=this.origin(row,config);
  try{
   const value=link.interaction_id?await this.client({operation:'status',origin,interactionId:link.interaction_id},{signal}):await this.client({operation:'submit',origin,input:{requestId:link.request_id,message:row.input_text}},{signal});
   await repo.agentLinked(c,row,value);
   if(!['completed','failed','needs-review'].includes(value.state)){await repo.agentDefer(c,row);return {agentWaiting:true};}
   await repo.agentReady(c,row,qqAgentReply(value.reply));return {generated:true};
  }catch(error){if(error.retryable){await repo.agentDefer(c,row);return {agentWaiting:true};}await repo.agentReady(c,row,'这次请求未能完成，请在后台查看入口授权和任务状态。');return {agentRejected:true};}
 }
 async poll(c,config,signal){
  const row=await this.repository.agentPending(c);if(!row)return;
  if(!config.allowedUsers.includes(row.user_id)||row.origin_group_id!==config.groupId){await this.repository.agentFinish(c,row,{denied:true});return;}
  try{const value=await this.client({operation:'status',origin:this.origin(row,config),interactionId:row.task_id},{signal});
   if(['completed','failed','needs-review'].includes(value.state)){
    const pages=[];
    if(value.state==='completed'&&value.kind==='github-article'&&value.articleRevisionId){
     const request=page=>this.client({operation:'article-image',origin:this.origin(row,config),interactionId:row.task_id,page},{signal});
     const first=validateArticleImage(await request(0));pages.push(first);
     for(let i=1;i<first.pageCount;i++){const next=validateArticleImage(await request(i));if(next.page!==i||next.pageCount!==first.pageCount||next.revisionId!==first.revisionId)fail('QQ_AGENT_IMAGE_REVISION_CHANGED',true);pages.push(next);}
     if(first.page!==0||first.revisionId!==value.articleRevisionId)fail('QQ_AGENT_IMAGE_REVISION_CHANGED',true);
    }
    await this.repository.agentFinish(c,row,{reply:qqAgentReply(value.reply),pages});
   }
   else await this.repository.agentPollLater(c,row);
  }catch(error){if(error.retryable)await this.repository.agentPollLater(c,row);else if(error.code?.startsWith('AGENT_ARTICLE_IMAGE_'))await this.repository.agentFinish(c,row,{reply:'文章已保存，但图片生成未完成，请在后台查看文章和错误状态。',presentationError:error.code});else await this.repository.agentFinish(c,row,{denied:true});}
 }
}
