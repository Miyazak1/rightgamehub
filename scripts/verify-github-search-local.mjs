// Dedicated, disconnected local DB acceptance. Reuses an existing runtime image
// and mounts source/tests read-only; never opens host ports or uses .env files.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync}from'node:child_process';
const out=path.resolve(process.argv[2]??'');
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_ISOLATED_BUILD_PATH_REQUIRED');
fs.mkdirSync(out,{recursive:true});
const suffix=crypto.randomUUID().replaceAll('-',''),name='github-search-local-'+suffix,database='qa_ledger_test_'+suffix,password=crypto.randomBytes(24).toString('hex');
const image=process.argv[3]??'sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe',label='mooyu.github.search.acceptance';
if(!/^sha256:[a-f0-9]{64}$/u.test(image))throw Error('IMMUTABLE_IMAGE_REQUIRED');
const run=(args,options={})=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8000000,...options});if(r.status!==0)throw Error('LOCAL_DOCKER_'+args[0]+'_'+(r.status??'TIMEOUT'));return r.stdout.trim();};
let created=false,result;
try{
 run(['image','inspect',image]);
 run(['run','-d','--pull','never','--name',name,'--label',label+'='+suffix,'--network','none','--memory','512m','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_USER=qa_ledger_test','-e','POSTGRES_DB='+database,'-e','POSTGRES_PASSWORD='+password,'postgres:17']);created=true;
 let ready=false;for(let i=0;i<100;i++){const r=spawnSync('docker',['exec',name,'pg_isready','-U','qa_ledger_test','-d',database],{stdio:'ignore',windowsHide:true,timeout:3000});if(r.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,300));}assert(ready,'isolated database ready');
 const args=['run','--rm','--pull','never','--label',label+'='+suffix,'--network','container:'+name,'--entrypoint','node','-e','QA_LEDGER_TEST_ISOLATED=1','-e','QA_LEDGER_TEST_URL=postgresql://qa_ledger_test:'+password+'@127.0.0.1:5432/'+database,'-e','DATABASE_URL=','-e','GAMEHUB_TEST_DATABASE_URL='];
 for(const [source,target]of [...(process.argv[3]?[]:[['apps/api/src','/app/apps/api/src']]),['apps/api/migrations','/app/apps/api/migrations'],['tests','/app/tests'],['apps/qq-channel/src','/app/apps/qq-channel/src']])args.push('--mount','type=bind,source='+path.resolve(source)+',target='+target+',readonly');
 for(const f of ['update-github-search-online.mjs','agent-server-cutover.mjs'])args.push('--mount','type=bind,source='+path.resolve('scripts',f)+',target=/app/scripts/'+f+',readonly');
 args.push(image,'--test','--test-concurrency=1','/app/tests/platform/github-search-quality-db.test.cjs','/app/tests/platform/agent-interaction-github-db.test.cjs','/app/tests/platform/agent-github-question-db.test.cjs','/app/tests/platform/github-search-online-sql-db.test.cjs');
 if(process.argv[4]==='receipts')args.push('/app/tests/platform/agent-interaction-db.test.cjs');
 const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8000000});
 fs.writeFileSync(path.join(out,'database-tests.tap'),r.stdout??'');fs.writeFileSync(path.join(out,'database-tests.stderr.txt'),r.stderr??'');
 result={result:r.status===0?'PASSED':'FAILED',image,applicationSourceFromImage:Boolean(process.argv[3]),exitCode:r.status,network:'isolated-db-loopback-only',syntheticData:true,realPolicyBudgetAndArtifactGateways:true,modelAndGitHubResponses:'deterministic-fixtures',productionAccessed:false,existingContainersChanged:false};
 if(r.status!==0)process.exitCode=1;
}finally{if(created){const c=JSON.parse(run(['inspect',name]))[0];assert.equal(c.Config.Labels[label],suffix);assert.equal(c.HostConfig.NetworkMode,'none');assert(c.Mounts.every(m=>m.Type==='tmpfs'));run(['rm','-f',name]);}}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,testResourcesCleaned:true},null,2)+'\n');console.log(JSON.stringify(result));
