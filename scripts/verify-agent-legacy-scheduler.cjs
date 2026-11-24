// Local-only, synthetic schema166 compatibility probe. Never uses an existing DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const out=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_ISOLATED_BUILD_DIRECTORY_REQUIRED');
const root=path.resolve(__dirname,'..'),task='scheduler166-'+crypto.randomBytes(6).toString('hex'),network=task+'-net',db=task+'-pg';
const api='sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe';
const label='mooyu.preflight.task='+task;
const docker=(args)=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:8000000,windowsHide:true});if(r.status!==0)throw Error('LOCAL_DOCKER_OPERATION_FAILED: '+(r.stderr||'').slice(0,1500));return r.stdout.trim();};
fs.mkdirSync(out,{recursive:true});
const sourceRoot=path.join(out,'legacy-src');fs.mkdirSync(sourceRoot);
const todo=['apps/api/src/agent-blog-public-schedule-worker-cli.mjs'],seen=new Set(),sources=[];
while(todo.length){const file=todo.pop();if(seen.has(file))continue;seen.add(file);if(!file.startsWith('apps/api/src/'))throw Error('UNEXPECTED_LEGACY_SOURCE_PATH');const source=execFileSync('git',['show','3b79276f6aa9435a:'+file],{cwd:root,encoding:'utf8',windowsHide:true}).replace(/\r\n?/g,'\n');const target=path.join(sourceRoot,file.slice('apps/api/src/'.length));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);sources.push([file,crypto.createHash('sha256').update(source).digest('hex')]);for(const m of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g))todo.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));}
sources.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
const graph=crypto.createHash('sha256').update(JSON.stringify(sources)).digest('hex');
if(sources.length!==70||graph!=='72cb11e1d230bfa0627ae36d2accfdc5a3d92b460e41e694544d024c63b93ec8')throw Error('VERIFIED_LEGACY_GRAPH_CHANGED');
fs.copyFileSync(path.join(root,'apps/api/src/migrations.mjs'),path.join(out,'migrations.mjs'));
fs.writeFileSync(path.join(out,'probe.mjs'),String.raw`
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {applyMigrations,migrationStatus} from './migrations.mjs';
import {PostgresAgentBlogPublicScheduleRepository} from '/app/apps/api/src/agent-blog-public-schedule.mjs';
const {Pool}=createRequire('/app/apps/api/package.json')('pg');
const pool=new Pool({connectionString:process.env.LOCAL_SYNTHETIC_DB,max:1});
try {
 const applied=await applyMigrations(pool,'/app/apps/api/migrations');
 assert.equal(applied.total,166);
 const operator=crypto.randomUUID();
 await pool.query("INSERT INTO users(id,display_name,role)VALUES($1,'Local synthetic operator','admin')",[operator]);
 const manifest={schemaVersion:'agent-workflow-v1',workflowKey:'blog.project.discovery-shadow',workflowVersion:4,stages:[{}]};
 await pool.query("INSERT INTO agent_workflow_definitions(workflow_key,workflow_version,schema_version,manifest_json,manifest_sha256,runtime_min_version,status,created_by_user_id) VALUES('blog.project.discovery-shadow',4,'agent-workflow-v1',$1,$2,'1','active',$3)",[manifest,'a'.repeat(64),operator]);
 const repo=new PostgresAgentBlogPublicScheduleRepository(pool);
 const ids=[];
 for(const enabled of [true,false]) {
  const agent=crypto.randomUUID();ids.push(agent);
  await pool.query('BEGIN');
  await pool.query("INSERT INTO users(id,display_name,account_type)VALUES($1,'Local synthetic Agent','agent')",[agent]);
  await pool.query("INSERT INTO agent_accounts(user_id,provision_key,provision_digest,operator_user_id,badge_label,operator_label)VALUES($1,$2,$3,$4,'AI 助手','Local test')",[agent,'local-'+agent,'b'.repeat(64),operator]);
  await pool.query('COMMIT');
  await pool.query("UPDATE agent_blog_publication_owners SET active_publisher='foundation',generation=generation+1,reason='isolated compatibility test',updated_by_user_id=$2,switched_at=clock_timestamp(),updated_at=clock_timestamp() WHERE agent_user_id=$1",[agent,operator]);
  const schedule=await repo.ensureDaily({agentUserId:agent,enabled});
  if(enabled)await pool.query("UPDATE agent_schedules SET next_fire_at='2037-01-01T02:00:00Z' WHERE id=$1",[schedule.id]);
 }
 const snapshot=async()=> (await pool.query("SELECT id,agent_user_id,workflow_key,workflow_version,timezone,schedule_spec_json,enabled,next_fire_at,last_fire_at,misfire_policy,config_json,updated_by_user_id FROM agent_schedules ORDER BY id")).rows;
 const before=await snapshot();
 for(const agent of ids){await repo.ensureDaily({agentUserId:agent,enabled:true,preserveExisting:true});assert.equal(await repo.claimDue({agentUserId:agent}),null);}
 assert.deepEqual(await snapshot(),before);
 const ready=await migrationStatus(pool,'/app/apps/api/migrations');assert.equal(ready.ready,true);
 const fires=Number((await pool.query('SELECT count(*) FROM agent_schedule_fires')).rows[0].count);assert.equal(fires,0);
 console.log(JSON.stringify({result:'PASSED',schema:166,legacySourceModules:70,enabledSchedulePreserved:true,pausedSchedulePreserved:true,nextFirePreserved:true,unexpectedFires:fires,providerCalls:0,credentials:'synthetic-only',productionChanged:false,originalLocalContainersTouched:false,limitation:'legacy verified source with target-image dependencies; original scheduler image not present locally'}));
} finally {await pool.end();}
`);
let netCreated=false,dbCreated=false;
(async()=>{
 try{
  docker(['network','create','--internal','--label',label,network]);netCreated=true;
  docker(['run','-d','--pull','never','--name',db,'--label',label,'--network',network,'--network-alias','pg','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=synthetic-local-only','-e','POSTGRES_DB=scheduler166','postgres:16.10-alpine']);dbCreated=true;
  let ready=false;for(let i=0;i<40;i++){const r=spawnSync('docker',['exec',db,'pg_isready','-U','postgres','-d','scheduler166'],{windowsHide:true,timeout:5000,stdio:'ignore'});if(r.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}if(!ready)throw Error('LOCAL_POSTGRES_NOT_READY');
  const output=docker(['run','--rm','--pull','never','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--label',label,'--network',network,'--mount','type=bind,source='+sourceRoot+',target=/app/apps/api/src,readonly','--mount','type=bind,source='+out+',target=/probe,readonly','-e','LOCAL_SYNTHETIC_DB=postgres://postgres:synthetic-local-only@pg:5432/scheduler166','--entrypoint','node',api,'/probe/probe.mjs']);
  const result=JSON.parse(output.split(/\r?\n/).at(-1));result.verifiedLegacyGraphSha256=graph;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{
  if(dbCreated){const inspected=JSON.parse(docker(['inspect',db]))[0];if(inspected.Config.Labels?.['mooyu.preflight.task']!==task)throw Error('REFUSE_UNOWNED_CONTAINER_CLEANUP');docker(['rm','-f',db]);}
  if(netCreated){const inspected=JSON.parse(docker(['network','inspect',network]))[0];if(inspected.Labels?.['mooyu.preflight.task']!==task)throw Error('REFUSE_UNOWNED_NETWORK_CLEANUP');docker(['network','rm',network]);}
 }
})().catch(e=>{fs.writeFileSync(path.join(out,'failure.txt'),e.message+'\n');console.error(e.message);process.exitCode=1;});
