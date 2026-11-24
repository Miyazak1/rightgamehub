// Explicit continuation from the recorded recreate-only-api failure. Leaves
// that record and release package immutable. Does not recreate the healthy API.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';
import{verifyDeclaredRuntime}from'./github-search-runtime-verification.mjs';
const ROOT='/www/backup/gamehub',STAGE=ROOT+'/github-search-release-20261123-r1',NODE=ROOT+'/agent-plugins-stage-20261122-r3/node';
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const fail=k=>{throw Error(k);},env=c=>Object.fromEntries(c.Config.Env.map(s=>{const n=s.indexOf('=');return[s.slice(0,n),s.slice(n+1)];}));
const sha=file=>{const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),b=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');};
export async function resumeSearchUpdate(){
 let phase='preflight',directory=null,locked=false;
 function docker(args,options={}){const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:12000000,...options});if(r.status!==0)fail('DOCKER_'+args[0].toUpperCase()+'_FAILED');return r.stdout?.trim()??'';}
 const inspect=n=>JSON.parse(docker(['inspect',n]))[0];
 try{
  if(process.env.MOOYU_GITHUB_SEARCH_AUTH!=='20261123')fail('EXPLICIT_CONTINUATION_ENTRY_REQUIRED');
  fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});locked=true;
  const core=await import(pathToFileURL(STAGE+'/agent-server-cutover.mjs')),prior=await import(pathToFileURL(STAGE+'/update-github-search-online.mjs'));
  const apiName=prior.UPDATE_NAMES[0],executorName=prior.UPDATE_NAMES[1],api=inspect(apiName),chain=core.composeArgs(api),last=chain.files.findLast(p=>p.startsWith(ROOT+'/github-search-operation-')&&p.endsWith('/api.json'));
  if(!last)fail('ORIGINAL_OPERATION_REQUIRED');const record=path.dirname(last),state=read(record+'/state.private.json'),failure=read(record+'/failure.private.json'),manifest=read(STAGE+'/manifest.json');
  if(failure.phase!=='recreate-only-api'||failure.code!=='RECREATED_CONFIGURATION_MISMATCH'||state.targetImage!==manifest.image)fail('EXPECTED_FAILURE_RECORD_REQUIRED');
  for(const f of manifest.files)if(!/^[A-Za-z0-9_.-]+$/u.test(f.name)||sha(STAGE+'/'+f.name)!==f.sha256)fail('ORIGINAL_RELEASE_FILE_CHANGED');
  const frozen=fs.readdirSync(record).filter(n=>fs.statSync(record+'/'+n).isFile()).map(n=>({name:n,sha256:sha(record+'/'+n)}));
  const frozenHash=()=>hash(frozen.map(f=>[f.name,sha(record+'/'+f.name)]));const oldRecordHash=frozenHash();
  const values=env(api),processEnv={...process.env};for(const [k,v]of Object.entries(values))processEnv['MOOYU_CUTOVER_API_'+k]=v;
  const web=inspect('gamehub-production-web-1');for(const [key,dest]of [['AGENT_DOWNLOADS_DIR','/srv/agent-downloads'],['DESKTOP_DOWNLOADS_DIR','/srv/desktop-downloads']]){const m=web.Mounts.find(m=>m.Destination===dest);if(m?.Type==='bind')processEnv[key]=m.Source;}
  const reader=new core.Cutover(record);reader.state=state;reader.processEnv=processEnv;const q=(which,sql)=>reader.sql(state.databases[which],sql);
  const domain=()=>({domain:reader.invariants(),participants:q('api',prior.ONLINE_SQL.participants),usage:q('api',prior.ONLINE_SQL.usage)});
  const history=()=>Object.fromEntries(['agent_runs','agent_run_stages','agent_interactions','agent_interaction_events','agent_runtime_outbox','blog_articles','blog_article_revisions'].map(t=>[t,q('api',`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM ${t} t`)]).concat([['qqMessages',q('qq',"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY channel_id,message_id)::text,'')) FROM mooyu_qq.messages t")]]));
  const all=()=>{const ids=docker(['ps','-aq']).split(/\s+/).filter(Boolean);return JSON.parse(docker(['inspect',...ids]));};
  const protectedNow=()=>all().filter(c=>!prior.UPDATE_NAMES.includes(c.Name.slice(1))).map(c=>({id:c.Id,name:c.Name,image:c.Image,running:c.State.Running,started:c.State.StartedAt,restarts:c.RestartCount,fingerprint:core.fingerprint(c)})).sort((a,b)=>a.id.localeCompare(b.id));
  function idle(){const schedules=JSON.parse(q('api',"SELECT COALESCE(json_agg(json_build_object('nextFire',next_fire_at,'protocol',config_json#>>'{worker,interactionProtocolVersion}')),'[]'::json) FROM agent_schedules"));if(schedules.length!==1||schedules[0].protocol!=='1')fail('SCHEDULER_PROTOCOL_CHANGED');prior.ensureUpdateWindow({...Object.fromEntries(['interactions','runs','stages','blockingEvents'].map(k=>[k,Number(q('api',prior.ONLINE_SQL[k]))])),nextFire:schedules[0].nextFire});}
  function guards(){
   if(hash(protectedNow())!==hash(state.protectedBefore)||frozenHash()!==oldRecordHash)fail('PROTECTED_SERVICES_OR_OPERATION_CHANGED');
   for(const f of state.files)if(sha(f.path)!==f.sha256)fail('ORIGINAL_CONFIGURATION_CHANGED');
   for(const set of state.locksBefore)for(const [p,digest,mode]of set)if(sha(p)!==digest||(fs.statSync(p).mode&0o777)!==mode)fail('ORIGINAL_LOCKED_RECORD_CHANGED');
   if(hash(domain())!==hash(state.domainBefore)||hash(history())!==hash(state.historyBefore))fail('PRESERVED_DOMAIN_OR_HISTORY_CHANGED');
   if(Number(q('api','SELECT count(*) FROM schema_migrations'))!==166)fail('SCHEMA_CHANGED');idle();
  }
  const verification=[];
  function verifyRole(role,overlay,selected){
   const c=inspect(role.container),before=reader.model(role).services[role.compose.service],model=reader.model(role,overlay),after=model.services[role.compose.service],image=JSON.parse(docker(['image','inspect',selected]))[0];
   const changed=Object.keys({...before,...after}).filter(k=>k!=='image'&&hash(before[k]??null)!==hash(after[k]??null));if(changed.length)fail('NON_IMAGE_COMPOSE_CHANGE');
   const baseline=JSON.parse(docker(['image','inspect',role.image]))[0];if(hash(image.Config)!==hash(baseline.Config))fail('IMAGE_RUNTIME_CONFIG_CHANGED');
   if(c.Image!==selected||core.fingerprint({...c,Image:role.image})!==role.fingerprint)fail('KEY_RUNTIME_FINGERPRINT_CHANGED');
   if(hash(core.composeArgs(c).args)!==hash([...role.compose.args,'-f',record+'/'+overlay]))fail('ORDERED_COMPOSE_CHAIN_CHANGED');
   reader.captureRole(structuredClone(role),overlay);const checks=verifyDeclaredRuntime(c,after,image);verification.push({role:role.compose.service,checks,keyRuntimeFingerprintMatches:true,orderedComposeChainMatches:true,verifiedRuntimeHash:hash(prior.comparableUpdate(c))});return c;
  }
  guards();const apiRole=state.roles.find(r=>r.container===apiName),execRole=state.roles.find(r=>r.container===executorName),executor=inspect(executorName);
  if(!api.State.Running||api.State.Health?.Status!=='healthy'||executor.State.Running||executor.Image!==execRole.image||core.fingerprint(executor)!==execRole.fingerprint)fail('EXPECTED_PARTIAL_SERVICE_STATE_REQUIRED');
  verifyRole(apiRole,'api.json',state.targetImage);
  const backups=read(record+'/backups.private.json');if(backups.length!==2)fail('VERIFIED_BACKUPS_REQUIRED');for(const b of backups){const file=record+'/'+b.database+'.dump';if(sha(file)!==b.sha256||fs.statSync(file).size!==b.bytes||!b.fullDecodeVerified)fail('ORIGINAL_BACKUP_CHANGED');}
  directory=fs.mkdtempSync(ROOT+'/github-search-resume-20261123-');fs.chmodSync(directory,0o700);
  const save=()=>fs.writeFileSync(directory+'/phase.private.json',JSON.stringify({phase,record,apiRestarted:false,at:new Date().toISOString()})+'\n',{mode:0o600});
  fs.writeFileSync(directory+'/review.private.json',JSON.stringify({record,oldRecordHash,verification,scope:'bootstrap-and-start-executor-only',originalBackupsVerified:true},null,2)+'\n',{flag:'wx',mode:0o600});
  phase='register-additive-search-contract-and-workflow';save();console.log('续接阶段：'+phase);docker(['exec',apiName,'node','apps/api/src/agent-interaction-bootstrap-cli.mjs']);if(Number(q('api',prior.ONLINE_SQL.registered))!==1)fail('SEARCH_WORKFLOW_NOT_REGISTERED');guards();
  phase='start-only-interaction-executor';save();console.log('续接阶段：'+phase);reader.compose(execRole,'agent-interactions.json',['up','-d','--no-deps','--no-build','--pull','never','agent-interactions']);
  await new Promise(r=>setTimeout(r,4000));const current=verifyRole(execRole,'agent-interactions.json',state.targetImage);if(!current.State.Running)fail('EXECUTOR_NOT_RUNNING');
  verifyRole(apiRole,'api.json',state.targetImage);guards();
  const result={result:'GITHUB_SEARCH_UPDATE_RESUMED_VERIFIED',directory,record,apiHealthy:true,apiRestartedAgain:false,executorUpdated:true,declaredRuntimeChecksVerified:true,originalReleaseAndOperationUnchanged:true,permissionsBudgetPlansLoginAndHistoryPreserved:true,otherServicesUnchanged:true,papersStillClosed:true,databaseMigrated:false,databaseRestored:false,tasksRetried:false,realQQAcceptanceRequired:true};
  phase='complete';save();fs.writeFileSync(directory+'/runtime-verification.private.json',JSON.stringify(verification,null,2)+'\n',{flag:'wx',mode:0o600});fs.writeFileSync(directory+'/result.private.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
 }catch(e){const result={result:'GITHUB_SEARCH_RESUME_STOPPED_REVIEW_REQUIRED',directory,phase,code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'OPERATION_FAILED',automaticRetry:false};if(directory)fs.writeFileSync(directory+'/failure.private.json',JSON.stringify(result)+'\n',{mode:0o600});console.error(JSON.stringify(result));process.exitCode=1;}
 finally{if(locked)fs.rmdirSync('/var/lock/mooyu-agent-plugin-cutover.lock');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)resumeSearchUpdate();
