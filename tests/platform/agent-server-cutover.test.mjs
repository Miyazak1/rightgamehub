import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Cutover,PAPER_KEYS,WINDOW_QUERIES,composeArgs,fingerprint} from '../../scripts/agent-server-cutover.mjs';

const base='sha256:'+'a'.repeat(64),target='sha256:'+'b'.repeat(64),rescue='sha256:'+'c'.repeat(64),agent='c98abda1-d115-4e05-9c2e-43f68119386a';
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(t,{paused=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cutover-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const record=path.join(dir,'record'),secret=path.join(dir,'shared.secret');fs.writeFileSync(secret,'ab'.repeat(32));
 const models={},containers={},images={},calls=[],counts={},faults={};let schema=163,qqSchema=false,now=Date.now(),drift=false;
 const migrationRoot=path.resolve('apps/api/migrations');
 const files=fs.readdirSync(migrationRoot).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort().map(n=>({path:'apps/api/migrations/'+n,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationRoot,n),'utf8').replace(/\r\n?/g,'\n')).digest('hex')}));
 const catalog=files.map(f=>[f.path.split('/').at(-1).slice(0,4),f.sha256]);
 for(const id of [base,target,rescue])images[id]={Id:id,Config:{Env:[],Cmd:null,Entrypoint:null}};
 const shared={AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:agent,AGENT_SECRET_ENCRYPTION_KEY:'synthetic-master',AGENT_GITHUB_RESEARCH_TOKEN:'synthetic-github'};
 const roles=[];
 for(const role of ['api','web','worker','scheduler','paper']){
  const project=role==='worker'?'qq':'site',service=role==='scheduler'?'agent-blog-public-scheduler':role==='paper'?'agent-paper-research-worker':role;
  const cfg=path.join(dir,role+'.json');fs.writeFileSync(cfg,'{}');
  const environment=role==='api'?{...shared,QQ_ADMIN_ENABLED:'true',QQ_ADMIN_AGENT_USER_ID:agent,QQ_ADMIN_SECRET_FILE:'/run/shared',DATABASE_URL:'postgres://fixture:synthetic@db/site'}:role==='scheduler'?shared:role==='worker'?{QQ_ADMIN_ENABLED:'true',QQ_ADMIN_AGENT_USER_ID:agent,QQ_ADMIN_SECRET_FILE:'/run/shared',QQ_DATABASE_URL:'postgres://fixture:synthetic@db/qq'}:role==='paper'?{AGENT_PAPER_RESEARCH_WORKER_ENABLED:'true'}:{};
  const serviceModel={image:base,environment,command:role==='scheduler'?['node','apps/api/src/agent-blog-public-schedule-worker-cli.mjs']:role==='paper'?['node','apps/api/src/agent-paper-research-worker-cli.mjs']:['node','dummy.mjs'],volumes:['api','worker'].includes(role)?[{type:'bind',source:secret,target:'/run/shared',read_only:true}]:[],networks:{control:{aliases:[service]}},restart:'unless-stopped'};
  models[role]={services:{[service]:serviceModel},networks:{control:{name:'shared-control'}},volumes:{}};
  const c={Name:'/'+role,Image:base,Config:{Image:base,Env:Object.entries(environment).map(([k,v])=>k+'='+v),Cmd:serviceModel.command,Entrypoint:null,Labels:{'com.docker.compose.project':project,'com.docker.compose.service':service,'com.docker.compose.project.working_dir':dir,'com.docker.compose.project.config_files':cfg}},HostConfig:{RestartPolicy:{Name:'unless-stopped'}},State:{Running:!(paused&&role==='scheduler'),StartedAt:'2026-11-22T00:00:00Z',ExitCode:0},Mounts:['api','worker'].includes(role)?[{Type:'bind',Source:secret,Destination:'/run/shared',RW:false}]:[],NetworkSettings:{Networks:{'shared-control':{Aliases:[service]}}}};
  const item={role,container:role,schema166Compatible:role==='scheduler'};
  if(role==='scheduler'){item.schema166CompatibilityEvidence=path.join(dir,'scheduler-image-evidence.json');fs.writeFileSync(item.schema166CompatibilityEvidence,JSON.stringify({result:'PASSED',scope:'original-image',productionImageEligible:true,imageId:base,testedSchema:166,realSchedulerCLIActivated:true,schedulerRestartPreservedPlans:true,noApplicationSourceMounts:true}));}
  containers[role]=c;roles.push(item);
 }
 containers.gateway={...clone(containers.web),Name:'/gateway',Mounts:[{Type:'volume',Name:'existing-login',Source:'/vol/login',Destination:'/data',RW:true}]};
 for(const name of ['site-db','qq-db'])containers[name]={...clone(containers.web),Name:'/'+name};
 const manifest={schemaVersion:'agent-unified-release-v1',paperEnabled:false,images:{api:{id:target,baseImageId:base},worker:{id:target},web:{id:target}},rollbackImages:{api:{id:rescue}},files};
 const spec={agentId:agent,roles,adoptLegacyQQParticipants:true,allExecutionServicesInventoried:true,gateway:'gateway',loginVolume:'existing-login',composeEnvironment:{AGENT_DOWNLOADS_DIR:'/existing/agent',DESKTOP_DOWNLOADS_DIR:'/existing/desktop'},databases:{api:'site-db',qq:'qq-db'}};
 const roleForArgs=args=>{const service=args.at(-1);return roles.find(r=>service===r.role||models[r.role].services[service])??roles.find(r=>args.includes(path.join(dir,r.role+'.json')));};
 const run=(args,options={})=>{
  calls.push(clone(args));
  if(args[0]==='inspect'){assert(containers[args[1]],'unknown container '+args[1]);return JSON.stringify([containers[args[1]]]);}
  if(args[0]==='image')return JSON.stringify([images[args[2]]]);
  if(args[0]==='ps')return Object.entries(containers).filter(([n,c])=>roles.some(r=>r.container===n)&&args.at(-1).endsWith(c.Config.Labels['com.docker.compose.project'])).map(([n])=>n).join('\n');
  if(args[0]==='update'){containers[args.at(-1)].HostConfig.RestartPolicy={Name:'no'};return '';}
  if(args[0]==='exec'){
   if(args.includes('pg_dump')){fs.writeSync(options.stdio[1],Buffer.from('PGDMP-synthetic-'+args.at(-4)));return '';}
   if(args.includes('pg_restore'))return 'archive verified';
   const sql=args.at(-1);
   if(sql.includes("'retainedCompleted'"))return JSON.stringify({total:(counts.agent_runtime_outbox??0)+(faults.retainedOutbox??0),retainedCompleted:faults.retainedOutbox??0});
   if(sql==="SELECT count(*) FROM agent_run_stages WHERE status IN ('blocked','queued','leased','running','waiting','uncertain')")return String(counts.allNonterminalStages??0);
   if(sql.includes('to_regclass')){if(sql.includes('agent_interactions'))return schema===166?'1':'0';if(/mooyu_qq\.agent_(links|image_pages)/.test(sql))return qqSchema?'1':'0';return '1';}
   if(sql.includes('json_agg(json_build_array'))return JSON.stringify(catalog.slice(0,schema));
   if(sql==='SELECT count(*) FROM schema_migrations')return String(schema);
   if(sql.includes('json_agg(policy)'))return JSON.stringify([{enabled:true,allowedUsers:['495469022']}]);
   if(sql.includes('SELECT md5'))return drift?'drifted':'preserved';
   if(sql.startsWith('INSERT INTO agent_channel_participants'))return 'INSERT 0 1';
   const table=WINDOW_QUERIES.find(([,table])=>sql.includes('FROM '+table+' t'))?.[1];
   assert(table,'unexpected SQL '+sql);return String(counts[table]??0);
  }
  if(args[0]==='compose'){
   const role=roleForArgs(args);assert(role,'unknown compose role');let m=clone(models[role.role]);
   for(let i=0;i<args.length;i++)if(args[i]==='-f'&&path.dirname(args[i+1])===record){const overlay=JSON.parse(fs.readFileSync(args[++i],'utf8'));for(const [name,v]of Object.entries(overlay.services??{})){const old=m.services[name]??{};m.services[name]={...old,...v,environment:{...old.environment,...v.environment}};}m.networks={...m.networks,...overlay.networks};}
   for(const service of Object.values(m.services))for(const [key,value]of Object.entries(service.environment??{})){const match=/^\$\{(MOOYU_CUTOVER_API_[A-Z0-9_]+)\?[^}]+\}$/.exec(value);if(match)service.environment[key]=options.env[match[1]];}
   if(args.includes('config'))return JSON.stringify(m);
   if(args.includes('stop')){containers[args.at(-1)==='agent-interactions'?'executor':role.container].State.Running=false;return '';}
   if(args.includes('run')){if(args.includes('apps/api/src/migrate-cli.mjs')){schema=faults.partialMigration?164:166;if(faults.partialMigration)throw Error('INJECTED_PARTIAL_MIGRATION');}return '{}';}
   if(args.includes('ps'))return containers.executor?'executor':'';
   if(args.includes('up')){
    const service=args.at(-1),v=m.services[service];assert(v,'missing '+service);const key=service==='agent-interactions'?'executor':role.container;
    const previous=containers[key]??clone(containers.api);const project=role.role==='worker'?'qq':'site';
    containers[key]={...previous,Name:'/'+key,Image:v.image,Config:{...previous.Config,Env:Object.entries(v.environment??{}).map(([k,v])=>k+'='+v),Cmd:v.command??null,Entrypoint:v.entrypoint??null,Labels:{...previous.Config.Labels,'com.docker.compose.project':project,'com.docker.compose.service':service}},Mounts:(v.volumes??[]).map(p=>({Type:p.type,Source:p.source,Destination:p.target,RW:!p.read_only})),HostConfig:{RestartPolicy:{Name:v.restart??'unless-stopped'}},State:{Running:!v.entrypoint?.includes('process.exit(0)'),StartedAt:'2026-11-22T01:00:00Z',ExitCode:0},NetworkSettings:{Networks:Object.fromEntries(Object.keys(v.networks??{}).map(n=>[m.networks[n].name,{Aliases:v.networks[n]?.aliases??[service]}]))}};
    if(role.role==='worker')qqSchema=true;if(faults.failApiStart&&role.role==='api'&&service==='api'){containers[key].State.Running=false;throw Error('INJECTED_API_START_FAILURE');}return '';
   }
  }
  throw Error('unexpected Docker '+args.join(' '));
 };
 const tool=new Cutover(record,{run,now:()=>now});
 return{tool,spec,manifest,containers,calls,counts,faults,record,dir,advance:ms=>now+=ms,setSchema:n=>schema=n,drift:()=>drift=true};
}

