// Gateway-only configuration repair. No migrations, login-data deletion,
// task retries, image upgrades, or restarts of any other service.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {archiveLoginData} from './recover-qq-gateway-once.mjs';
import {verifyDeclaredRuntime} from './github-search-runtime-verification.mjs';
const ROOT='/www/backup/gamehub',NAME='mooyu-qq-napcat-1',IMAGE='sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d';
const fail=c=>{throw Error(c);},read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const env=c=>Object.fromEntries(c.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
function fileHash(p){const fd=fs.openSync(p,'r'),h=crypto.createHash('sha256'),b=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');}
function docker(args,options={}){const r=spawnSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,...options});if(r.error||r.status!==0)fail('DOCKER_'+args[0].replaceAll('-','_').toUpperCase()+'_FAILED');return r.stdout?.trim()??'';}
export function gatewayComparable(c,originalFlag){
 const config=structuredClone(c.Config);for(const k of ['Hostname','Image','AttachStdin','AttachStdout','AttachStderr'])delete config[k];
 config.Env=config.Env.map(v=>v.startsWith('NAPCAT_DISABLE_MULTI_PROCESS=')?'NAPCAT_DISABLE_MULTI_PROCESS='+originalFlag:v).sort();
 config.Labels=Object.fromEntries(Object.entries(config.Labels??{}).filter(([k])=>!k.startsWith('com.docker.compose.')));
 const host=structuredClone(c.HostConfig);if(host.Binds)host.Binds.sort();if(host.Mounts)host.Mounts.sort((a,b)=>String(a.Target).localeCompare(String(b.Target)));
 return {config,host,mounts:c.Mounts.map(m=>[m.Type,m.Name??'',m.Source,m.Destination,m.RW]).sort(),networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()};
}
export async function gatewayModeSequence(a){await a.preflight();await a.record();await a.warmBackup();await a.recheck();await a.stop();await a.coldBackup();await a.start();await a.verify();}
export function assertGatewayPorts(container,service){
 const expected={};for(const p of service.ports??[]){if(!p||typeof p!=='object'||!Number.isSafeInteger(p.target)||!/^\d+$/.test(String(p.published??'')))fail('CONCRETE_MANAGEMENT_PORT_REQUIRED');const key=p.target+'/'+(p.protocol??'tcp');(expected[key]??=[]).push({HostIp:p.host_ip??'0.0.0.0',HostPort:String(p.published)});}
 const sorted=v=>Object.fromEntries(Object.entries(v??{}).map(([k,a])=>[k,a.slice().sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)))]));
 if(hash(sorted(container.HostConfig.PortBindings))!==hash(sorted(expected)))fail('DECLARED_MANAGEMENT_PORT_MISMATCH');
}
export function assertGatewayUlimits(container,service){
 // `docker compose config --format json` omits zero-valued fields. In that
 // canonical representation core:0 is core:{}, not an unspecified limit.
 const limit=n=>Number.isSafeInteger(n)&&n>=-1;
 for(const [name,value]of Object.entries(service.ulimits??{})){
  let soft,hard;
  if(typeof value==='number'){soft=hard=value;}
  else if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['single','soft','hard'].includes(k))){
   if(Object.hasOwn(value,'single')){if(Object.hasOwn(value,'soft')||Object.hasOwn(value,'hard'))fail('ULIMIT_FORMAT_REVIEW_REQUIRED');soft=hard=value.single;}
   else{soft=Object.hasOwn(value,'soft')?value.soft:0;hard=Object.hasOwn(value,'hard')?value.hard:0;}
  }else fail('ULIMIT_FORMAT_REVIEW_REQUIRED');
  if(!limit(soft)||!limit(hard))fail('ULIMIT_FORMAT_REVIEW_REQUIRED');
  const actual=container.HostConfig.Ulimits?.find(v=>v.Name===name);
  if(!actual||actual.Soft!==soft||actual.Hard!==hard)fail('DECLARED_ULIMIT_MISMATCH');
 }
}
const nativeProbe=String.raw`
import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';
const c=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:'diagnostic-unused'});let last={readFailed:true};
for(let n=0;n<7;n++){
 try{const s=await c.post('/QQLogin/CheckLoginStatus'),i=await c.post('/QQLogin/GetQQLoginInfo');let qr;try{qr=new URL(s.qrcodeurl);}catch{}
 last={readFailed:false,loggedIn:s.isLogin===true,coreReady:s.coreReady===true,coreOnline:i.online===true,expectedAccount:String(i.uin)==='3922489710',phase:['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed','reconnecting'].includes(s.loginPhase)?s.loginPhase:'unknown',qrAvailable:!!qr&&qr.protocol==='https:'&&(qr.hostname==='qq.com'||qr.hostname.endsWith('.qq.com'))&&!qr.username&&!qr.password&&qr.href.length<=4096,restartCallbackUninitialized:String(s.loginError??'').includes('重启功能未初始化')};
 if(last.loggedIn&&last.coreReady&&last.coreOnline&&last.expectedAccount||last.phase==='waiting_qrcode'&&last.qrAvailable)break;
 }catch(e){last={readFailed:true,code:/^QQ_[A-Z0-9_]+$/.test(e.code??'')?e.code:'STATUS_READ_FAILED'};}
 if(n<6)await new Promise(r=>setTimeout(r,10000));
}console.log(JSON.stringify(last));`;
export async function repairGatewayMode(mode='apply',prior=null){
 let directory=null,phase='preflight',locked=false,stopIssued=false,recreateIssued=false;
 const inspect=n=>JSON.parse(docker(['inspect',n]))[0];
 const all=()=>JSON.parse(docker(['inspect',...docker(['ps','-aq']).split(/\s+/).filter(Boolean)]));
 let core,reader,before,role,model,files,othersBefore,domainBefore,oldLocksBefore,targetFlag='0';const backups=[];
 const stage=p=>{phase=p;console.log('QQ网关修复阶段：'+p);if(directory)fs.writeFileSync(directory+'/phase.private.json',JSON.stringify({mode,phase,stopIssued,recreateIssued})+'\n',{mode:0o600});};
 const otherSnapshot=()=>all().filter(c=>c.Name!=='/'+NAME).map(c=>({id:c.Id,name:c.Name,image:c.Image,running:c.State.Running,started:c.State.StartedAt,restarts:c.RestartCount,config:c.Config,host:c.HostConfig,mounts:c.Mounts,networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()})).sort((a,b)=>a.id.localeCompare(b.id));
 const oldLocks=()=>['agent-cutover-files-20261122-r1','agent-cutover-files-post-paper-20261122-r1','agent-cutover-files-post-paper-20261123-r2'].map(n=>{const p=ROOT+'/'+n;if(read(p+'/state.private.json').executionLocked!==true)fail('OLD_EXECUTION_LOCK_CHANGED');return fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(f=>{if(!f.isFile()||f.isSymbolicLink())fail('OLD_RECORD_LAYOUT_CHANGED');return[f.name,fileHash(p+'/'+f.name),fs.statSync(p+'/'+f.name).mode&0o777];});});
 const q=(which,sql)=>reader.sql(reader.state.databases[which],sql);
 const domain=()=>({invariants:reader.invariants(),participants:q('api',"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY agent_user_id,channel,actor_ref)::text,'')) FROM agent_channel_participants t"),usage:q('api',"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM agent_budget_reservations t"),history:Object.fromEntries(['agent_runs','agent_run_stages','agent_interactions','agent_interaction_events','agent_runtime_outbox','blog_articles','blog_article_revisions'].map(t=>[t,q('api',`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM ${t} t`)])),qqMessages:q('qq',"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY channel_id,message_id)::text,'')) FROM mooyu_qq.messages t")});
 const idle=()=>{for(const [db,sql]of [['qq',"SELECT count(*) FROM mooyu_qq.messages WHERE status NOT IN ('delivered','failed','cancelled')"],['api',"SELECT count(*) FROM agent_interactions WHERE state IN ('queued','running','waiting','needs-review')"],['api',"SELECT count(*) FROM agent_runs WHERE status IN ('queued','running','waiting','uncertain')"]])if(Number(q(db,sql))!==0)fail('ACTIVE_WORK_OR_DELIVERY');};
 const guards=()=>{if(hash(otherSnapshot())!==hash(othersBefore)||hash(domain())!==hash(domainBefore)||hash(oldLocks())!==hash(oldLocksBefore))fail('PROTECTED_STATE_CHANGED');for(const f of files)if(fileHash(f.path)!==f.sha256)fail('ORIGINAL_COMPOSE_OR_ENV_CHANGED');idle();};
 const compose=(overlay,args)=>reader.compose(role,overlay,args);
 const verifyModel=(c,s)=>{
  // Published management port is allowed only when it remains exactly the
  // preflight value. The shared checker independently verifies all other
  // declared resources/security/health settings, alongside core captureRole.
  if(hash(c.HostConfig.PortBindings)!==hash(before.HostConfig.PortBindings))fail('MANAGEMENT_PORT_CHANGED');assertGatewayPorts(c,s);
  assertGatewayUlimits(c,s);
  const declared={...s,ports:[]};delete declared.ulimits;
  verifyDeclaredRuntime({...c,HostConfig:{...c.HostConfig,PortBindings:{}}},declared,JSON.parse(docker(['image','inspect',IMAGE]))[0]);
 };
 try{
  if(process.env.MOOYU_GATEWAY_MODE_AUTH!=='20261124'||!['apply','rollback'].includes(mode))fail('GATEWAY_MODE_AUTHORIZATION_REQUIRED');
  fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});locked=true;
  if(mode==='rollback'){if(!prior?.startsWith(ROOT+'/qq-gateway-mode-20261124-')||fs.lstatSync(prior).isSymbolicLink())fail('PRIOR_MODE_RECORD_REQUIRED');const previous=read(prior+'/state.private.json');if(previous.image!==IMAGE||previous.originalFlag!=='1')fail('ORIGINAL_MODE_REQUIRED');targetFlag='1';}
  await gatewayModeSequence({
   preflight:async()=>{
    const corePath=ROOT+'/github-search-release-20261123-verification-r1/agent-server-cutover.mjs';if(fileHash(corePath)!=='1dcbf5e2e9202867fec8f76de9f3f63b43585c87b27f1bcbd784cf8c352606b6')fail('AUDITED_CORE_CHANGED');core=await import(pathToFileURL(corePath));
    before=inspect(NAME);if(before.Image!==IMAGE||mode==='apply'&&!before.State.Running)fail('EXPECTED_GATEWAY_REQUIRED');
    const values=env(before);if(!['0','1'].includes(values.NAPCAT_DISABLE_MULTI_PROCESS)||mode==='apply'&&values.NAPCAT_DISABLE_MULTI_PROCESS!=='1'||values.NAPCAT_DISABLE_MULTIPROCESSING==='1'||values.NAPCAT_WORKER_PROCESS==='1')fail('REVIEWED_GATEWAY_MODE_REQUIRED');
    const v=before.Mounts.find(m=>m.Destination==='/data');if(v?.Type!=='volume'||v.Name!=='mooyu-qq-compatible-55b2f7e8-088f12')fail('ORIGINAL_LOGIN_VOLUME_REQUIRED');
    const volume=JSON.parse(docker(['volume','inspect',v.Name]))[0];if(volume.Mountpoint!==v.Source)fail('LOGIN_VOLUME_SOURCE_CHANGED');
    const du=spawnSync('du',['-sb','--',v.Source],{encoding:'utf8',timeout:60000}),bytes=Number(du.stdout?.split(/\s/)[0]),space=fs.statfsSync(ROOT);if(du.status!==0||!Number.isSafeInteger(bytes)||bytes<1||space.bavail*space.bsize<bytes*3+1073741824)fail('BACKUP_SPACE_OR_SIZE_REQUIRED');
    for(const n of ['gamehub-production-agent-paper-research-worker-1','mooyu-desktop-business-test-business-paper-worker-1']){const c=inspect(n);if(c.State.Running||c.HostConfig.RestartPolicy.Name!=='no')fail('PAPERS_MUST_REMAIN_CLOSED');}
    if(before.State.Running){const code="const fs=require('fs');let conflict=false;for(const p of ['/app/napcat/config/.env','/data/napcat/config/.env'])if(fs.existsSync(p)){if(fs.statSync(p).size>65536)throw Error('CONFIG_SIZE_LIMIT');for(let line of fs.readFileSync(p,'utf8').split(/\\r?\\n/)){line=line.trim();if(!line||line.startsWith('#'))continue;const key=line.split('=')[0].trim();if(['NAPCAT_DISABLE_MULTI_PROCESS','NAPCAT_DISABLE_MULTIPROCESSING','NAPCAT_WORKER_PROCESS'].includes(key))conflict=true;}}console.log(JSON.stringify({conflict}));";if(JSON.parse(docker(['exec',NAME,'node','-e',code])).conflict)fail('DOTENV_PROCESS_MODE_REVIEW_REQUIRED');}
    if(before.State.Running&&docker(['exec',NAME,'node','-e','console.log(require("os").hostname());'])!==before.Config.Hostname)fail('EFFECTIVE_HOSTNAME_REVIEW_REQUIRED');
    role={container:NAME,image:IMAGE,compose:core.composeArgs(before)};if(role.compose.project!=='mooyu-qq'||role.compose.service!=='napcat')fail('EXACT_GATEWAY_SCOPE_REQUIRED');
    reader=new core.Cutover(ROOT);reader.processEnv={...process.env};reader.state={databases:{}};
    for(const [which,n,key,db]of [['api','gamehub-production-api-1','DATABASE_URL','gamehub-production-postgres-1'],['qq','mooyu-qq-worker-1','QQ_DATABASE_URL','mooyu-qq-postgres-1']]){const c=inspect(n),url=new URL(env(c)[key]);reader.state.databases[which]={container:db,user:decodeURIComponent(url.username),database:decodeURIComponent(url.pathname.slice(1))};if(which==='api')for(const [k,val]of Object.entries(env(c)))reader.processEnv['MOOYU_CUTOVER_API_'+k]=val;}
    model=reader.model(role).services.napcat;reader.captureRole(structuredClone(role),null);verifyModel(before,model);
    files=[...new Set(role.compose.files)].map(p=>({path:p,sha256:fileHash(p)}));idle();othersBefore=otherSnapshot();domainBefore=domain();oldLocksBefore=oldLocks();
   },
   record:async()=>{directory=fs.mkdtempSync(ROOT+'/qq-gateway-mode-20261124-');fs.chmodSync(directory,0o700);reader.record=directory;
    fs.writeFileSync(directory+'/state.private.json',JSON.stringify({mode,image:IMAGE,runtime:process.execPath,originalFlag:env(before).NAPCAT_DISABLE_MULTI_PROCESS,targetFlag,role,files,gatewayBefore:before,othersBefore,domainBefore,oldLocksBefore},null,2)+'\n',{flag:'wx',mode:0o600});
    fs.writeFileSync(directory+'/mode.json',JSON.stringify({services:{napcat:{image:IMAGE,hostname:before.Config.Hostname,environment:{NAPCAT_DISABLE_MULTI_PROCESS:targetFlag}}}})+'\n',{flag:'wx',mode:0o600});
    const next=reader.model(role,'mode.json').services.napcat,normalized=structuredClone(next);normalized.environment.NAPCAT_DISABLE_MULTI_PROCESS=model.environment.NAPCAT_DISABLE_MULTI_PROCESS;normalized.image=model.image;if(Object.hasOwn(model,'hostname'))normalized.hostname=model.hostname;else delete normalized.hostname;
    if(hash(normalized)!==hash(model))fail('NON_MODE_COMPOSE_CHANGE');
    const tool=path.join(path.dirname(new URL(import.meta.url).pathname),'repair-napcat-process-mode.mjs');
    const sh=v=>"'"+v.replaceAll("'","'\\''")+"'";
    fs.writeFileSync(directory+'/rollback.sh',"#!/bin/sh\nset -eu\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexport MOOYU_GATEWAY_MODE_AUTH=20261124\nexec "+sh(process.execPath)+' '+sh(tool)+' rollback '+sh(directory)+'\n',{flag:'wx',mode:0o700});console.log('新维护及登录备份目录：'+directory);},
   warmBackup:async()=>{stage('backup-before-stop');backups.push(archiveLoginData(directory,'login-before-stop.tar',{quiesced:!before.State.Running}));},
   recheck:async()=>{guards();const c=inspect(NAME);if(c.Id!==before.Id||c.State.StartedAt!==before.State.StartedAt||hash(gatewayComparable(c,env(before).NAPCAT_DISABLE_MULTI_PROCESS))!==hash(gatewayComparable(before,env(before).NAPCAT_DISABLE_MULTI_PROCESS)))fail('GATEWAY_CHANGED_BEFORE_STOP');},
   stop:async()=>{stage('graceful-stop-only-gateway');if(inspect(NAME).State.Running){stopIssued=true;docker(['stop','--timeout','-1',NAME],{timeout:90000});}if(inspect(NAME).State.Running)fail('GATEWAY_DID_NOT_STOP');},
   coldBackup:async()=>{stage('backup-while-stopped');guards();backups.push(archiveLoginData(directory,'login-stopped.tar',{quiesced:true}));fs.writeFileSync(directory+'/backup-receipt.private.json',JSON.stringify(backups,null,2)+'\n',{flag:'wx',mode:0o600});guards();},
   start:async()=>{stage('recreate-only-gateway-mode');guards();recreateIssued=true;compose('mode.json',['up','-d','--no-deps','--no-build','--pull','never','napcat']);},
   verify:async()=>{stage('verify-mode-and-preservation');const c=inspect(NAME);if(!c.State.Running||c.Image!==IMAGE||c.Config.Hostname!==before.Config.Hostname||env(c).NAPCAT_DISABLE_MULTI_PROCESS!==targetFlag||hash(gatewayComparable(c,env(before).NAPCAT_DISABLE_MULTI_PROCESS))!==hash(gatewayComparable(before,env(before).NAPCAT_DISABLE_MULTI_PROCESS)))fail('GATEWAY_MODE_CONFIGURATION_MISMATCH');
    if(hash(core.composeArgs(c).args)!==hash([...role.compose.args,'-f',directory+'/mode.json']))fail('COMPOSE_CHAIN_CHANGED');reader.captureRole(structuredClone(role),'mode.json');verifyModel(c,reader.model(role,'mode.json').services.napcat);guards();
    const login=JSON.parse(docker(['exec','mooyu-qq-worker-1','node','--input-type=module','-e',nativeProbe],{timeout:160000}));guards();
    const after=inspect(NAME);if(after.Id!==c.Id||after.State.StartedAt!==c.State.StartedAt||after.RestartCount!==c.RestartCount||!after.State.Running)fail('GATEWAY_RESTARTED_DURING_VERIFICATION');
    const count=docker(['top',NAME,'-eo','comm']).split(/\s+/).filter(n=>n==='node').length;if(targetFlag==='0'&&count<2)fail('NATIVE_PARENT_AND_WORKER_NOT_RUNNING');if(targetFlag==='0'&&login.restartCallbackUninitialized)fail('RECOVERY_CALLBACK_STILL_UNINITIALIZED');
    const ready=login.loggedIn&&login.coreReady&&login.coreOnline&&login.expectedAccount;
    const result={result:mode==='rollback'?'GATEWAY_SINGLE_PROCESS_ROLLBACK_VERIFIED':ready?'GATEWAY_MULTIPROCESS_LOGIN_READY':login.phase==='waiting_qrcode'&&login.qrAvailable?'GATEWAY_MULTIPROCESS_SCAN_REQUIRED':'GATEWAY_MULTIPROCESS_LOGIN_PENDING',directory,login,nodeProcessCount:count,imageUnchanged:true,loginVolumePreserved:true,onlyGatewayRecreated:true,otherServicesAndOldRecordsUnchanged:true,permissionsSchedulesAndHistoryPreserved:true,papersStillClosed:true,databaseRestored:false,automaticSecondRecreation:false,realReconnectAcceptancePending:mode==='apply'};
    fs.writeFileSync(directory+'/result.private.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));}
  });
 }catch(e){const result={result:'GATEWAY_MODE_STOPPED_REVIEW_REQUIRED',directory,phase,stopIssued,recreateIssued,code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'OPERATION_FAILED',automaticRetry:false,automaticRollback:false,loginDataMustNotBeCleared:true};if(directory)fs.writeFileSync(directory+'/failure.private.json',JSON.stringify(result)+'\n',{mode:0o600});console.error(JSON.stringify(result));process.exitCode=1;}
 finally{if(locked)fs.rmdirSync('/var/lock/mooyu-agent-plugin-cutover.lock');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)repairGatewayMode(process.argv[2],process.argv[3]);
