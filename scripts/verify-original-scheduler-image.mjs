// Tests an immutable scheduler image on a NEW synthetic PG166 database.
// No app source mounts, production configuration, real credentials, or WAN access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {GRAPH_PROBE,verifyCompatGraph} from './scheduler-interaction-compat.mjs';

export const ORIGINAL_IMAGE='sha256:ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843';
const TARGET_IMAGE='sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe';
const GRAPH='72cb11e1d230bfa0627ae36d2accfdc5a3d92b460e41e694544d024c63b93ec8';
const args=process.argv.slice(2),out=path.resolve(args[0]??'');
if(!args[0]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_ISOLATED_BUILD_DIRECTORY_REQUIRED');
const interactionCompat=args[1]==='--interaction-compat-image';
const image=args[1]==='--development-image'||interactionCompat?args[2]:ORIGINAL_IMAGE;
if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw Error('IMMUTABLE_IMAGE_REQUIRED');
const eligible=image===ORIGINAL_IMAGE;
const invoke=(argv,options={})=>spawnSync('docker',argv,{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8000000,...options});
const docker=(argv,options={})=>{const r=invoke(argv,options);if(r.status!==0){if(!eligible)fs.writeFileSync(path.join(out,'failure.synthetic.log'),r.stderr??'',{mode:0o600});const code=/code:\s*['"]([A-Z0-9_]+)['"]/.exec(r.stderr??'')?.[1]??'UNKNOWN';throw Error('LOCAL_DOCKER_OPERATION_FAILED_'+code);}return (argv[0]==='logs'?(r.stdout??'')+'\n'+(r.stderr??''):r.stdout??'').trim();};
const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
fs.mkdirSync(out,{recursive:true,mode:0o700});
const available=invoke(['image','inspect',image]);
if(available.status!==0){const result={result:'BLOCKED',reason:'ORIGINAL_IMAGE_NOT_AVAILABLE',requiredImage:ORIGINAL_IMAGE,requestedImage:image,productionChanged:false};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(2);}
const meta=JSON.parse(available.stdout)[0];assert.equal(meta.Id,image);
assert.equal(meta.Os,'linux');assert.equal(meta.Architecture,'amd64');
if((meta.Config.Env??[]).some(v=>/^[^=]*(?:SECRET|TOKEN|PASSWORD|DATABASE_URL|SMTP_)[^=]*=.+/i.test(v)))throw Error('BAKED_DEPLOYMENT_CREDENTIAL_REVIEW_REQUIRED');
const graphCode=String.raw`
const fs=require('fs'),p=require('path').posix,c=require('crypto'),todo=['apps/api/src/agent-blog-public-schedule-worker-cli.mjs'],seen=new Set(),rows=[];
while(todo.length){const f=todo.pop();if(seen.has(f))continue;seen.add(f);if(!f.startsWith('apps/api/src/'))throw Error('UNEXPECTED_SOURCE_PATH');const s=fs.readFileSync('/app/'+f,'utf8').replace(/\r\n?/g,'\n');rows.push([f,c.createHash('sha256').update(s).digest('hex')]);for(const m of s.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g))todo.push(p.normalize(p.join(p.dirname(f),m[1])));}
rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);console.log(JSON.stringify({modules:rows.length,hash:c.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),node:process.version}));
`;
const graph=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--entrypoint','node',image,'-e',graphCode]));
assert.equal(graph.modules,70);let compatGraph=null;
if(interactionCompat){
 const base=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--entrypoint','node',ORIGINAL_IMAGE,'-e',GRAPH_PROBE])),actual=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--entrypoint','node',image,'-e',GRAPH_PROBE]));compatGraph=verifyCompatGraph(base,actual);
 const originalMeta=JSON.parse(docker(['image','inspect',ORIGINAL_IMAGE]))[0];assert.deepEqual(meta.Config,originalMeta.Config);assert.deepEqual(meta.RootFS.Layers.slice(0,originalMeta.RootFS.Layers.length),originalMeta.RootFS.Layers);
}else assert.equal(graph.hash,GRAPH);
const task='original-scheduler-'+crypto.randomBytes(6).toString('hex'),network=task+'-net',db=task+'-pg',label='mooyu.original-image-test='+task;
const url='postgres://postgres:synthetic-local-only@pg:5432/scheduler166',master='cd'.repeat(32);
let networkCreated=false,dbCreated=false;const clients=[];
const write=(name,text)=>fs.writeFileSync(path.join(out,name),text,{mode:0o600});
fs.copyFileSync(new URL('./agent-server-cutover.mjs',import.meta.url),path.join(out,'agent-server-cutover.mjs'));
const fixture=String.raw`
import fs from 'node:fs';import crypto from 'node:crypto';import{createRequire}from'node:module';
import{applyMigrations}from'/app/apps/api/src/migrations.mjs';
import{createAgentAccountService}from'/app/apps/api/src/agent-account-service.mjs';
import{PostgresAgentAccountRepository}from'/app/apps/api/src/agent-account-repository.mjs';
import{PostgresAgentRuntimeRepository}from'/app/apps/api/src/agent-runtime-repository.mjs';
import{PostgresAgentToolGatewayRepository}from'/app/apps/api/src/agent-tool-gateway-repository.mjs';
import{PostgresAgentProviderGatewayRepository}from'/app/apps/api/src/agent-provider-gateway-repository.mjs';
import{createAgentSecretVault}from'/app/apps/api/src/agent-secret-vault.mjs';
import{PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository}from'/app/apps/api/src/agent-blog-private-canary-bootstrap.mjs';
import{createAgentBlogPublicRuntimeBootstrap}from'/app/apps/api/src/agent-blog-public-runtime-bootstrap.mjs';
import{PostgresAgentBlogPublicScheduleRepository}from'/app/apps/api/src/agent-blog-public-schedule.mjs';
const {Pool}=createRequire('/app/apps/api/package.json')('pg'),pool=new Pool({connectionString:process.env.LOCAL_SYNTHETIC_DB,max:1});
try{
 const m=await applyMigrations(pool,'/app/apps/api/migrations');if(m.total!==166)throw Error('SCHEMA166_REQUIRED');
 const operator=crypto.randomUUID();await pool.query("INSERT INTO users(id,display_name,role)VALUES($1,'Synthetic image acceptance operator','admin')",[operator]);
 const service=createAgentAccountService({repository:new PostgresAgentAccountRepository(pool),authorizeOperator:async()=>true});const agents=[];
 for(const enabled of [true,false]){
  const account=await service.provision({userId:operator},{provisionKey:'image-test-'+crypto.randomUUID(),displayName:'Synthetic image acceptance',handle:'image-test-'+crypto.randomBytes(5).toString('hex'),badgeLabel:'AI 助手',operatorLabel:'Local synthetic image acceptance',capabilities:['blog:auto-publish'],metadata:{}});const id=account.agentUserId;
  await pool.query("UPDATE agent_blog_publication_owners SET active_publisher='foundation',generation=generation+1,reason='Local synthetic image acceptance',switched_at=GREATEST(clock_timestamp(),switched_at+interval '1 microsecond'),updated_at=clock_timestamp() WHERE agent_user_id=$1",[id]);
  for(const key of ['blog.article.draft','provider.text.generate','research.github.discover','research.github.read'])await pool.query("INSERT INTO agent_capability_grants(id,agent_user_id,capability_key,contract_version,risk_ceiling,granted_by_user_id,reason) SELECT $1,$2,$3,1,'L2',$4,'Local synthetic image acceptance' WHERE NOT EXISTS(SELECT 1 FROM agent_capability_grants WHERE agent_user_id=$2 AND capability_key=$3 AND contract_version=1 AND status='active' AND valid_until IS NULL)",[crypto.randomUUID(),id,key,operator]);
  const config={schemaVersion:'agent-blog-public-runtime-config-v1',enabled:true,agentUserId:id,provider:'deepseek',modelId:'deepseek-flash'};
  await createAgentBlogPublicRuntimeBootstrap({config,identityRepository:new PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository(pool),runtimeRepository:new PostgresAgentRuntimeRepository(pool),toolRepository:new PostgresAgentToolGatewayRepository(pool),providerRepository:new PostgresAgentProviderGatewayRepository(pool)}).run();
  const enc=createAgentSecretVault({masterKey:process.env.SYNTHETIC_MASTER}).encrypt(id,'deepseek','synthetic-unused-provider-key');
  await pool.query("INSERT INTO agent_provider_secrets(agent_user_id,provider,ciphertext,nonce,auth_tag,key_fingerprint,key_last_four,updated_by_user_id)VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)",[id,enc.ciphertext,enc.nonce,enc.authTag,enc.fingerprint,enc.lastFour,operator]);
  const schedule=await new PostgresAgentBlogPublicScheduleRepository(pool).ensureDaily({agentUserId:id,enabled});if(enabled)await pool.query("UPDATE agent_schedules SET next_fire_at='2037-01-01T02:00:00Z' WHERE id=$1",[schedule.id]);agents.push({id,enabled});
 }
 await pool.query("CREATE TABLE original_image_sentinel(id int PRIMARY KEY,note text)");await pool.query("INSERT INTO original_image_sentinel VALUES(1,'Synthetic history must remain')");console.log(JSON.stringify({agents}));
}finally{await pool.end();}
`;
write('setup.mjs',fixture);
write('repository-probe.mjs',String.raw`
import assert from'node:assert/strict';import{createRequire}from'node:module';import{PostgresAgentBlogPublicScheduleRepository}from'/app/apps/api/src/agent-blog-public-schedule.mjs';
const{Pool}=createRequire('/app/apps/api/package.json')('pg'),pool=new Pool({connectionString:process.env.LOCAL_SYNTHETIC_DB,max:1});const agents=JSON.parse(process.env.SYNTHETIC_AGENTS),repo=new PostgresAgentBlogPublicScheduleRepository(pool);
try{const plans=async()=>(await pool.query("SELECT id,agent_user_id,workflow_key,workflow_version,timezone,schedule_spec_json,enabled,next_fire_at,last_fire_at,config_json FROM agent_schedules ORDER BY id")).rows;const before=await plans();for(const a of agents){await repo.ensureDaily({agentUserId:a.id,enabled:true,preserveExisting:true});assert.equal(await repo.claimDue({agentUserId:a.id}),null);}assert.deepEqual(await plans(),before);const active=agents.find(a=>a.enabled).id;await pool.query("UPDATE agent_schedules SET next_fire_at=now()-interval '1 minute' WHERE agent_user_id=$1",[active]);const fire=await repo.claimDue({agentUserId:active});assert(fire);assert.equal(await repo.claimDue({agentUserId:active}),null);await repo.renew(fire.id,fire.attemptId);await repo.finish(fire.id,fire.attemptId,{status:'succeeded',result:{publicationState:'skipped',localSyntheticAcceptance:true}});await pool.query("UPDATE agent_schedules SET next_fire_at='2037-01-01T02:00:00Z' WHERE agent_user_id=$1",[active]);console.log(JSON.stringify({repositoryCycle:true}));}finally{await pool.end();}
`);
write('snapshot.mjs',String.raw`
import{createRequire}from'node:module';import{SCHEDULE_INVARIANT_SQL}from'./agent-server-cutover.mjs';const{Pool}=createRequire('/app/apps/api/package.json')('pg'),pool=new Pool({connectionString:process.env.LOCAL_SYNTHETIC_DB,max:1,options:'-c default_transaction_read_only=on'});try{const result={};for(const table of ['agent_accounts','agent_capability_grants','agent_policy_profiles','agent_policy_profile_assignments','original_image_sentinel'])result[table]=(await pool.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text) AS hash FROM "+table+" t")).rows[0].hash;result.plans=Object.values((await pool.query(SCHEDULE_INVARIANT_SQL)).rows[0])[0];for(const table of ['agent_provider_calls','agent_budget_reservations','agent_runs','agent_schedule_fires','blog_articles'])result[table]=Number((await pool.query('SELECT count(*) FROM '+table)).rows[0].count);console.log(JSON.stringify(result));}finally{await pool.end();}
`);
write('heartbeat.mjs',String.raw`
import{createRequire}from'node:module';const{Pool}=createRequire('/app/apps/api/package.json')('pg'),pool=new Pool({connectionString:process.env.LOCAL_SYNTHETIC_DB,max:1,options:'-c default_transaction_read_only=on'});try{console.log(JSON.stringify((await pool.query("SELECT agent_user_id,config_json->'worker'->>'instanceId' AS instance FROM agent_schedules ORDER BY agent_user_id")).rows));}finally{await pool.end();}
`);
const probe=(selected,file,extra=[])=>docker(['run','--rm','--pull','never','--read-only','--network',network,'--mount','type=bind,source='+out+',target=/probe,readonly','-e','LOCAL_SYNTHETIC_DB='+url,...extra,'--entrypoint','node',selected,'/probe/'+file]);
if(interactionCompat){
 write('interaction-isolation.mjs',String.raw`
import assert from'node:assert/strict';import crypto from'node:crypto';import{createRequire}from'node:module';import{PostgresAgentBlogPublicRequestRepository}from'/app/apps/api/src/agent-blog-public-request-repository.mjs';import{PostgresAgentBlogPublicScheduleRepository}from'/app/apps/api/src/agent-blog-public-schedule.mjs';
const {Pool}=createRequire('/app/apps/api/package.json')('pg'),pool=new Pool({connectionString:process.env.LOCAL_SYNTHETIC_DB,max:1}),c=await pool.connect(),agent=JSON.parse(process.env.SYNTHETIC_AGENTS)[0].id,isolated=process.env.EXPECT_ISOLATED==='1';
try{await c.query('BEGIN');const repo=new PostgresAgentBlogPublicRequestRepository(c),interactive=crypto.randomUUID(),legacy=crypto.randomUUID();await repo.prepare({agentUserId:agent,requestId:interactive,triggerKind:'manual',triggerRef:'interaction:synthetic',snapshot:{executionSource:'agent-interaction-v1'}});
const first=await repo.pending(agent);if(!isolated){assert.equal(first.request_id,interactive);console.log(JSON.stringify({oldSchedulerWouldClaimInteraction:true}));}else{
assert.equal(first,null);await c.query("UPDATE agent_blog_public_requests SET status='running',lease_token=$3,lease_until=now()-interval '1 minute' WHERE agent_user_id=$1 AND request_id=$2",[agent,interactive,crypto.randomUUID()]);assert.equal(await repo.pending(agent),null);
await repo.prepare({agentUserId:agent,requestId:legacy,triggerKind:'manual',triggerRef:'legacy:synthetic',snapshot:{executionSource:'public-runtime'}});assert.equal((await repo.pending(agent)).request_id,legacy);
await c.query("UPDATE agent_blog_public_requests SET status='completed',result_json='{}' WHERE agent_user_id=$1 AND request_id=$2",[agent,legacy]);assert.equal(await repo.pending(agent),null);console.log(JSON.stringify({interactiveWaitingAndExpiredLeasesExcluded:true,legacyRecoveryPreserved:true}));}
await c.query('ROLLBACK');if(isolated)await new PostgresAgentBlogPublicScheduleRepository(c).heartbeat({agentUserId:agent,instanceId:crypto.randomUUID(),state:'idle'});
}finally{await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end();}
`);
 write('interaction-admission.mjs',String.raw`
import assert from'node:assert/strict';import crypto from'node:crypto';import{createRequire}from'node:module';import{createAgentGitHubInteractionExecutor}from'/app/apps/api/src/agent-interaction-github.mjs';
const {Pool}=createRequire('/app/apps/api/package.json')('pg'),pool=new Pool({connectionString:process.env.LOCAL_SYNTHETIC_DB,max:1}),agentId=JSON.parse(process.env.SYNTHETIC_AGENTS)[0].id,expected=process.env.EXPECT_ADMITTED==='1'?'LOCAL_AFTER_PROTOCOL':'AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED';
try{const execute=createAgentGitHubInteractionExecutor({repository:{pool},service:{agentId,authorize:async()=>({agent:{id:agentId,policy_json:{autoPublish:false}}})},runtime:{config:{modelId:'deepseek-flash'},interactionPorts:{runtimeRepository:{},artifactRepository:{},providerGateway:{},toolGateway:{},draftGateway:{},inputRepository:{snapshot:async()=>{throw Object.assign(Error('LOCAL_AFTER_PROTOCOL'),{code:'LOCAL_AFTER_PROTOCOL'});}}}}});await assert.rejects(execute({id:crypto.randomUUID(),kind:'github-search',input_json:{kind:'github-search',topic:'synthetic local search'},origin_json:{}}),e=>e.code===expected);console.log(JSON.stringify({expectedGate:expected,modelOrNetworkAdapterInvoked:false}));}finally{await pool.end();}
`);
}
try{
 docker(['network','create','--internal','--label',label,network]);networkCreated=true;
 docker(['run','-d','--pull','never','--name',db,'--label',label,'--network',network,'--network-alias','pg','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_DB=scheduler166','-e','POSTGRES_PASSWORD=synthetic-local-only','postgres:16.10-alpine']);dbCreated=true;
 let ready=false;for(let n=0;n<60;n++){const r=invoke(['exec',db,'pg_isready','-U','postgres','-d','scheduler166'],{stdio:'ignore',timeout:5000});if(r.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,200));}assert(ready);
 const {agents}=JSON.parse(probe(TARGET_IMAGE,'setup.mjs',['-e','SYNTHETIC_MASTER='+master]));
 assert.equal(JSON.parse(probe(image,'repository-probe.mjs',['-e','SYNTHETIC_AGENTS='+JSON.stringify(agents)])).repositoryCycle,true);
 const baseline=JSON.parse(probe(TARGET_IMAGE,'snapshot.mjs'));assert.equal(baseline.agent_schedule_fires,1);assert.equal(baseline.agent_provider_calls,0);
 if(interactionCompat){
  const extra=['-e','SYNTHETIC_AGENTS='+JSON.stringify(agents)];
  assert.equal(JSON.parse(probe(ORIGINAL_IMAGE,'interaction-isolation.mjs',extra)).oldSchedulerWouldClaimInteraction,true);
  assert.equal(JSON.parse(probe(TARGET_IMAGE,'interaction-admission.mjs',extra)).expectedGate,'AGENT_INTERACTION_SCHEDULER_UPGRADE_REQUIRED');
  const isolated=JSON.parse(probe(image,'interaction-isolation.mjs',[...extra,'-e','EXPECT_ISOLATED=1']));assert.equal(isolated.interactiveWaitingAndExpiredLeasesExcluded,true);assert.equal(isolated.legacyRecoveryPreserved,true);
  assert.equal(JSON.parse(probe(TARGET_IMAGE,'interaction-admission.mjs',[...extra,'-e','EXPECT_ADMITTED=1'])).expectedGate,'LOCAL_AFTER_PROTOCOL');
  assert.deepEqual(JSON.parse(probe(TARGET_IMAGE,'snapshot.mjs')),baseline);
 }
 const entry=meta.Config.Entrypoint??[];if(!(entry.length===0||entry.length===1&&['node','docker-entrypoint.sh','/usr/local/bin/docker-entrypoint.sh'].includes(entry[0])))throw Error('ORIGINAL_ENTRYPOINT_REVIEW_REQUIRED');
 for(const [index,a]of agents.entries()){
  const name=task+'-scheduler-'+index,values={DATABASE_URL:url,AGENT_SECRET_ENCRYPTION_KEY:master,AGENT_GITHUB_RESEARCH_TOKEN:'synthetic-unused-github-token',AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:a.id,AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED:'true',AGENT_BLOG_PUBLIC_SCHEDULE_POLL_MS:'1000',PAPER_STUDY_ENABLED:'false',PAPER_STUDY_WORKER_ENABLED:'false',PAPER_STUDY_MODELS_ENABLED:'false',PAPER_STUDY_PUBLISH_ENABLED:'false',AGENT_PAPER_SEMANTIC_ENABLED:'false',AGENT_PAPER_RESEARCH_WORKER_ENABLED:'false'};const f='runtime-'+index+'.synthetic.env';write(f,Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n');
  docker(['run','-d','--pull','never','--name',name,'--label',label,'--network',network,'--read-only','--tmpfs','/tmp:rw,size=64m','--env-file',path.join(out,f),image,...(entry[0]==='node'?[]:['node']),'apps/api/src/agent-blog-public-schedule-worker-cli.mjs']);clients.push(name);
 }
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(3500);
 const inspectRuntime=()=>clients.map(name=>{const c=inspect(name);assert(c.State.Running,'scheduler CLI must remain alive');const log=docker(['logs',name]),events=log.split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return{event:'unparsed-output'};}});assert(!events.some(e=>e.event==='loop-error'||e.event==='unparsed-output'));const activation=events.filter(e=>e.event==='activation');assert(activation.some(e=>e.blocked===false),'real CLI must activate against schema166');return{running:true,activated:true};});
 inspectRuntime();assert.deepEqual(JSON.parse(probe(TARGET_IMAGE,'snapshot.mjs')),baseline);const heartbeatBefore=JSON.parse(probe(TARGET_IMAGE,'heartbeat.mjs'));assert(heartbeatBefore.every(r=>r.instance));
 for(const name of clients){assert.equal(inspect(name).Config.Labels['mooyu.original-image-test'],task);docker(['restart','--time','10',name]);}
 await wait(2500);const runtime=inspectRuntime();assert.deepEqual(JSON.parse(probe(TARGET_IMAGE,'snapshot.mjs')),baseline);const heartbeatAfter=JSON.parse(probe(TARGET_IMAGE,'heartbeat.mjs'));assert(heartbeatAfter.every((r,i)=>r.agent_user_id===heartbeatBefore[i].agent_user_id&&r.instance&&r.instance!==heartbeatBefore[i].instance));
 const result={result:'PASSED',scope:interactionCompat?'original-image-interaction-compat':eligible?'original-image':'development-surrogate',imageId:image,requiredOriginalImage:ORIGINAL_IMAGE,productionImageEligible:eligible||interactionCompat,testedSchema:166,sourceGraph:graph,...(interactionCompat?{compatGraph,oldFailureReproduced:true,interactiveCheckpointsExcluded:true,legacyRecoveryPreserved:true,realInteractionProtocolAdmissionVerified:true,fullGitHubResearchStillRequiresRealAcceptance:true}:{}),originalEntrypointPreserved:true,noApplicationSourceMounts:true,repositoryClaimRenewFinishVerified:true,enabledAndPausedSchedulesPreserved:true,realSchedulerCLIActivated:true,schedulerRestartPreservedPlans:true,heartbeatRotatedWithoutPlanDrift:true,permissionsPoliciesAndSyntheticHistoryPreserved:true,providerCalls:0,newAutomaticFires:0,network:'new internal network only',productionChanged:false,originalLocalContainersTouched:false,runtime};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
}finally{
 const owned=docker(['ps','-aq','--filter','label='+label]).split(/\s+/).filter(Boolean);for(const name of owned){const c=inspect(name);if(c.Config.Labels['mooyu.original-image-test']!==task)throw Error('REFUSE_UNOWNED_CLEANUP');docker(['rm','-f',name]);}
 if(networkCreated){const n=JSON.parse(docker(['network','inspect',network]))[0];if(n.Labels['mooyu.original-image-test']!==task)throw Error('REFUSE_UNOWNED_NETWORK');docker(['network','rm',network]);}
}
