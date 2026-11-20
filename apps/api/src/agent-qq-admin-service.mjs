import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {qqSignature,qqUuid,qqAdminError,validateQQCommand} from './qq-admin-protocol.mjs';
export function createAgentQQAdminService({pool,env={},fetchImpl=fetch}){
 const enabled=env.QQ_ADMIN_ENABLED==='true';
 let secret,agentId;
 if(enabled){
  agentId=env.QQ_ADMIN_AGENT_USER_ID;
  if(!qqUuid(agentId)||env.QQ_ADMIN_ORIGIN!=='http://qq-control:6780')throw qqAdminError('QQ_ADMIN_CONFIG_INVALID',503);
  secret=readFileSync(env.QQ_ADMIN_SECRET_FILE,'utf8').trim();if(!/^[a-f0-9]{64}$/iu.test(secret))throw qqAdminError('QQ_ADMIN_CONFIG_INVALID',503);
 }
 async function authorize(actor,id){
  if(actor?.profile?.role!=='admin'||!qqUuid(actor?.userId))throw qqAdminError('QQ_ADMIN_REQUIRED',403);
  if(!qqUuid(id))throw qqAdminError('QQ_AGENT_NOT_FOUND',404);
  const account=(await pool.query("SELECT a.user_id FROM agent_accounts a JOIN users u ON u.id=a.user_id JOIN users o ON o.id=a.operator_user_id WHERE a.user_id=$1 AND a.operator_user_id=$2 AND a.status='active' AND u.status='active' AND o.status='active' AND o.role='admin' AND o.account_type='human'",[id,actor.userId])).rows[0];
  if(!account)throw qqAdminError('QQ_AGENT_NOT_FOUND',404);
  if(!enabled)throw qqAdminError('QQ_ADMIN_NOT_CONFIGURED',503);
  if(id!==agentId)throw qqAdminError('QQ_AGENT_NOT_BOUND',404);
 }
 async function forward(command,requestId){
   validateQQCommand(command,requestId,agentId);
   const body=JSON.stringify(command),timestamp=String(Date.now());let response;
   try{response=await fetchImpl(env.QQ_ADMIN_ORIGIN+'/control',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json','X-QQ-Time':timestamp,'X-QQ-Request':requestId,'X-QQ-Signature':qqSignature(secret,timestamp,requestId,body)},body});
    const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>131072)throw Error();chunks.push(chunk);}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!response.ok){const code=/^QQ_[A-Z0-9_]{1,70}$/u.test(value?.error?.code??'')?value.error.code:'QQ_CONTROL_UNAVAILABLE';throw qqAdminError(code,[400,409,429,503].includes(response.status)?response.status:503);}
    if(!value?.data||typeof value.data!=='object')throw Error();return value.data;
   }catch(error){if(error.code?.startsWith('QQ_'))throw error;throw qqAdminError('QQ_CONTROL_UNAVAILABLE',503);}
 }
 return {
  authorize,
  async readBoundChannelPolicy(){
   if(!enabled)throw qqAdminError('QQ_ADMIN_NOT_CONFIGURED',503);
   const row=(await pool.query("SELECT a.operator_user_id FROM agent_accounts a JOIN users o ON o.id=a.operator_user_id WHERE a.user_id=$1 AND a.status='active' AND o.status='active' AND o.role='admin' AND o.account_type='human'",[agentId])).rows[0];
   if(!row)throw qqAdminError('QQ_AGENT_NOT_FOUND',404);
   // Service-to-service configuration inspection only; this never grants the
   // chat requester an operator role or forwards a caller-selected operation.
   return forward({operation:'status',actorId:row.operator_user_id,agentUserId:agentId,args:{}},randomUUID());
  },
  async execute(actor,id,operation,args={},requestId=randomUUID()){
   await authorize(actor,id);return forward({operation,actorId:actor.userId,agentUserId:id,args},requestId);
  }
 };
}