test('first installation, dual backups, persistent paper closure and additive rollback preserve the paused scheduler',async t=>{
 const f=fixture(t,{paused:true});assert.equal((await f.tool.prepare(f.spec,f.manifest)).productionChanged,false);
 assert.equal(f.calls.some(a=>a.includes('pg_dump')||a.includes('stop')||a.includes('up')),false);
 for(const file of fs.readdirSync(f.record).filter(f=>f.endsWith('.sh')))assert.equal(spawnSync('bash',['-n',path.join(f.record,file)]).status,0,file);
 const executor=JSON.parse(fs.readFileSync(path.join(f.record,'executor.private.json'))).services['agent-interactions'];assert.deepEqual(executor.networks.control.aliases,['agent-interactions']);assert(executor.environment.AGENT_SECRET_ENCRYPTION_KEY.startsWith('${MOOYU_CUTOVER_API_'));assert(!JSON.stringify(executor).includes('synthetic-master'));
 assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.record,'target-qq.json')))).includes('synthetic-master'),false);
 assert.equal(f.tool.upgrade().upgraded,true);assert.equal(f.tool.state.schema166,true);assert.equal(f.containers.paper.State.Running,false);assert.equal(f.containers.paper.HostConfig.RestartPolicy.Name,'no');for(const k of PAPER_KEYS)assert(f.containers.paper.Config.Env.includes(k+'=false'));
 assert.equal(f.containers.scheduler.State.Running,false);assert(f.tool.state.backups.every(b=>b.quiesced));assert.equal(f.tool.rollback().rolledBack,true);assert.equal(f.containers.api.Image,rescue);assert.equal(f.containers.executor.State.Running,false);assert.equal(f.containers.paper.State.Running,false);assert.equal(f.containers.scheduler.State.Running,false);
 assert(f.calls.filter(a=>a.includes('pg_restore')).every(a=>a.includes('--list')||a.includes('--file=/dev/null')));
 assert(!f.calls.some(a=>a.includes('down')||a.includes('pg_restore')&&a.includes('-d')));
});

