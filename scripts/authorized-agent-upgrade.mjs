// Fixed-scope, explicitly authorized 2026-11-23 deployment. Imported by tests;
// the handoff builder embeds this in a shell holding the shared release flock.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const ROOT='/www/backup/gamehub',STAGE=ROOT+'/agent-plugins-stage-20261122-r3',TOOLS=ROOT+'/agent-locked-tools-20261123-r1';
const SOURCE=ROOT+'/agent-cutover-files-post-paper-20261123-r2';
const TOOL_SHA='1dcbf5e2e9202867fec8f76de9f3f63b43585c87b27f1bcbd784cf8c352606b6';
const fail=m=>{throw Error(m);},read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function hashFile(file){const fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),b=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
const env=c=>Object.fromEntries((c.Config.Env??[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
function run(args,opts={}){const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,...opts});if(r.error||r.status!==0)fail('DEPLOY_DOCKER_OPERATION_FAILED');return r.stdout?.trim()??'';}
function all(){const ids=run(['ps','-aq']).split(/\s+/).filter(Boolean);if(!ids.length)fail('CONTAINERS_REQUIRED');return JSON.parse(run(['inspect',...ids]));}
export function assertScheduleWindow(plans,now=Date.now()){
 if(!Array.isArray(plans)||!plans.length)fail('EXISTING_SCHEDULE_REQUIRED');
 for(const p of plans.filter(p=>p.enabled)){const next=Date.parse(p.next_fire_at);if(!Number.isFinite(next)||next-now<45*60000)fail('SCHEDULE_WINDOW_TOO_CLOSE_OR_OVERDUE');}
}
export async function performAuthorizedDeployment(a){
 await a.preflight();await a.prepare();await a.verifyPrepared();await a.upgrade();await a.verifyFinal();
}
export async function deployAuthorized(){
 let operation=null,record=null,phase='preflight',secondaryLock=false;
 const sourceRoots=[ROOT+'/agent-cutover-files-20261122-r1',ROOT+'/agent-cutover-files-post-paper-20261122-r1',SOURCE];
 function sourceSnapshot(root){if(read(root+'/state.private.json').executionLocked!==true)fail('ORIGINAL_EXECUTION_LOCK_REQUIRED');const manifest=read(root+'/generation-files.sha256.json');for(const f of manifest.files){if(!/^[A-Za-z0-9_.-]+$/.test(f.name)||hashFile(root+'/'+f.name)!==f.sha256)fail('LOCKED_SOURCE_MANIFEST_CHANGED');}return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(f=>{if(!f.isFile()||f.isSymbolicLink())fail('LOCKED_SOURCE_LAYOUT_CHANGED');return[f.name,hashFile(root+'/'+f.name),fs.statSync(root+'/'+f.name).mode&0o777];});}
 const originals=sourceRoots.map(sourceSnapshot);
 const verifyOriginals=()=>{for(let i=0;i<sourceRoots.length;i++)if(!same(sourceSnapshot(sourceRoots[i]),originals[i]))fail('ORIGINAL_LOCKED_RECORD_CHANGED');};
 let tool,core,spec,manifest,protectedBefore,participantBefore=[],usageBefore;
 const mutable=new Set(['gamehub-production-api-1','gamehub-production-web-1','mooyu-qq-worker-1','gamehub-production-agent-blog-public-scheduler-1','gamehub-production-agent-paper-research-worker-1']);
 const snapshot=c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt,running:c.State.Running,restarts:c.RestartCount,config:c.Config,host:c.HostConfig,mounts:(c.Mounts??[]).slice().sort((a,b)=>a.Destination.localeCompare(b.Destination)),networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()});
 function protectedSnapshot(cs){return cs.filter(c=>!mutable.has(c.Name.replace(/^\//,''))&&!(tool?.state.executor&&c.Name==='/'+tool.state.executor.container)).map(snapshot).sort((a,b)=>a.id.localeCompare(b.id));}
 function papersAndDesktop(cs){const by=new Map(cs.map(c=>[c.Name.replace(/^\//,''),c]));for(const name of ['gamehub-production-agent-paper-research-worker-1','mooyu-desktop-business-test-business-paper-worker-1']){const c=by.get(name);if(!c||c.State.Running||c.State.ExitCode!==0||c.HostConfig.RestartPolicy.Name!=='no'||!core.PAPER_KEYS.every(k=>env(c)[k]==='false')||!same(c.Config.Entrypoint,['node','-e','process.exit(0)'])||!same(c.Config.Cmd??[],[]))fail('PAPER_MUST_REMAIN_CLOSED');}const desktop=by.get('mooyu-desktop-business-test-business-api-1');if(!desktop?.State.Running||env(desktop).DESKTOP_BUSINESS_TEST_PAPER_ENABLED!=='false'||env(by.get('mooyu-desktop-business-test-business-paper-worker-1')).DESKTOP_BUSINESS_TEST_PAPER_ENABLED!=='false')fail('DESKTOP_PAPER_ADMISSION_MUST_STAY_CLOSED');}
 function desktopHealth(){const code="fetch('http://127.0.0.1:3090/ready-desktop-business',{signal:AbortSignal.timeout(8000)}).then(async r=>{const b=await r.json();if(r.status!==200||b.data?.paperStudy?.enabled!==false)process.exitCode=1;else console.log('READY_PAPER_OFF')}).catch(()=>process.exitCode=1)";if(run(['exec','mooyu-desktop-business-test-business-api-1','node','-e',code])!=='READY_PAPER_OFF')fail('DESKTOP_NOT_READY');}
 function protectedCheck(){verifyOriginals();if(!same(protectedSnapshot(all()),protectedBefore))fail('PROTECTED_CONTAINER_CHANGED');}
 const usageSQL="SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT agent_user_id,status,count(*)::text AS count,sum(charged_provider_calls)::text AS calls,sum(charged_output_tokens)::text AS output_tokens,sum(charged_cost_microusd)::text AS cost_microusd FROM agent_budget_reservations GROUP BY agent_user_id,status ORDER BY agent_user_id,status) x";
 const participantSQL="SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY agent_user_id,channel,actor_ref),'[]'::jsonb) FROM agent_channel_participants t";
 function advance(name){phase=name;console.log('部署阶段：'+name);if(operation)fs.writeFileSync(path.join(operation,'progress.private.json'),JSON.stringify({phase,record,at:new Date().toISOString(),authorization:'explicit-user-20261123',sourceRecordsModified:false})+'\n',{mode:0o600});}
 try{
  if(process.env.MOOYU_AUTHORIZED_RELEASE_LOCK!=='20261123')fail('SHARED_RELEASE_LOCK_ENTRY_REQUIRED');
  fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});secondaryLock=true;
  await performAuthorizedDeployment({
   preflight:async()=>{
    if(hashFile(TOOLS+'/agent-server-cutover.mjs')!==TOOL_SHA||hashFile(SOURCE+'/agent-server-cutover.mjs')!==TOOL_SHA)fail('AUDITED_TOOL_HASH_MISMATCH');
    core=await import(pathToFileURL(TOOLS+'/agent-server-cutover.mjs').href);
    const source=read(SOURCE+'/state.private.json');for(const f of source.files)if(hashFile(f.path)!==f.sha256)fail('FROZEN_SOURCE_FILE_CHANGED');
    if(source.roles.length!==5||!source.roles.every(r=>mutable.has(r.container))||new Set(source.roles.map(r=>r.container)).size!==5)fail('AUTHORIZED_ROLE_SET_MISMATCH');
    const cs=all(),by=new Map(cs.map(c=>[c.Name.replace(/^\//,''),c]));for(const r of source.roles){const c=by.get(r.container);if(!c||core.fingerprint(c)!==r.expectedFingerprint||c.State.Running!==r.expectedRunning)fail('AUDITED_ROLE_CHANGED');}
    papersAndDesktop(cs);desktopHealth();protectedBefore=protectedSnapshot(cs);
    const reader=new core.Cutover(SOURCE);reader.state=source;reader.processEnv={...process.env,...source.composeEnvironment};
    reader.checkConfiguration();reader.checkWindow({allowPaper:true});
    const plans=reader.jsonSQL(source.databases.api,"SELECT COALESCE(json_agg(json_build_object('enabled',enabled,'next_fire_at',next_fire_at)),'[]'::json) FROM agent_schedules");assertScheduleWindow(plans);
    usageBefore=reader.jsonSQL(source.databases.api,usageSQL);
    if(reader.exists(source.databases.api,'agent_channel_participants'))participantBefore=reader.jsonSQL(source.databases.api,participantSQL);
    const policies=reader.jsonSQL(source.databases.qq,"SELECT COALESCE(json_agg(policy),'[]'::json) FROM mooyu_qq.control_settings");core.legacyQQParticipantStatements(source.agentId,policies);
    if(source.agentId!=='c98abda1-d115-4e05-9c2e-43f68119386a'||policies[0].enabled!==true||!same(policies[0].allowedUsers.slice().sort(),['495469022','52399347'].sort()))fail('REVIEWED_QQ_ALLOWLIST_CHANGED');
    manifest=read(STAGE+'/release-manifest.json');if(hashFile(STAGE+'/release-manifest.json')!=='a2b57ba1146be3995ce7979456b9177b9775433957d0c27b1333b66752e3ac17')fail('RELEASE_MANIFEST_CHANGED');
    spec={agentId:source.agentId,adoptLegacyQQParticipants:true,allExecutionServicesInventoried:true,composeEnvironment:source.composeEnvironment,apiURL:'http://api:3090',gateway:source.gateway.container,loginVolume:source.gateway.loginVolume,databases:{api:source.databases.api.container,qq:source.databases.qq.container},roles:source.roles.map(r=>({role:r.role,container:r.container,...(r.role==='scheduler'?{schema166Compatible:true,schema166CompatibilityEvidence:r.schema166CompatibilityEvidence}:{})}))};
   },
   prepare:async()=>{
    operation=fs.mkdtempSync(ROOT+'/agent-authorized-upgrade-20261123-');fs.chmodSync(operation,0o700);record=path.join(operation,'record');console.log('本次正式操作记录：'+record);advance('prepare-new-operational-record');
    fs.writeFileSync(path.join(operation,'authorization.private.json'),JSON.stringify({scope:'20261123-explicit-plugin-upgrade',roles:[...mutable],sourceRecords:sourceRoots,sourceExecutionLocksPreserved:true,source:SOURCE,permissionAdoption:'existing-two-QQ-allowlist-actors-only',paperMustRemainClosed:true,loginGatewayDatabaseDesktopRestartForbidden:true})+'\n',{flag:'wx',mode:0o600});
    tool=new core.Cutover(record);await tool.prepare(spec,manifest);
   },
   verifyPrepared:async()=>{advance('verify-new-record-before-service-change');protectedCheck();tool.checkWindow({allowPaper:true});if(tool.state.executionLocked===true)fail('NEW_OPERATIONAL_RECORD_NOT_PREPARED');},
   upgrade:async()=>{
    advance('backup-stop-recheck-quiesced-backup-migrate-switch');
    // Use the audited implementation. The outer shell owns the shared flock;
    // this wrapper owns the same second lock used by the tool's main().
    tool.upgrade();
   },
   verifyFinal:async()=>{
    advance('post-upgrade-verification');protectedCheck();const cs=all();papersAndDesktop(cs);desktopHealth();tool.checkWindow({requireBackup:true});
    const catalog=tool.jsonSQL(tool.state.databases.api,'SELECT json_agg(json_build_array(version,checksum_sha256) ORDER BY version) FROM schema_migrations');if(!same(catalog,tool.state.migrationCatalog)||catalog.length!==166)fail('FINAL_SCHEMA_CHECK_FAILED');
    const after=tool.jsonSQL(tool.state.databases.api,participantSQL);for(const prior of participantBefore){const row=after.find(p=>p.agent_user_id===prior.agent_user_id&&p.channel===prior.channel&&p.actor_ref===prior.actor_ref);if(!same(row,prior))fail('EXISTING_QQ_PARTICIPANT_CHANGED');}
    const allowed=['495469022','52399347'];for(const actor of allowed)if(!after.some(p=>p.agent_user_id===spec.agentId&&p.channel==='qq'&&p.actor_ref===actor))fail('LEGACY_QQ_PARTICIPANT_MISSING');
    for(const row of after)if(!participantBefore.some(p=>p.agent_user_id===row.agent_user_id&&p.channel===row.channel&&p.actor_ref===row.actor_ref)&&!(row.agent_user_id===spec.agentId&&row.channel==='qq'&&allowed.includes(row.actor_ref)&&row.can_invoke===true&&row.status==='active'))fail('UNREVIEWED_PARTICIPANT_ADDED');
    if(!same(tool.jsonSQL(tool.state.databases.api,usageSQL),usageBefore))fail('BUDGET_USAGE_CHANGED_DURING_DEPLOYMENT');
    const api=tool.state.roles.find(r=>r.role==='api'),code="fetch('http://127.0.0.1:3090/health',{signal:AbortSignal.timeout(8000)}).then(r=>{if(r.status!==200)process.exitCode=1;else console.log('API_HEALTHY')}).catch(()=>process.exitCode=1)";if(run(['exec',api.container,'node','-e',code])!=='API_HEALTHY')fail('FINAL_API_HEALTH_FAILED');
    const result={result:'AUTHORIZED_PLUGIN_UPGRADE_VERIFIED',record,schema:166,quiescedBackups:tool.state.backups.map(({role,path,bytes,sha256,quiesced})=>({role,path,bytes,sha256,quiesced})),originalLockedRecordsUnchanged:true,loginGatewayDatabasesDesktopUnchanged:true,bothPapersClosed:true,permissionsAndSchedulesPreserved:true,qqBothLegacyActorsRetained:true,budgetUsagePreserved:true,realQQAcceptanceStillRequired:true,databaseRestored:false};
    fs.writeFileSync(path.join(operation,'result.private.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));advance('complete');
   }
  });
 }catch(e){let current=null;try{if(record&&fs.existsSync(record+'/state.private.json'))current=read(record+'/state.private.json').phase;}catch{}
  const error={result:'UPGRADE_STOPPED_REVIEW_REQUIRED',phase,toolPhase:current,record,code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'DEPLOY_FAILED',automaticRetry:false,automaticDatabaseRestore:false,originalLocksMustRemain:true};if(operation)fs.writeFileSync(path.join(operation,'failure.private.json'),JSON.stringify(error,null,2)+'\n',{mode:0o600});console.error(JSON.stringify(error));process.exitCode=1;
 }finally{if(secondaryLock)fs.rmdirSync('/var/lock/mooyu-agent-plugin-cutover.lock');}
}
