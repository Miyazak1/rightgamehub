import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const out=path.resolve(process.argv[2]??'');
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_ISOLATED_OUTPUT_REQUIRED');fs.mkdirSync(out,{recursive:true});
const hostTests=['tests/platform/qq-plugin-stability.test.mjs','tests/platform/qq-gateway-auth.test.mjs','tests/platform/qq-group-readiness.test.mjs','tests/platform/qq-channel-plugin.test.mjs','tests/platform/qq-runtime-status.test.mjs','tests/platform/qq-channel.test.mjs','tests/platform/qq-password-login.test.cjs','tests/client/qq-admin-settings.test.mjs','tests/platform/agent-plugin-host.test.mjs'];
const base='sha256:2b6e0cbc637cdbb1081b803e5b0600053ed3c005a07a7a85e1eee9353b8c5a32';
const label='mooyu.qq.stability.acceptance',id=crypto.randomBytes(16).toString('hex'),name='qq-stability-'+id,database='qa_ledger_test_'+id,password=crypto.randomBytes(24).toString('hex');
const run=(args,options={})=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4000000,...options});if(r.status!==0)throw Error('QQ_LOCAL_DOCKER_'+args[0]+'_FAILED');return r.stdout.trim();};
function checked(name,command,args,env={}){const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8*1024*1024,env:{...process.env,...env}});fs.writeFileSync(path.join(out,name+'.tap'),r.stdout??'');fs.writeFileSync(path.join(out,name+'.stderr.txt'),r.stderr??'');if(r.status!==0)throw Error(name.toUpperCase()+'_FAILED');return Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,Number(r.stdout.match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]??0)]));}
const results={};let created=false;
try{
 results.host=checked('host',process.execPath,['--test',...hostTests]);
 const apiTag='mooyu-github-search:20261124-recovery-r1',workerTag='mooyu-qq-auth-permissions:private-fixed-20261123-r1';
 if(JSON.parse(run(['image','inspect',apiTag]))[0].Id!==base||JSON.parse(run(['image','inspect',workerTag]))[0].Id!=='sha256:59aa36815825b97d4acddc02b1dd29cb6d6fb3779aac8a5357cf9c626972ba63')throw Error('REVIEWED_LOCAL_DEPENDENCY_IMAGES_REQUIRED');
 const reuse=process.argv[3];if(reuse&&!/^sha256:[a-f0-9]{64}$/u.test(reuse))throw Error('IMMUTABLE_REUSED_TEST_IMAGE_REQUIRED');
 const ctx=path.join(out,'test-context'),testImage=reuse??'mooyu-qq-stability-test:'+id;
 if(reuse)run(['image','inspect',reuse]);else{
 fs.mkdirSync(ctx);fs.copyFileSync('apps/qq-channel/package.json',path.join(ctx,'qq-package.json'));
 // Reuse API dependencies and COPY only the standalone ws package from the
 // existing worker image; no install, store changes or full node_modules copy.
 fs.writeFileSync(path.join(ctx,'Dockerfile'),'FROM '+workerTag+' AS qqdeps\nFROM '+apiTag+'\nUSER root\nCOPY --from=qqdeps /app/apps/qq-channel/node_modules/ws /opt/qq-test-deps/ws\nCOPY qq-package.json /app/apps/qq-channel/package.json\nRUN mkdir -p /app/apps/qq-channel/node_modules && ln -s /opt/qq-test-deps/ws /app/apps/qq-channel/node_modules/ws && ln -s /app/apps/api/node_modules/pg /app/apps/qq-channel/node_modules/pg\nUSER node\n');
 const build=spawnSync('docker',['build','--network','none','--pull=false','-t',testImage,ctx],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4000000});fs.writeFileSync(path.join(out,'test-image-build.log'),(build.stdout??'')+(build.stderr??''));if(build.status!==0)throw Error('ISOLATED_TEST_IMAGE_FAILED');
 }
 run(['run','-d','--pull','never','--name',name,'--label',label+'='+id,'--network','none','--memory','512m','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_USER=qa_ledger_test','-e','POSTGRES_DB='+database,'-e','POSTGRES_PASSWORD='+password,'postgres:17']);created=true;
 let ready=false;for(let i=0;i<100;i++){if(spawnSync('docker',['exec',name,'pg_isready','-U','qa_ledger_test','-d',database],{stdio:'ignore',windowsHide:true}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,300));}if(!ready)throw Error('ISOLATED_DATABASE_NOT_READY');
 const args=['run','--rm','--pull','never','--user','0','--label',label+'='+id,'--network','container:'+name,'--entrypoint','node','-e','QA_LEDGER_TEST_ISOLATED=1','-e','QA_LEDGER_TEST_URL=postgresql://qa_ledger_test:'+password+'@127.0.0.1:5432/'+database,'-e','DATABASE_URL=','-e','GAMEHUB_TEST_DATABASE_URL='];
 for(const p of ['apps/api/src','apps/api/migrations','apps/qq-channel/src','packages/platform-client/src','tests','scripts'])args.push('--mount','type=bind,source='+path.resolve(p)+',target=/app/'+p+',readonly');
 args.push(testImage,'--test','--test-concurrency=1','/app/tests/platform/qq-plugin-stability.test.mjs','/app/tests/platform/qq-plugin-guardian-linux.test.mjs','/app/tests/platform/agent-qq-admin-db.test.cjs','/app/tests/platform/agent-qq-channel-db.test.cjs','/app/tests/platform/agent-plugin-admin-db.test.cjs');
 results.linuxAndDatabase=checked('linux-database','docker',args);
 const sources=['apps/qq-channel/src/napcat-control.mjs','apps/qq-channel/src/control-server.mjs','apps/qq-channel/src/control-store.mjs','apps/qq-channel/src/plugins/qq/runtime.mjs','apps/qq-channel/src/recovery-policy.mjs','apps/api/src/agent-plugin-admin.mjs','packages/platform-client/src/qq-admin-settings.mjs','packages/platform-client/src/AgentQQAdmin.jsx','packages/platform-client/src/AgentPluginAdmin.jsx','scripts/qq-plugin-guardian.mjs','scripts/qq-plugin-release-guard.mjs','scripts/integrate-qq-release-guard.mjs','scripts/build-github-plan-format-release.mjs'];
 const result={result:'PASSED',results,testDependencyImage:JSON.parse(run(['image','inspect',testImage]))[0].Id,applicationSources:'read-only mounts of current local source',sourceHashes:Object.fromEntries(sources.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),nativeAndProviderResponses:'synthetic',realQQLoginTested:false,isolatedPostgres:true,realSignedHTTPAndOneBotSockets:true,linuxGuardianIO:'real private filesystem/tar; simulated docker CLI',productionAccessed:false,onlineServicesRestarted:false,oldTasksRetried:false};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 if(created){const c=JSON.parse(run(['inspect',name]))[0];if(c.Config.Labels[label]!==id||c.HostConfig.NetworkMode!=='none'||c.Mounts.some(m=>m.Type!=='tmpfs'))throw Error('OWN_TEST_CONTAINER_REQUIRED');run(['rm','-f',name]);}
}