test('every pending ledger blocks before any service mutation',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);
 for(const [,table,,optional]of WINDOW_QUERIES){if(optional)continue;f.counts[table]=1;assert.throws(()=>f.tool.upgrade(),/RELEASE_WINDOW_BUSY/,table);f.counts[table]=0;}
 assert(!f.calls.some(a=>a.includes('stop')||a.includes('update')||a.includes('pg_dump')));
});

test('gateway restart, configuration edits and privilege/schedule drift fail closed',async t=>{
 for(const change of ['gateway','file','business']){const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);if(change==='gateway')f.containers.gateway.State.StartedAt='changed';if(change==='file')fs.appendFileSync(path.join(f.dir,'api.json'),' ');if(change==='business')f.drift();assert.throws(()=>f.tool.upgrade(),/LOGIN_GATEWAY_CHANGED|CONFIGURATION_FILE_CHANGED|PRESERVED_BUSINESS_STATE_CHANGED/);}
});

test('backup expiry, corruption and a live snapshot cannot authorize migrations',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);f.tool.backup();assert.throws(()=>f.tool.verifyBackups(),/QUIESCED_BACKUPS_REQUIRED/);for(const b of f.tool.state.backups)b.quiesced=true;f.advance(1800001);assert.throws(()=>f.tool.verifyBackups(),/BACKUP_STALE_OR_CHANGED/);f.advance(-1800001);fs.appendFileSync(f.tool.state.backups[0].path,'corrupt');assert.throws(()=>f.tool.verifyBackups(),/BACKUP_STALE_OR_CHANGED/);
});

