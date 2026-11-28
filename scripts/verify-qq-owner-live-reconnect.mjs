// Real QQ acceptance for the explicitly authorized, isolated Nov 27 lab only.
// Never targets a production service, reads credentials, sends messages, or
// restarts the gateway. The user supplies each fresh real QQ test message.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [directory,operation]=process.argv.slice(2),root=path.resolve(directory??'');
assert(root.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\20261127\\'),'LOCAL_LAB_REQUIRED');
assert(['restart-worker','capture-reconnected','verify','verify-final'].includes(operation),'EXPLICIT_OPERATION_REQUIRED');
const lab=JSON.parse(fs.readFileSync(path.join(root,'lab.json'),'utf8'));
assert(/^qq_owner_local_[a-f0-9]{20}$/.test(lab.labId),'LOCAL_LAB_ID_REQUIRED');
const id=lab.labId.slice('qq_owner_local_'.length),prefix='right-qq-owner-'+id;
assert.equal(lab.gateway,prefix+'-napcat');assert.equal(lab.worker,prefix+'-worker');assert.equal(lab.database,prefix+'-postgres');
assert.equal(lab.marker,'本地QQ验收20261127');assert.equal(lab.fixedReply,'本地验收收到20261127');
const address=new URL(lab.url);assert.equal(address.hostname,'127.0.0.1');assert.equal(address.protocol,'http:');
const run=args=>{
 const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:16*1024*1024});
 if(r.status!==0)throw Error('LOCAL_DOCKER_'+args[0].toUpperCase()+'_FAILED');return r.stdout.trim();
};
const inspect=name=>JSON.parse(run(['inspect',name]))[0];
for(const name of [lab.gateway,lab.worker,lab.database]){
 const c=inspect(name);assert.equal(c.Config.Labels?.['right.qq.owner-local'],id,'OWN_LAB_CONTAINER_REQUIRED');
 assert.equal(c.HostConfig.RestartPolicy.Name,'no');assert.equal(c.State.Running,true);
}
const shape=c=>({id:c.Id,name:c.Name.replace(/^\//,''),image:c.Image,running:c.State.Running,started:c.State.StartedAt,restarts:c.RestartCount,
 mounts:c.Mounts.map(m=>({type:m.Type,source:m.Source,destination:m.Destination,rw:m.RW})).sort((a,b)=>a.destination.localeCompare(b.destination))});
function inventory(){
 const ids=run(['ps','-aq']).split(/\r?\n/).filter(Boolean);
 return JSON.parse(run(['inspect',...ids])).map(shape).sort((a,b)=>a.name.localeCompare(b.name));
}
const sql=`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'messages',coalesce((SELECT json_agg(json_build_object('key',md5(message_id),'state',status,'attempts',attempt_count,
 'remoteConfirmed',remote_message_id ~ '^-?[0-9]+$','testMarker',strpos(input_text,'本地QQ验收20261127')>0,
 'replyExpected',reply='本地验收收到20261127','expectedGroup',origin_group_id='905757031',
 'allowedCaller',user_id IN ('495469022','52399347'),'createdAt',created_at,'updatedAt',updated_at) ORDER BY created_at)
 FROM mooyu_qq.messages),'[]'::json),
 'budget',(SELECT json_build_object('calls',count(*),'reserved',coalesce(sum(reserved_tokens),0),'actual',coalesce(sum(actual_tokens),0)) FROM mooyu_qq.attempts),
 'events',(SELECT json_object_agg(event_type,n) FROM (SELECT event_type,count(*) AS n FROM mooyu_qq.events GROUP BY event_type) t),
 'policy',(SELECT json_build_object('revision',revision,'loginRevision',login_revision,'hash',md5(policy::text)) FROM mooyu_qq.control_settings)
);COMMIT;`;
const database=()=>JSON.parse(run(['exec',lab.database,'psql','-U','qq_local','-d','mooyu_qq_local_'+id,'-Atq','-v','ON_ERROR_STOP=1','-c',sql]));
async function status(){const r=await fetch(lab.url+'/local-status',{signal:AbortSignal.timeout(10000)});assert(r.ok,'LOCAL_OBSERVER_UNAVAILABLE');return r.json();}
function ready(s){return s?.runtime?.loggedIn===true&&s.runtime?.coreReady===true&&s.runtime?.accountMatches===true&&s.runtime?.groupReady===true&&s.runtime?.connected===true&&s.runtime?.observation==='fresh'&&s.paperEnabled===false;}
function delivered(db){assert(db.messages.length>0,'REAL_NEW_MESSAGE_REQUIRED');for(const m of db.messages){assert.equal(m.state,'delivered');assert.equal(m.attempts,1);for(const k of ['remoteConfirmed','testMarker','replyExpected','expectedGroup','allowedCaller'])assert.equal(m[k],true,k);}assert.equal(db.budget.calls,db.messages.length);assert.equal(db.budget.actual,6*db.messages.length);}
const write=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const beforePath=path.join(root,'before-live-reconnect.json'),afterPath=path.join(root,'after-worker-reconnect.json');
if(operation==='restart-worker'||operation==='capture-reconnected'){
 let before;
 if(operation==='restart-worker'){
 assert(!fs.existsSync(beforePath)&&!fs.existsSync(afterPath),'ONE_LOCAL_RESTART_ONLY');
 before={at:new Date().toISOString(),inventory:inventory(),status:await status(),database:database()};
 assert(ready(before.status),'READY_REAL_LOGIN_REQUIRED');delivered(before.database);
 const patchedSha=run(['exec',lab.gateway,'sha256sum','/app/napcat/napcat.mjs']).split(/\s+/)[0];assert.equal(patchedSha,lab.sourceSha256);
 before.workerSourceSha256=crypto.createHash('sha256').update(fs.readFileSync(new URL('./qq-owner-live-worker.mjs',import.meta.url))).digest('hex');
 write('before-live-reconnect.json',before);
 // Only this newly created local lab worker may be stopped and started.
 run(['stop','-t','15',lab.worker]);run(['start',lab.worker]);
 }else{
  assert(fs.existsSync(beforePath)&&!fs.existsSync(afterPath),'RECONNECT_CHECKPOINT_REQUIRED');
  before=JSON.parse(fs.readFileSync(beforePath,'utf8'));
 }
 let current;for(let n=0;n<25;n++){try{current=await status();if(ready(current))break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 assert(ready(current),'WORKER_RECONNECT_NOT_VERIFIED');
 const after={at:new Date().toISOString(),inventory:inventory(),status:current,database:database()};
 const protectedBefore=before.inventory.filter(c=>c.name!==lab.worker),protectedAfter=after.inventory.filter(c=>c.name!==lab.worker);
 assert.deepEqual(protectedAfter,protectedBefore,'OTHER_CONTAINERS_CHANGED');
 const workerBefore=before.inventory.find(c=>c.name===lab.worker),workerAfter=after.inventory.find(c=>c.name===lab.worker);
 assert.equal(workerAfter.id,workerBefore.id);assert.equal(workerAfter.image,workerBefore.image);assert.notEqual(workerAfter.started,workerBefore.started);
 // Older local checkpoints included a redundant constant paperEnabled field.
 // Paper state is verified from the actual runtime, not a SQL literal.
 const comparable=db=>({...db,policy:((({paperEnabled,...p})=>p)(db.policy))});
 assert.deepEqual(comparable(after.database),comparable(before.database),'HISTORY_OR_POLICY_CHANGED_DURING_RECONNECT');
 write('after-worker-reconnect.json',after);
 console.log(JSON.stringify({result:'REAL_QQ_WORKER_RECONNECTED_NEW_MESSAGE_REQUIRED',loggedIn:current.runtime.loggedIn,groupReady:current.runtime.groupReady,
 gatewayNotRestarted:true,databaseNotRestarted:true,otherContainersUnchanged:true,historyAndPolicyUnchanged:true,oldTasksRetried:false,messagesSentByVerifier:false}));
}else{
 const before=JSON.parse(fs.readFileSync(beforePath,'utf8')),after=JSON.parse(fs.readFileSync(afterPath,'utf8')),current={at:new Date().toISOString(),inventory:inventory(),status:await status(),database:database()};
 assert(ready(current.status),'READY_REAL_LOGIN_REQUIRED');delivered(current.database);
 assert(current.database.messages.length>after.database.messages.length,'POST_RECONNECT_NEW_MESSAGE_REQUIRED');
 assert(current.database.messages.some(m=>Date.parse(m.createdAt)>Date.parse(after.at)),'NEW_MESSAGE_AFTER_RECONNECT_REQUIRED');
 for(const old of before.database.messages)assert.deepEqual(current.database.messages.find(m=>m.key===old.key),old,'OLD_MESSAGE_CHANGED');
 assert(process.argv.includes('--user-confirmed-reply'),'USER_VISIBLE_REPLY_CONFIRMATION_REQUIRED');
 const sessionRecovery=process.argv.includes('--after-session-recovery');
 assert.equal(current.database.policy.hash,before.database.policy.hash);assert.equal(current.database.policy.revision,before.database.policy.revision);
 if(!sessionRecovery)assert.equal(current.database.policy.loginRevision,before.database.policy.loginRevision);
 assert.deepEqual(current.inventory,after.inventory,'CONTAINER_CHANGED_AFTER_RECONNECT');
 let stability=null;
 if(operation==='verify-final'){
  const prior=JSON.parse(fs.readFileSync(path.join(root,'real-reconnect-acceptance.json'),'utf8'));
  const files=fs.readdirSync(root).filter(f=>/^stability-[0-9TZ.-]+\.json$/.test(f)).sort();assert(files.length>0,'STABILITY_EVIDENCE_REQUIRED');
  const observed=JSON.parse(fs.readFileSync(path.join(root,files.at(-1)),'utf8'));
  assert.equal(observed.result,'PASSED');assert(observed.observedSeconds>=600&&observed.samples.length>=50,'TEN_MINUTE_STABILITY_REQUIRED');
  const endedAt=observed.samples.at(-1).at;
  assert(current.database.messages.some(m=>Date.parse(m.createdAt)>Date.parse(endedAt)),'POST_WINDOW_NEW_MESSAGE_REQUIRED');
  for(const old of prior.current.database.messages)assert.deepEqual(current.database.messages.find(m=>m.key===old.key),old,'PRE_WINDOW_HISTORY_CHANGED');
  assert.deepEqual(current.database.policy,prior.current.database.policy,'POLICY_CHANGED_DURING_STABILITY');
  stability={result:observed.result,startedAt:observed.startedAt,endedAt,seconds:observed.observedSeconds,samples:observed.samples.length,
   file:files.at(-1),newMessageAfterWindow:true,historyAndPolicyUnchanged:true};
 }
 const proof={result:operation==='verify-final'?'REAL_QQ_LOCAL_FINAL_ACCEPTANCE_PASSED':'REAL_QQ_LOCAL_RECONNECT_ACCEPTANCE_PASSED',at:current.at,realQQLoginTested:true,realQQInboundTested:true,realQQOutboundAcknowledged:true,
 userConfirmedReply:true,postReconnectDeliveredCount:current.database.messages.length-after.database.messages.length,
 current,firstMessageEvidence:'User supplied QQ screenshot with fixed acceptance response',sameGatewayAndLoginMount:true,sameDatabase:true,
 workerReconnectVerifiedBeforeSeparateOffline:true,separateSessionRecoveryTested:sessionRecovery,oldMessagesUnchanged:true,policyUnchanged:true,productionAccessed:false,oldTasksRetried:false,
 stability,nativeAndProviderResponses:'real QQ native; fixed local test provider; no real model or unified Agent task dispatched'};
 write(operation==='verify-final'?'real-final-acceptance.json':'real-reconnect-acceptance.json',proof);console.log(JSON.stringify({...proof,current:{runtime:current.status.runtime,messageCount:current.database.messages.length,budget:current.database.budget}}));
}
