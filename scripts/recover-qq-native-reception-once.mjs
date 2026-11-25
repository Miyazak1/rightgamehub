// Explicit manual recovery of a confirmed silent receive incident. This does
// not change the automatic policy or treat quiet groups as restart evidence.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {Cutover,PAPER_KEYS} from './agent-server-cutover.mjs';
import {assertGuardianIdentity,assertGuardianSnapshot,acquireGuardianLease,WORKER_SNAPSHOT_PROBE} from './qq-plugin-guardian.mjs';
import {decideQQRecovery} from '../apps/qq-channel/src/recovery-policy.mjs';
import {archiveLoginData} from './recover-qq-gateway-once.mjs';
import {nativeReceptionLogSummary,NATIVE_RECEPTION_PROBE} from './qq-native-reception-readonly.mjs';
const ROOT='/www/backup/gamehub',GUARDIAN=ROOT+'/qq-independent-guardian-20261124-r1',GATEWAY='mooyu-qq-napcat-1',WORKER='mooyu-qq-worker-1';
const INCIDENT='qq-native-receive-20261125-B',INTENT=ROOT+'/'+INCIDENT+'-once.private.json';
const fail=code=>{throw Error(code);};
export function reserveManualReceiveRecovery(prior,now=Date.now()){
 decideQQRecovery(prior,{runtime:{}},now); // Validate the existing state; do not use/reset its derived result.
 if(!prior||prior.manualRequired||prior.lastAt>now)fail('GUARDIAN_REVIEW_PENDING');
 if(prior.incidentHandled)fail('GUARDIAN_INCIDENT_ALREADY_HANDLED');
 const recent=prior.attempts.filter(t=>now-t<86400000);
 if(recent.length>=2)fail('DAILY_RESTART_LIMIT');
 if(recent.length&&now-Math.max(...recent)<900000)fail('RESTART_COOLDOWN');
 return {...structuredClone(prior),attempts:[...prior.attempts,now],lastAt:now,manualRequired:true,incidentHandled:true,lastOutcome:'manual-reception-reserved'};
}
export async function manualReceiveRecoverySequence({reserved,io}){
 let stopIssued=false,started=false;await io.guard();await io.save(reserved);
 try{
  await io.backup(false);await io.guard();await io.confirmIncident();await io.assertIdle();
  reserved.lastOutcome='stop-requested';await io.save(reserved);stopIssued=true;await io.stop();
  try{await io.backup(true);}finally{
   await io.guardStopped();reserved.lastOutcome='start-requested';await io.save(reserved);await io.start();started=true;
  }
  await io.verify();const done={...reserved,manualRequired:false,lastOutcome:'gateway-started'};await io.save(done);return done;
 }catch(e){await io.save({...reserved,lastOutcome:stopIssued&&!started?'gateway-start-required':'review-required'});throw e;}
}
function run(command,args,options={}){const r=spawnSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024,...options});if(r.status!==0||r.error)fail('RECOVERY_TOOL_FAILED');return r.stdout?.trim()??'';}
const docker=(args,options)=>run('docker',args,options);
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
function fileHash(p){const h=crypto.createHash('sha256'),fd=fs.openSync(p,'r'),b=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');}
function read(p){const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||s.size>32*1024*1024)fail('PRIVATE_RECORD_REQUIRED');return JSON.parse(fs.readFileSync(p,'utf8'));}
function save(p,v){const next=p+'.next-'+crypto.randomBytes(6).toString('hex');fs.writeFileSync(next,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});const fd=fs.openSync(next,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(next,p);const dir=fs.openSync(path.dirname(p),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
const env=c=>Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
const all=()=>{const ids=docker(['ps','-aq']).split(/\s+/).filter(Boolean);if(!ids.length)fail('CONTAINERS_REQUIRED');return JSON.parse(docker(['inspect',...ids]));};
const snapshot=c=>({id:c.Id,name:c.Name,image:c.Image,config:c.Config,host:c.HostConfig,mounts:c.Mounts,networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort(),running:c.State.Running,startedAt:c.State.StartedAt,restarts:c.RestartCount});
const protectedNow=()=>all().filter(c=>c.Name!=='/'+GATEWAY).map(snapshot).sort((a,b)=>a.id.localeCompare(b.id));
function oldLocks(){return ['agent-cutover-files-20261122-r1','agent-cutover-files-post-paper-20261122-r1','agent-cutover-files-post-paper-20261123-r2'].map(n=>{
 const root=ROOT+'/'+n;if(read(root+'/state.private.json').executionLocked!==true)fail('OLD_LOCK_CHANGED');return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(d=>{if(!d.isFile()||d.isSymbolicLink())fail('OLD_LOCK_LAYOUT_CHANGED');return[d.name,fileHash(root+'/'+d.name),fs.statSync(root+'/'+d.name).mode&511];});});}
export async function recoverNativeReceptionOnce(mode){
 if(process.platform!=='linux'||process.getuid?.()!==0||!['plan','apply','acceptance'].includes(mode))fail('LINUX_ROOT_RECOVERY_ENTRY_REQUIRED');
 if(mode==='apply'&&process.env.MOOYU_QQ_NATIVE_RECEIVE_RECOVERY_AUTH!=='20261125-once')fail('EXPLICIT_GATEWAY_RESTART_AUTHORIZATION_REQUIRED');
 let release=null,record=null,phase='preflight',stopIssued=false,startIssued=false;
 try{
  if(mode!=='acceptance'){release=acquireGuardianLease('/var/lock/mooyu-agent-plugin-cutover.lock');if(!release)fail('MAINTENANCE_IN_PROGRESS');}
  const config=read(GUARDIAN+'/config.private.json'),gateway=inspect(GATEWAY),worker=inspect(WORKER);assertGuardianIdentity(gateway,config);
  if(!config.enabled||config.botId!=='3922489710'||config.groupId!=='905757031'||worker.State.Health?.Status!=='healthy')fail('REVIEWED_CHANNEL_REQUIRED');
  const prior=read(GUARDIAN+'/recovery-state.private.json');
  const stage=ROOT+'/qq-observation-release-20261125-r1',index=read(stage+'/last-operation.private.json');
  if(!/^\/www\/backup\/gamehub\/qq-observation-operation-20261125-[A-Za-z0-9]+$/.test(index.record??''))fail('OBSERVATION_RECORD_REQUIRED');
  const deployment=read(index.record+'/state.private.json'),receipt=read(index.record+'/result.private.json');
  if(receipt.result!=='QQ_OBSERVATION_WORKER_UPDATED_VERIFIED'||receipt.image!==worker.Image)fail('WORKER_DEPLOYMENT_CHANGED');
  const reader=new Cutover(ROOT);reader.state=deployment;reader.processEnv={...process.env,...deployment.composeEnvironment};
  const sql=(db,q)=>reader.sql(deployment.databases[db],q),json=(db,q)=>JSON.parse(sql(db,q));
  const probe=()=>assertGuardianSnapshot(JSON.parse(docker(['exec',WORKER,'node','--input-type=module','-e',WORKER_SNAPSHOT_PROBE],{timeout:12000})),config);
  if(mode==='acceptance'){
   const intent=read(INTENT);record=intent.record;if(!record.startsWith(GUARDIAN+'/recovery-')||path.dirname(record)!==GUARDIAN)fail('EXACT_RECOVERY_RECORD_REQUIRED');
   const result=read(record+'/result.private.json'),since=result.startedAt;if(!/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(since??''))fail('RECOVERY_START_TIME_REQUIRED');
   const s=probe(),messages=json('qq',`SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT message_id,status,created_at,remote_message_id IS NOT NULL AS remote_confirmed,position('收到C' in COALESCE(reply,''))>0 AS expected_reply FROM mooyu_qq.messages WHERE channel_id='3922489710:905757031' AND origin_group_id='905757031' AND user_id='495469022' AND created_at>='${since}' AND position('QQ原生恢复验收20261125C' in input_text)>0 ORDER BY created_at DESC LIMIT 8) t`);
   console.log(JSON.stringify({result:s.runtime.ready&&messages.some(m=>m.status==='delivered'&&m.remote_confirmed&&m.expected_reply)?'NATIVE_RECEPTION_NEW_REPLY_CONFIRMED':'NATIVE_RECEPTION_NEW_REPLY_PENDING',runtime:s.runtime,messages,oldTasksRetried:false},null,2));return;
  }
  if(fs.existsSync(INTENT))fail('INCIDENT_RECOVERY_ALREADY_RESERVED_NO_RETRY');
  const now=Date.now();if(new Date(now+8*3600000).toISOString().slice(0,10)!=='2026-11-25')fail('REVIEWED_INCIDENT_DATE_EXPIRED');
  const reserved=reserveManualReceiveRecovery(prior,now);
  const files=deployment.files.map(f=>{if(fileHash(f.path)!==f.sha256)fail('DEPLOYMENT_FILE_CHANGED');return {...f};});
  const guardsBefore={containers:hash(protectedNow()),locks:hash(oldLocks())};
  function papers(){const cs=all();for(const name of ['gamehub-production-agent-paper-research-worker-1','mooyu-desktop-business-test-business-paper-worker-1']){const c=cs.find(c=>c.Name==='/'+name);if(!c||c.State.Running||c.HostConfig.RestartPolicy.Name!=='no')fail('PAPERS_MUST_REMAIN_CLOSED');}for(const c of cs)if(c.State.Running&&(PAPER_KEYS.some(k=>env(c)[k]==='true')||env(c).DESKTOP_BUSINESS_TEST_PAPER_ENABLED==='true'))fail('PAPER_FLAG_CHANGED');}
  const history=()=>({invariants:reader.invariants(),api:Object.fromEntries(['agent_channel_participants','agent_budget_reservations','agent_interactions','agent_interaction_events','agent_runs','agent_run_stages','agent_runtime_outbox','agent_provider_calls','blog_articles','blog_article_revisions'].map(t=>[t,sql('api',`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) FROM ${t} t`)])),qq:Object.fromEntries(['messages','agent_links','agent_deliveries','agent_image_pages','events'].map(t=>[t,sql('qq',`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) FROM mooyu_qq.${t} t`)]))});
  function idle(){for(const [db,q]of [['qq',"SELECT count(*) FROM mooyu_qq.messages WHERE status NOT IN ('delivered','failed')"],['qq','SELECT count(*) FROM mooyu_qq.agent_links WHERE task_id IS NOT NULL AND NOT task_settled'],['api',"SELECT count(*) FROM agent_interactions WHERE state IN ('queued','running','waiting','needs-review')"],['api',"SELECT count(*) FROM agent_runs WHERE status IN ('queued','running','waiting','uncertain')"]])if(Number(sql(db,q)))fail('ACTIVE_OR_UNCERTAIN_TASK_NO_RETRY');const schedules=json('api',"SELECT COALESCE(json_agg(json_build_object('enabled',enabled,'next',next_fire_at,'protocol',config_json#>>'{worker,interactionProtocolVersion}')),'[]'::json) FROM agent_schedules WHERE agent_user_id='c98abda1-d115-4e05-9c2e-43f68119386a'");if(schedules.length!==1||schedules[0].protocol!=='1'||schedules[0].enabled&&Date.parse(schedules[0].next)-Date.now()<45*60000)fail('SCHEDULE_WINDOW_REQUIRED');}
  function incident(){const s=probe(),r=s.runtime;if(!r.available||!r.loggedIn||!r.coreReady||!r.accountMatches||!r.groupReady||!r.connected||Date.now()-Date.parse(r.verifiedAt)>30000)fail('INCIDENT_STATE_CHANGED');
   const native=JSON.parse(docker(['exec',GATEWAY,'node','--input-type=module','-e',NATIVE_RECEPTION_PROBE]));if(native.source.sha256!=='7967149b1c4f3d30e0506c842f84b7b925c2d361e3c9c75ebf0d4ff24dbdedaa'||!native.configuration.some(c=>c.consoleLog===true&&['info','debug','trace'].includes(c.consoleLogLevel)))fail('NATIVE_LOG_EVIDENCE_UNAVAILABLE');
   const raw=spawnSync('docker',['logs','--since','2026-11-24T05:00:00Z','--tail','10000','--timestamps',GATEWAY],{encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});if(raw.status!==0||raw.error)fail('NATIVE_LOG_EVIDENCE_UNAVAILABLE');const counters=nativeReceptionLogSummary(String(raw.stdout??'')+'\n'+String(raw.stderr??''));
   if(!counters.receivedExpectedCaller.count||!counters.receivedAny.lastAt||Date.parse(counters.receivedAny.lastAt)>=Date.parse('2026-11-25T00:00:00Z')||counters.freshTestMarker.count)fail('NEW_NATIVE_TRAFFIC_NO_RESTART');return counters;
  }
  papers();idle();const evidence=incident(),historyBefore=hash(history());
  const guard=()=>{assertGuardianIdentity(inspect(GATEWAY),config);if(hash(protectedNow())!==guardsBefore.containers||hash(oldLocks())!==guardsBefore.locks||hash(history())!==historyBefore||files.some(f=>fileHash(f.path)!==f.sha256))fail('PRESERVED_STATE_CHANGED');papers();};
  const volume=gateway.Mounts.find(m=>m.Destination==='/data'),vi=JSON.parse(docker(['volume','inspect',volume.Name]))[0];if(vi.Mountpoint!==volume.Source)fail('LOGIN_VOLUME_SOURCE_CHANGED');
  const bytes=Number(run('du',['-sb','--',volume.Source]).split(/\s/)[0]),space=fs.statfsSync(GUARDIAN);if(!Number.isSafeInteger(bytes)||bytes<1||space.bavail*space.bsize<bytes*3+1073741824)fail('LOGIN_BACKUP_DISK_SPACE_REQUIRED');
  if(mode==='plan'){console.log(JSON.stringify({result:'NATIVE_RECEIVE_RECOVERY_PLAN_READY',incident:INCIDENT,scope:[GATEWAY],sameContainerImageAndLoginVolume:true,existingRestartAttempts:prior.attempts.filter(t=>now-t<86400000).length,newAttemptsReserved:0,evidence,willRestartGatewayOnce:true,willNotRestart:[WORKER,'API','Web','executor','scheduler','databases','desktop'],papersStillClosed:true,servicesRestarted:false},null,2));return;}
  record=fs.mkdtempSync(GUARDIAN+'/recovery-');fs.chmodSync(record,0o700);reserved.recoveryDirectory=record;
  fs.writeFileSync(INTENT,JSON.stringify({incident:INCIDENT,record,reservedAt:new Date(now).toISOString()})+'\n',{flag:'wx',mode:0o600});
  save(record+'/before.private.json',{gateway:snapshot(gateway),protected:guardsBefore,historyBefore,guardianBefore:prior,files,evidence});
  const receipts=[],advance=p=>{phase=p;console.log('QQ原生收件恢复阶段：'+p);save(record+'/progress.private.json',{phase,stopIssued,startIssued});};
  await manualReceiveRecoverySequence({reserved,io:{save:s=>save(GUARDIAN+'/recovery-state.private.json',s),guard,
   backup:async cold=>{advance(cold?'backup-while-stopped':'backup-before-stop');const b=archiveLoginData(record,cold?'login-stopped.tar':'login-before-stop.tar',{quiesced:cold});receipts.push({name:b.file,sha256:b.sha256,bytes:b.bytes,fullyDecoded:b.archiveFullyRead,quiesced:b.quiesced});save(record+'/backups.private.json',receipts);},confirmIncident:incident,assertIdle:idle,
   stop:async()=>{advance('stop-original-gateway-once');stopIssued=true;docker(['stop','--timeout','-1',GATEWAY],{timeout:90000});},guardStopped:()=>assertGuardianIdentity(inspect(GATEWAY),config,{running:false}),
   start:async()=>{advance('start-original-gateway-once');startIssued=true;docker(['start',GATEWAY]);},verify:async()=>{advance('verify-preservation');guard();const c=inspect(GATEWAY);if(c.Id!==gateway.Id||c.State.StartedAt===gateway.State.StartedAt)fail('SAME_GATEWAY_START_NOT_CONFIRMED');}
  }});
  const result={result:'NATIVE_GATEWAY_RESTARTED_ONCE_AWAITING_NEW_MESSAGE',record,startedAt:inspect(GATEWAY).State.StartedAt,onlyGatewayRestarted:true,sameContainerImageAndLoginVolume:true,otherServicesPermissionsBudgetsSchedulesHistoryAndOldLocksPreserved:true,papersStillClosed:true,guardianPolicyUnchanged:true,restartAttemptAdded:1,automaticRetry:false,oldTasksRetried:false,newQQReplyConfirmed:false};save(record+'/result.private.json',result);console.log(JSON.stringify(result,null,2));
 }catch(e){const result={result:'NATIVE_RECEIVE_RECOVERY_REVIEW_REQUIRED',record,phase,stopIssued,startIssued,code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'RECOVERY_FAILED',automaticRetry:false,loginDataMustNotBeCleared:true};if(record)save(record+'/failure.private.json',result);console.error(JSON.stringify(result));process.exitCode=1;}finally{release?.();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await recoverNativeReceptionOnce(process.argv[2]);