test('pre-migration abort uses the original163 image; a partial schema cannot be rolled backward',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);for(const r of f.tool.state.roles.filter(r=>['api','worker','scheduler'].includes(r.role)))f.tool.stop(r);f.tool.state.phase='stopped';f.tool.paperClose();f.setSchema(164);assert.throws(()=>f.tool.rollback(),/PARTIAL_SCHEMA_REQUIRES_FORWARD_COMPLETION/);f.setSchema(163);assert.equal(f.tool.rollback().rolledBack,true);assert.equal(f.containers.api.Image,base);
});

test('existing QQ actor revocations are never overwritten and secret material is not returned',async t=>{
 const f=fixture(t);const prepared=await f.tool.prepare(f.spec,f.manifest);const result=f.tool.upgrade();assert(!JSON.stringify([prepared,result]).includes('synthetic-master'));const insert=f.calls.find(a=>a.at(-1)?.startsWith('INSERT INTO agent_channel_participants'));assert(insert.at(-1).includes('DO NOTHING'));assert(!insert.at(-1).includes('DO UPDATE'));assert.equal(f.tool.state.roles.find(r=>r.role==='scheduler').expectedRunning,true);
});

test('read-only SQL cannot be used for writes and incomplete review evidence cannot prepare a cutover',async t=>{
 const f=fixture(t);assert.throws(()=>f.tool.sql({user:'fixture',database:'fixture',container:'db'},'DELETE FROM users'),/READONLY_SQL_REQUIRED/);await assert.rejects(f.tool.prepare({...f.spec,adoptLegacyQQParticipants:false},f.manifest),/LEGACY_QQ_CHANNEL_ADOPTION_REVIEW_REQUIRED/);await assert.rejects(f.tool.prepare({...f.spec,roles:f.spec.roles.map(r=>r.role==='scheduler'?{...r,schema166Compatible:false}:r)},f.manifest),/SCHEDULER_IMAGE_COMPATIBILITY_REVIEW_REQUIRED/);
});

