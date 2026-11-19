import {createHash} from 'node:crypto';
import {applyQQControlPolicy} from './config.mjs';
import {qqAdminError,qqPolicyView} from '../../api/src/qq-admin-protocol.mjs';
export class QQControlStore{
 constructor(repository){this.repository=repository;}
 async view(){
  const repo=this.repository,client=await repo.pool.connect();
  try{return await repo.transaction(client,async c=>{
   await repo.check(c);
   const row=(await c.query('SELECT revision,login_revision,policy,updated_at FROM mooyu_qq.control_settings WHERE channel_id=$1',[repo.id])).rows[0];
   const audit=(await c.query("SELECT event_type,details,created_at FROM mooyu_qq.events WHERE channel_id=$1 AND event_type LIKE 'admin-%' ORDER BY id DESC LIMIT 20",[repo.id])).rows;
   return {revision:row.revision,loginRevision:row.login_revision,settings:row.policy,status:await repo.status(c),audit:audit.map(item=>({type:item.event_type,at:item.created_at,actorId:item.details.actorId,revision:item.details.revision??null,requestId:item.details.requestId})),paperEnabled:false};
  });}finally{client.release();}
 }
 async mutate(requestId,command,refresh){
  const repo=this.repository,digest=createHash('sha256').update(JSON.stringify(command)).digest('hex');
  const candidate=command.operation==='configure'?applyQQControlPolicy(repo.bootstrap,command.args.settings):null;
  const result=await repo.locked(async client=>{
   const intent=await repo.transaction(client,async c=>{
    await repo.check(c);
    const prior=(await c.query('SELECT digest,result FROM mooyu_qq.control_requests WHERE channel_id=$1 AND request_id=$2',[repo.id,requestId])).rows[0];
    if(prior){if(prior.digest!==digest)throw qqAdminError('QQ_REQUEST_CONFLICT',409);if(!prior.result)throw qqAdminError('QQ_ACTION_UNCERTAIN',409);return {replay:true,result:prior.result};}
    const current=(await c.query('SELECT revision,login_revision,policy FROM mooyu_qq.control_settings WHERE channel_id=$1 FOR UPDATE',[repo.id])).rows[0];
    if(command.operation==='configure'){
     if(current.revision!==command.args.expectedRevision)throw qqAdminError('QQ_SETTINGS_CONFLICT',409);
     const saved={revision:current.revision+1,settings:qqPolicyView(candidate)};
     await c.query('UPDATE mooyu_qq.control_settings SET revision=$2,policy=$3,updated_at=now() WHERE channel_id=$1',[repo.id,saved.revision,JSON.stringify(saved.settings)]);
     await c.query('INSERT INTO mooyu_qq.control_requests(channel_id,request_id,digest,operation,result) VALUES($1,$2,$3,$4,$5)',[repo.id,requestId,digest,command.operation,JSON.stringify(saved)]);
     await repo.event(c,null,'admin-configured',{actorId:command.actorId,requestId,revision:saved.revision,before:current.policy,after:saved.settings});return {result:saved};
    }
    if(current.login_revision!==command.args.expectedLoginRevision)throw qqAdminError('QQ_LOGIN_CONFLICT',409);
    const loginRevision=current.login_revision+1;
    await c.query('UPDATE mooyu_qq.control_settings SET login_revision=$2,updated_at=now() WHERE channel_id=$1',[repo.id,loginRevision]);
    await c.query('INSERT INTO mooyu_qq.control_requests(channel_id,request_id,digest,operation) VALUES($1,$2,$3,$4)',[repo.id,requestId,digest,command.operation]);
    await repo.event(c,null,'admin-qr-refresh-requested',{actorId:command.actorId,requestId,revision:loginRevision});return {loginRevision};
   });
   if(intent.result)return intent.result;
   // Persist refresh intent before the external action. Unknown outcomes are
   // reviewed through current status/QR, never blindly executed a second time.
   try{await refresh();}catch{throw qqAdminError('QQ_ACTION_UNCERTAIN',409);}
   const saved={loginRevision:intent.loginRevision,refreshed:true};
   await repo.transaction(client,async c=>{
    await c.query('UPDATE mooyu_qq.control_requests SET result=$3 WHERE channel_id=$1 AND request_id=$2',[repo.id,requestId,JSON.stringify(saved)]);
    await repo.event(c,null,'admin-qr-refreshed',{actorId:command.actorId,requestId,revision:intent.loginRevision});
   });return saved;
  });
  if(result.busy)throw qqAdminError('QQ_WORKER_BUSY',409);return result;
 }
}
