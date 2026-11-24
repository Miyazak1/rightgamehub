// Creates only independently labelled, synthetic local Docker resources.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {Cutover,PAPER_KEYS,fingerprint} from './agent-server-cutover.mjs';
const out=path.resolve(process.argv[2]??'');
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_LOCAL_E_BUILD_DIRECTORY_REQUIRED');
fs.mkdirSync(out,{recursive:true});
const task='cutover-local-'+crypto.randomBytes(6).toString('hex'),network=task+'-net',db=task+'-pg',label='mooyu.preflight.task='+task;
const api='sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe';
const run=(args,options={})=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8000000,...options});if(r.status!==0)throw Error('LOCAL_DOCKER_FAILED: '+(r.stderr??'').slice(0,1800));return r.stdout?.trim()??'';};
const inspect=n=>JSON.parse(run(['inspect',n]))[0];
let netCreated=false,dbCreated=false,paperCreated=false;
const baseFile=path.join(out,'base.json'),policyFile=path.join(out,'paper-0.json');
try{
 run(['network','create','--internal','--label',label,network]);netCreated=true;
 run(['run','-d','--pull','never','--name',db,'--label',label,'--network',network,'--network-alias','pg','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=synthetic-local-only','-e','POSTGRES_DB=site','postgres:16.10-alpine']);dbCreated=true;
 let ready=false;for(let i=0;i<50;i++){const r=spawnSync('docker',['exec',db,'pg_isready','-U','postgres','-d','site'],{windowsHide:true,stdio:'ignore',timeout:3000});if(r.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,200));}assert(ready,'new local PG must become ready');
 run(['exec',db,'psql','-X','-U','postgres','-d','site','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE qq']);
 fs.copyFileSync(path.resolve('apps/qq-channel/src/schema.sql'),path.join(out,'qq-schema.sql'));
 fs.copyFileSync(path.resolve('apps/qq-channel/src/control-schema.sql'),path.join(out,'qq-control.sql'));
 fs.writeFileSync(path.join(out,'setup.mjs'),String.raw`
import fs from 'node:fs';import {createRequire}from'node:module';import{applyMigrations}from'/app/apps/api/src/migrations.mjs';
const {Pool}=createRequire('/app/apps/api/package.json')('pg');
for(const name of ['site','qq']){const p=new Pool({connectionString:'postgres://postgres:synthetic-local-only@pg:5432/'+name});try{if(name==='site'){const r=await applyMigrations(p,'/app/apps/api/migrations');if(r.total!==166)throw Error('SCHEMA166_REQUIRED');}else{await p.query(fs.readFileSync('/probe/qq-schema.sql','utf8'));await p.query(fs.readFileSync('/probe/qq-control.sql','utf8'));await p.query("INSERT INTO mooyu_qq.settings(channel_id,policy_hash)VALUES('synthetic-channel','synthetic-policy')");await p.query("INSERT INTO mooyu_qq.messages(channel_id,message_id,user_id,input_text,fingerprint,status,reply)VALUES('synthetic-channel','1','123456','synthetic history','synthetic-hash','delivered','synthetic reply')");}await p.query("CREATE TABLE cutover_sentinel(id integer PRIMARY KEY,note text NOT NULL)");await p.query("INSERT INTO cutover_sentinel VALUES(1,'history preserved'),(2,'settings preserved')");}finally{await p.end();}}
`);
 run(['run','--rm','--pull','never','--network',network,'--read-only','--mount','type=bind,source='+out+',target=/probe,readonly','--entrypoint','node',api,'/probe/setup.mjs']);
 const base={services:{paper:{image:api,command:['node','-e','setInterval(()=>{},1000)'],environment:{AGENT_PAPER_RESEARCH_WORKER_ENABLED:'true'},restart:'always',labels:{'mooyu.preflight.task':task},networks:['qa']}},networks:{qa:{external:true,name:network}}};
 fs.writeFileSync(baseFile,JSON.stringify(base));
 const common=['compose','-p',task,'-f',baseFile];run([...common,'up','-d','--no-build','--pull','never','paper']);paperCreated=true;
 const paperId=run([...common,'ps','-aq','paper']),paper=inspect(paperId),pg=inspect(db),role={role:'paper',container:paper.Name.slice(1),compose:{args:common,directory:out,project:task,service:'paper'},running:true,expectedRunning:true,expectedFingerprint:fingerprint(paper)};
 fs.writeFileSync(policyFile,JSON.stringify({services:{paper:{image:api,restart:'no',profiles:['paper-disabled'],environment:Object.fromEntries(PAPER_KEYS.map(k=>[k,'false'])),entrypoint:['node','-e','process.exit(0)'],command:[]}}}));
 const tool=new Cutover(out,{run});tool.state={version:1,phase:'prepared',roles:[role],files:[baseFile,policyFile].map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),gateway:{container:db,fingerprint:fingerprint(pg),startedAt:pg.State.StartedAt},protectedDatabases:[{container:db,fingerprint:fingerprint(pg),startedAt:pg.State.StartedAt}],databases:{api:{container:db,user:'postgres',database:'site'},qq:{container:db,user:'postgres',database:'qq'}},paperClosed:false,backups:[],executor:null};tool.processEnv=process.env;tool.save();
 assert.equal(tool.checkWindow({allowPaper:true}).idle,true);assert.equal(tool.paperClose().paperClosed,true);
 const closed=inspect(role.container);assert.equal(closed.State.Running,false);assert.equal(closed.HostConfig.RestartPolicy.Name,'no');for(const k of PAPER_KEYS)assert(closed.Config.Env.includes(k+'=false'));
 run(['start',role.container]);for(let i=0;i<50&&inspect(role.container).State.Running;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.equal(inspect(role.container).State.Running,false);assert.equal(inspect(role.container).State.ExitCode,0);assert.equal(tool.checkWindow().ready,true);
 const backup=tool.backup();assert.equal(backup.quiesced,true);tool.verifyBackups();
 const sourceHashes={};
 for(const b of tool.state.backups){const restored='restored_'+b.role;run(['exec',db,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE '+restored]);const fd=fs.openSync(b.path,'r');try{run(['exec','-i',db,'pg_restore','-U','postgres','--exit-on-error','-d',restored],{stdio:[fd,'pipe','pipe']});}finally{fs.closeSync(fd);}const sql="SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM cutover_sentinel t";const original=tool.sql(tool.state.databases[b.role],sql),copy=tool.sql({container:db,user:'postgres',database:restored},sql);assert.equal(copy,original);sourceHashes[b.role]=original;if(b.role==='qq'){const messages="SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY message_id)::text) FROM mooyu_qq.messages t";assert.equal(tool.sql({container:db,user:'postgres',database:restored},messages),tool.sql(tool.state.databases.qq,messages));}}
 assert.equal(tool.checkWindow().ready,true);fs.appendFileSync(tool.state.backups[0].path,'CORRUPTION_PROBE');assert.throws(()=>tool.verifyBackups(),/BACKUP_STALE_OR_CHANGED/);
 const result={result:'PASSED',schema:166,backupAndRestoreDatabases:2,restoredSyntheticHistoryAndQQMessages:true,fullArchiveDecodeVerified:true,corruptBackupRejected:true,paperRestartPolicy:'no',paperFlagsAllFalse:true,explicitPaperRestartExitedWithoutWork:true,sourceDatabaseHashes:sourceHashes,productionChanged:false,originalLocalContainersTouched:false};
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 if(paperCreated){const ids=run(['ps','-aq','--filter','label=mooyu.preflight.task='+task]).split(/\s+/).filter(Boolean);for(const id of ids){const c=inspect(id);if(c.Config.Labels?.['mooyu.preflight.task']!==task)throw Error('UNOWNED_RESOURCE');run(['rm','-f',id]);}dbCreated=false;}
 if(dbCreated){if(inspect(db).Config.Labels?.['mooyu.preflight.task']!==task)throw Error('UNOWNED_DATABASE');run(['rm','-f',db]);}
 if(netCreated){const n=JSON.parse(run(['network','inspect',network]))[0];if(n.Labels?.['mooyu.preflight.task']!==task)throw Error('UNOWNED_NETWORK');run(['network','rm',network]);}
}