test('Compose chain and fingerprint retain order, aliases, restart policy and source mounts',()=>{
 const c={Config:{Env:[],Labels:{'com.docker.compose.project':'site','com.docker.compose.service':'api','com.docker.compose.project.working_dir':'/www/project','com.docker.compose.project.config_files':'/www/base.yml,/www/one.json,/www/two.json','com.docker.compose.project.environment_file':'/www/.env.prod'},Cmd:['node','api'],Entrypoint:null},Image:base,Mounts:[],HostConfig:{RestartPolicy:{Name:'always'}},NetworkSettings:{Networks:{control:{Aliases:['api']}}}};
 assert.deepEqual(composeArgs(c).files,['/www/base.yml','/www/one.json','/www/two.json','/www/.env.prod']);const changed=clone(c);changed.HostConfig.RestartPolicy.Name='no';assert.notEqual(fingerprint(c),fingerprint(changed));
});

test('failed new API startup can roll back without losing the updated schema or restarting paper',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);f.faults.failApiStart=true;assert.throws(()=>f.tool.upgrade(),/INJECTED_API_START_FAILURE/);assert.equal(f.tool.state.phase,'migrated');f.faults.failApiStart=false;assert.equal(f.tool.rollback().rolledBack,true);assert.equal(f.containers.api.Image,rescue);assert.equal(f.containers.paper.State.Running,false);assert.equal(f.tool.upgrade().upgraded,true);
});

test('partial migration only permits forward completion before additive rollback',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);f.faults.partialMigration=true;assert.throws(()=>f.tool.upgrade(),/INJECTED_PARTIAL_MIGRATION/);assert.equal(f.tool.state.phase,'migrating');assert.throws(()=>f.tool.rollback(),/PARTIAL_SCHEMA_REQUIRES_FORWARD_COMPLETION/);f.faults.partialMigration=false;f.tool.completeMigration();assert.equal(f.tool.state.schema166,true);assert.equal(f.tool.rollback().rolledBack,true);
});

test('unsettled child tasks and failed image pages block rollback even after root messages are delivered',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);f.tool.upgrade();for(const table of ['agent_interactions','mooyu_qq.agent_links','mooyu_qq.agent_image_pages']){f.counts[table]=1;assert.throws(()=>f.tool.rollback(),/RELEASE_WINDOW_BUSY/);f.counts[table]=0;}assert.equal(f.tool.rollback().rolledBack,true);
});

test('retained successful notifications survive upgrade and rollback; active stages and unsafe events block both',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);f.faults.retainedOutbox=11;
 for(const key of ['allNonterminalStages','agent_runtime_outbox']){f.counts[key]=1;const from=f.calls.length;assert.throws(()=>f.tool.upgrade(),/RELEASE_WINDOW_BUSY/);assert(!f.calls.slice(from).some(a=>a.includes('stop')||a.includes('pg_dump')));f.counts[key]=0;}
 assert.equal(f.tool.upgrade().upgraded,true);assert.deepEqual(f.tool.checkWindow().outbox,{total:11,retainedCompleted:11,blocking:0,eventsModified:false});
 for(const key of ['allNonterminalStages','agent_runtime_outbox']){f.counts[key]=1;const from=f.calls.length;assert.throws(()=>f.tool.rollback(),/RELEASE_WINDOW_BUSY/);assert(!f.calls.slice(from).some(a=>a.includes('stop')||a.includes('pg_dump')));f.counts[key]=0;}
 assert.equal(f.tool.rollback().rolledBack,true);assert.equal(f.tool.checkWindow().outbox.retainedCompleted,11);
 assert(!f.calls.some(a=>a[0]==='exec'&&/^(UPDATE|DELETE).*agent_runtime_outbox/.test(a.at(-1))));
});

