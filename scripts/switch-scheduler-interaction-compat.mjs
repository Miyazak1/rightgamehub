// Authorized scheduler-only maintenance. No SQL writes, task retries, login or DB restart.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const ROOT='/www/backup/gamehub',SERVICE='gamehub-production-agent-blog-public-scheduler-1',STAGE=ROOT+'/agent-scheduler-compat-20261123-r1';
const OLD='sha256:ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843',TARGET='sha256:99f6306de9c83f444eb5a07b2fa78562171d49394c2a98b5dc9743f879f0872f';
const TAG='mooyu-agent-scheduler:20261123-interaction-compat-r1',AGENT='c98abda1-d115-4e05-9c2e-43f68119386a';
const fail=m=>{throw Error(m);},read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const SCHEDULER_PLANS_SQL="SELECT COALESCE(json_agg(rows),'[]'::json) FROM (SELECT enabled,next_fire_at,timezone,schedule_spec_json FROM agent_schedules WHERE agent_user_id='"+AGENT+"' AND workflow_key='blog.project.discovery-shadow') rows";
export const SCHEDULER_HEARTBEAT_SQL="SELECT COALESCE(json_agg(json_build_object('worker',config_json->'worker')),'[]'::json) FROM agent_schedules WHERE agent_user_id='"+AGENT+"' AND workflow_key='blog.project.discovery-shadow'";
export function parseSchedulerRows(text){let rows;try{rows=JSON.parse(text);}catch{fail('SCHEDULER_QUERY_JSON_INVALID');}if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))fail('SCHEDULER_QUERY_ROWS_REQUIRED');return rows;}
export function verifiedSchedulerHeartbeat(row,previous,mode,now=Date.now()){const age=now-Date.parse(row?.heartbeatAt);return !!(row?.instanceId&&row.instanceId!==previous?.instanceId&&Number.isFinite(age)&&age>=-30000&&age<120000&&['idle','waiting'].includes(row.state)&&(mode==='switch'?row.interactionProtocolVersion===1:mode==='rollback'&&row.interactionProtocolVersion==null));}
function sha(file){const fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),b=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function docker(args,options={}){const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,...options});if(r.error||r.status!==0)fail('SCHEDULER_OPERATION_FAILED');return r.stdout?.trim()??'';}
const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
function all(){const ids=docker(['ps','-aq']).split(/\s+/).filter(Boolean);if(!ids.length)fail('CONTAINERS_REQUIRED');return JSON.parse(docker(['inspect',...ids]));}
export function schedulerUpCommand(compose,overlay){
 if(compose.service!=='agent-blog-public-scheduler'||compose.project!=='gamehub-production'||!overlay.startsWith(ROOT+'/agent-scheduler-compat-operation-'))fail('SCHEDULER_SCOPE_REQUIRED');
 // The scheduler has no HTTP healthcheck. Its fresh protocol heartbeat below
 // is the readiness check; Compose --wait is incompatible with some disabled
 // image-level healthchecks and is unnecessary here.
 return[...compose.args,'-f',overlay,'up','-d','--no-deps','--no-build','--pull','never',compose.service];
}
export function comparableScheduler(c){const cfg={...c.Config};delete cfg.Image;delete cfg.Hostname;cfg.Env=(cfg.Env??[]).slice().sort();cfg.Labels=Object.fromEntries(Object.entries(cfg.Labels??{}).filter(([k])=>!k.startsWith('com.docker.compose.')));return{config:cfg,host:c.HostConfig,mounts:c.Mounts.slice().sort((a,b)=>a.Destination.localeCompare(b.Destination)),networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()};}
export async function schedulerSwitchSequence(a){await a.check();await a.record();await a.stop();await a.recheck();await a.up();await a.verify();}
export async function switchScheduler(mode='switch',existingOperation=null){
 let directory=null,phase='preflight',lock=false,core,reader,before,role,processEnvironment,sourceRecords,protectedBefore,domainBefore,historyBefore,outboxBefore,sourceBefore,beforeWorker;
 const selected=mode==='switch'?TARGET:mode==='rollback'?OLD:null;if(!selected)fail('SWITCH_OR_ROLLBACK_REQUIRED');
 const opaque=c=>({id:c.Id,name:c.Name,image:c.Image,running:c.State.Running,startedAt:c.State.StartedAt,restarts:c.RestartCount,configHash:hash([c.Config,c.HostConfig,c.Mounts.slice().sort((a,b)=>a.Destination.localeCompare(b.Destination)),Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()])});
 const others=cs=>cs.filter(c=>c.Name!=='/'+SERVICE).map(opaque).sort((a,b)=>a.id.localeCompare(b.id));
 function oldFiles(){return sourceRecords.map(root=>fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(d=>{if(!d.isFile()||d.isSymbolicLink())fail('OLD_RECORD_LAYOUT_CHANGED');return[d.name,sha(root+'/'+d.name),fs.statSync(root+'/'+d.name).mode&0o777];}));}
 function checkOthers(){if(!same(others(all()),protectedBefore)||!same(oldFiles(),sourceBefore))fail('PROTECTED_SERVICES_OR_RECORDS_CHANGED');}
 const q=(which,sql)=>reader.sql(reader.state.databases[which],sql),json=(which,sql)=>parseSchedulerRows(q(which,sql));
 function history(){const result={};for(const t of ['agent_runs','agent_blog_runs','agent_schedule_fires','agent_interactions','blog_articles'])result[t]=q('api','SELECT count(*) FROM '+t);result.qqMessages=q('qq','SELECT count(*) FROM mooyu_qq.messages');result.usage=q('api',"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM agent_budget_reservations t");result.participants=q('api',"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY agent_user_id,channel,actor_ref)::text,'')) FROM agent_channel_participants t");return result;}
 const outbox=()=>q('api',"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM agent_runtime_outbox t");
 function idle(){
  // This maintenance never consumes outbox. Retain every event byte-for-byte;
  // gate on actual runs/stages/deliveries instead of orphan wakeup counts.
  for(const [db,table,where,optional]of core.WINDOW_QUERIES){if(table==='agent_runtime_outbox')continue;if(!reader.exists(reader.state.databases[db],table)){if(optional)continue;fail('REQUIRED_LEDGER_MISSING');}const n=Number(q(db,`SELECT count(*) FROM ${table} t WHERE ${where}`));if(!Number.isSafeInteger(n)||n<0)fail('INVALID_TASK_COUNT');if(n)fail('SCHEDULER_WINDOW_BUSY');}
  if(Number(q('api',"SELECT count(*) FROM agent_run_stages WHERE status IN ('blocked','queued','leased','running','waiting','uncertain')"))!==0)fail('NONTERMINAL_STAGE_EXISTS');
  const plans=json('api',SCHEDULER_PLANS_SQL);if(plans.length!==1||plans[0].enabled!==true||plans[0].timezone!=='Asia/Shanghai'||plans[0].schedule_spec_json?.kind!=='daily-local-time'||plans[0].schedule_spec_json?.localTime!=='10:00'||!Number.isFinite(Date.parse(plans[0].next_fire_at))||Date.parse(plans[0].next_fire_at)-Date.now()<45*60000)fail('DAILY_SCHEDULE_WINDOW_TOO_CLOSE_OR_CHANGED');
 }
 function papers(){for(const name of ['gamehub-production-agent-paper-research-worker-1','mooyu-desktop-business-test-business-paper-worker-1']){const c=inspect(name),env=Object.fromEntries(c.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));if(c.State.Running||c.State.ExitCode!==0||c.HostConfig.RestartPolicy.Name!=='no'||!core.PAPER_KEYS.every(k=>env[k]==='false')||!same(c.Config.Entrypoint,['node','-e','process.exit(0)'])||name.includes('desktop')&&env.DESKTOP_BUSINESS_TEST_PAPER_ENABLED!=='false')fail('PAPER_MUST_STAY_CLOSED');}const api=inspect('mooyu-desktop-business-test-business-api-1');if(!api.State.Running||!api.Config.Env.includes('DESKTOP_BUSINESS_TEST_PAPER_ENABLED=false'))fail('DESKTOP_PAPER_ADMISSION_MUST_STAY_CLOSED');}
 function fileChecks(plan){for(const f of plan.files)if(sha(f.path)!==f.sha256)fail('ORIGINAL_COMPOSE_FILE_CHANGED');}
 function phaseTo(s){phase=s;console.log('调度兼容切换阶段：'+s);if(directory)fs.writeFileSync(directory+'/progress.private.json',JSON.stringify({phase,mode,at:new Date().toISOString()})+'\n',{mode:0o600});}
 try{
  if(process.env.MOOYU_SCHEDULER_COMPAT_AUTH!=='20261123')fail('AUTHORIZED_LOCK_ENTRY_REQUIRED');fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});lock=true;
  const coreFile=ROOT+'/agent-locked-tools-20261123-r1/agent-server-cutover.mjs';if(sha(coreFile)!=='1dcbf5e2e9202867fec8f76de9f3f63b43585c87b27f1bcbd784cf8c352606b6')fail('AUDITED_READER_CHANGED');core=await import(pathToFileURL(coreFile).href);
  sourceRecords=[ROOT+'/agent-cutover-files-20261122-r1',ROOT+'/agent-cutover-files-post-paper-20261122-r1',ROOT+'/agent-cutover-files-post-paper-20261123-r2'];for(const root of sourceRecords)if(read(root+'/state.private.json').executionLocked!==true)fail('OLD_EXECUTION_LOCK_CHANGED');
  const deployed=fs.readdirSync(ROOT).filter(n=>/^agent-authorized-upgrade-20261123-[A-Za-z0-9]+$/.test(n)&&fs.existsSync(ROOT+'/'+n+'/result.private.json')).map(n=>ROOT+'/'+n).filter(p=>read(p+'/result.private.json').result==='AUTHORIZED_PLUGIN_UPGRADE_VERIFIED');if(deployed.length!==1)fail('DEPLOYMENT_RECORD_AMBIGUOUS');
  reader=new core.Cutover(deployed[0]+'/record');reader.load();if(reader.state.agentId!==AGENT||reader.state.phase!=='upgraded')fail('EXISTING_AGENT_DEPLOYMENT_REQUIRED');processEnvironment={...process.env,...reader.state.composeEnvironment};
  await schedulerSwitchSequence({
   check:async()=>{
    phaseTo('preflight-idle');idle();phaseTo('preflight-paper-and-schema');papers();if(q('api','SELECT count(*) FROM schema_migrations')!=='166')fail('SCHEMA166_REQUIRED');phaseTo('preflight-scheduler');before=inspect(SERVICE);if(mode==='switch'&&(!before.State.Running||before.Image!==OLD))fail('EXPECTED_ORIGINAL_SCHEDULER_REQUIRED');
    role=core.composeArgs(before);if(role.service!=='agent-blog-public-scheduler'||role.project!=='gamehub-production')fail('SCHEDULER_SCOPE_REQUIRED');
    if(mode==='rollback'){
     if(!existingOperation?.startsWith(ROOT+'/agent-scheduler-compat-operation-')||!same(fs.realpathSync(existingOperation),existingOperation))fail('EXPLICIT_OPERATION_REQUIRED');directory=existingOperation;const plan=read(directory+'/plan.private.json');fileChecks(plan);if(plan.target!==TARGET||plan.original!==OLD||![OLD,TARGET].includes(before.Image)||hash(comparableScheduler(before))!==plan.comparableHash)fail('ROLLBACK_CONFIGURATION_DRIFT');role=plan.compose;
    }else{
     const proof=read(STAGE+'/acceptance.json'),build=read(STAGE+'/build-proof.json');if(proof.result!=='PASSED'||proof.scope!=='original-image-interaction-compat'||proof.imageId!==TARGET||!proof.realInteractionProtocolAdmissionVerified||!proof.interactiveCheckpointsExcluded||!proof.schedulerRestartPreservedPlans||proof.providerCalls!==0||build.baseImageId!==OLD||build.imageId!==TARGET||build.unchangedModules!==68)fail('COMPAT_ACCEPTANCE_REQUIRED');
     const base=JSON.parse(docker(['image','inspect',OLD]))[0],candidate=JSON.parse(docker(['image','inspect',TARGET]))[0];if(!same(base.Config,candidate.Config)||!same(candidate.RootFS.Layers.slice(0,base.RootFS.Layers.length),base.RootFS.Layers))fail('CANDIDATE_RUNTIME_CHANGED');
    }
    phaseTo('preflight-preservation-snapshots');protectedBefore=others(all());domainBefore=reader.invariants();historyBefore=history();outboxBefore=outbox();sourceBefore=oldFiles();beforeWorker=json('api',SCHEDULER_HEARTBEAT_SQL)[0]?.worker;
   },
   record:async()=>{
    if(mode==='switch'){
     directory=fs.mkdtempSync(ROOT+'/agent-scheduler-compat-operation-20261123-');fs.chmodSync(directory,0o700);const plan={original:OLD,target:TARGET,compose:role,comparable:comparableScheduler(before),files:role.files.map(p=>({path:p,sha256:sha(p)})),sourceRecordStateSha256:sha(deployed[0]+'/record/state.private.json'),deploymentRecord:deployed[0]+'/record'};
     // Do not store Config.Env or credentials. Comparability is hashed on disk;
     // reconstruct the baseline from the fixed original model during rollback.
     plan.comparableHash=hash(plan.comparable);delete plan.comparable;
     fs.writeFileSync(directory+'/plan.private.json',JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
     fs.copyFileSync(new URL(import.meta.url),directory+'/switch-scheduler-interaction-compat.mjs',fs.constants.COPYFILE_EXCL);
     fs.writeFileSync(directory+'/candidate.json',JSON.stringify({services:{[role.service]:{image:TARGET}}})+'\n',{flag:'wx',mode:0o600});fs.writeFileSync(directory+'/rollback.json',JSON.stringify({services:{[role.service]:{image:OLD}}})+'\n',{flag:'wx',mode:0o600});
     fs.writeFileSync(directory+'/rollback.sh',"#!/usr/bin/env bash\nset -euo pipefail\numask 077\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexport MOOYU_SCHEDULER_COMPAT_AUTH=20261123\nexec /www/backup/gamehub/agent-plugins-stage-20261122-r3/node '"+directory+"/switch-scheduler-interaction-compat.mjs' rollback '"+directory+"'\n",{flag:'wx',mode:0o700});
    }
    console.log('本次兼容维护目录：'+directory);phaseTo('prepared');
   },
   stop:async()=>{checkOthers();idle();phaseTo('stop-only-scheduler');docker(['stop','--timeout','-1',SERVICE],{timeout:90000});if(inspect(SERVICE).State.Running)fail('SCHEDULER_DID_NOT_STOP');},
   recheck:async()=>{checkOthers();idle();fileChecks(read(directory+'/plan.private.json'));if(!same(reader.invariants(),domainBefore)||!same(history(),historyBefore)||outbox()!==outboxBefore)fail('BUSINESS_STATE_CHANGED');},
   up:async()=>{phaseTo(mode==='switch'?'start-compatible-scheduler':'restore-original-scheduler');const overlay=directory+(mode==='switch'?'/candidate.json':'/rollback.json');docker(schedulerUpCommand(role,overlay),{cwd:role.directory,env:processEnvironment});},
   verify:async()=>{
    phaseTo('verify-protocol-and-preservation');const after=inspect(SERVICE),plan=read(directory+'/plan.private.json');if(!after.State.Running||after.Image!==selected||hash(comparableScheduler(after))!==plan.comparableHash||!same(core.composeArgs(after).args,[...role.args,'-f',directory+(mode==='switch'?'/candidate.json':'/rollback.json')]))fail('SCHEDULER_RECREATION_MISMATCH');
    let heartbeat=null;for(let i=0;i<12;i++){const row=json('api',SCHEDULER_HEARTBEAT_SQL)[0]?.worker;if(verifiedSchedulerHeartbeat(row,beforeWorker,mode)){heartbeat={state:row.state,protocol:row.interactionProtocolVersion??null,heartbeatAt:row.heartbeatAt};break;}await new Promise(r=>setTimeout(r,3000));}
    if(!heartbeat||!inspect(SERVICE).State.Running)fail('NEW_SCHEDULER_PROTOCOL_HEARTBEAT_NOT_VERIFIED');checkOthers();papers();fileChecks(plan);if(!same(reader.invariants(),domainBefore)||!same(history(),historyBefore)||outbox()!==outboxBefore||sha(plan.deploymentRecord+'/state.private.json')!==plan.sourceRecordStateSha256)fail('PRESERVED_HISTORY_OR_POLICY_CHANGED');
    const result={result:mode==='switch'?'SCHEDULER_COMPAT_SWITCH_VERIFIED':'SCHEDULER_ORIGINAL_ROLLBACK_VERIFIED',directory,image:after.Image,heartbeat,onlySchedulerRecreated:true,otherServicesNotRestarted:true,permissionsPlansLoginAndHistoryPreserved:true,outboxUnchanged:true,bothPapersClosed:true,oldRecordsAndLocksUnchanged:true,failedTaskRetried:false,realGitHubAcceptanceRequired:mode==='switch'};
    fs.writeFileSync(directory+'/'+(mode==='switch'?'result.private.json':'rollback-result.private.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
   }
  });
 }catch(e){const result={result:'SCHEDULER_SWITCH_STOPPED_REVIEW_REQUIRED',mode,directory,phase,code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:e instanceof SyntaxError?'JS_SYNTAX_ERROR':e instanceof TypeError?'JS_TYPE_ERROR':'OPERATION_FAILED',automaticRetry:false,automaticRollback:false};if(directory)fs.writeFileSync(directory+'/failure.private.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.error(JSON.stringify(result));process.exitCode=1;
 }finally{if(lock)fs.rmdirSync('/var/lock/mooyu-agent-plugin-cutover.lock');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)switchScheduler(process.argv[2],process.argv[3]).catch(()=>{console.error('SCHEDULER_ENTRY_REFUSED');process.exitCode=1;});