test('an abort before migration can resume the untouched legacy services without another backup',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);for(const r of f.tool.state.roles.filter(r=>['api','worker','scheduler'].includes(r.role)))f.tool.stop(r);f.tool.state.phase='stopped';f.tool.paperClose();const from=f.calls.length;assert.equal(f.tool.abortBeforeMigration().abortedBeforeMigration,true);assert.equal(f.containers.api.Image,base);assert.equal(f.containers.paper.State.Running,false);assert(!f.calls.slice(from).some(a=>a.includes('pg_dump')));
});

test('source-only or development-image evidence cannot authorize the original scheduler image',async t=>{
 for(const change of ['absent','development','wrong-image','source-mounted']){const f=fixture(t);const scheduler=f.spec.roles.find(r=>r.role==='scheduler');if(change==='absent')scheduler.schema166CompatibilityEvidence=null;else{const p=JSON.parse(fs.readFileSync(scheduler.schema166CompatibilityEvidence));if(change==='development'){p.scope='development-surrogate';p.productionImageEligible=false;}if(change==='wrong-image')p.imageId=target;if(change==='source-mounted')p.noApplicationSourceMounts=false;fs.writeFileSync(scheduler.schema166CompatibilityEvidence,JSON.stringify(p));}await assert.rejects(f.tool.prepare(f.spec,f.manifest),/SCHEDULER_IMAGE_ACCEPTANCE_EVIDENCE_REQUIRED|SCHEDULER_ORIGINAL_IMAGE_ACCEPTANCE_REQUIRED/);assert(!f.calls.some(a=>a.includes('up')||a.includes('stop')||a.includes('pg_dump')));}
});

test('accepted original-image proof remains fingerprinted and cannot be replaced after preparation',async t=>{
 const f=fixture(t);await f.tool.prepare(f.spec,f.manifest);fs.appendFileSync(f.spec.roles.find(r=>r.role==='scheduler').schema166CompatibilityEvidence,' ');assert.throws(()=>f.tool.upgrade(),/CONFIGURATION_FILE_CHANGED/);
});

test('generation-only creates real overlays without faking review or allowing execution',async t=>{
 const f=fixture(t);const spec={...f.spec,adoptLegacyQQParticipants:false,allExecutionServicesInventoried:false};
 const result=await f.tool.prepare(spec,f.manifest,{generationOnly:true});
 assert.equal(result.prepared,false);assert.equal(result.executionLocked,true);assert.equal(result.filesGenerated,true);
 assert.equal(f.tool.state.adoptLegacyQQParticipants,false);assert.equal(f.tool.state.executionInventoryReviewed,false);
 assert.ok(fs.existsSync(path.join(f.record,'target-api.json')));assert.ok(fs.existsSync(path.join(f.record,'original-api.json')));assert.ok(fs.existsSync(path.join(f.record,'paper-4.json')));
 assert.throws(()=>new Cutover(f.record,{run:()=>{throw Error('MUST_NOT_RUN_DOCKER');}}).load(),/GENERATION_ONLY_RECORD_EXECUTION_LOCKED/);
 assert.ok(!f.calls.some(a=>['up','stop','update','run','pg_dump'].some(v=>a.includes(v))));
 assert.ok(f.calls.filter(a=>a[0]==='exec').every(a=>a.at(-1).startsWith('SELECT')));
 assert.equal(f.containers.paper.State.Running,true);assert.equal(f.containers.api.Image,base);
});
