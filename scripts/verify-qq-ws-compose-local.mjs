// Real Docker/Compose rehearsal with new synthetic containers. Never starts QQ.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {runtimeComparable,objectHash,fileHash} from './qq-independent-release-common.mjs';
import {WS_BASE_IMAGE,WS_PATCH_SHA256,assertWSRuntime} from './qq-websocket-release-common.mjs';
const out=path.resolve(process.argv[2]??'');assert(out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\20261127\\')&&!fs.existsSync(out),'NEW_E_BUILD_DIRECTORY_REQUIRED');fs.mkdirSync(out,{recursive:true});
const nonce=crypto.randomBytes(12).toString('hex'),project='qq-ws-switch-'+nonce,base=WS_BASE_IMAGE,candidate='sha256:7448b7d8f917f76676dc67d864c2183b030be4a0fe05646d5c106527d6dd4274',source=path.resolve('scripts/update-qq-websocket-owner.mjs');
const run=(args,options={})=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024,...options});if(r.status!==0)throw Error('OWN_COMPOSE_'+args[0].toUpperCase()+'_FAILED');return r.stdout.trim();};
const inspect=name=>JSON.parse(run(['inspect',name]))[0],composeArgs=['compose','--project-directory',out,'-p',project,'-f',out+'/compose.json'];
const compose=(tail,overlay)=>run([...composeArgs,...(overlay?['-f',out+'/'+overlay]:[]),...tail]);
const command=`const f=require('fs');if(!f.existsSync('/data/session'))f.writeFileSync('/data/session',${JSON.stringify(nonce)});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
const service={image:base,hostname:'qq-ws-fixture-device',entrypoint:['node','-e',command],command:[],user:'0',read_only:true,init:true,restart:'no',mem_limit:'128m',ulimits:{core:0},volumes:['login:/data'],labels:{'right.qq.ws-compose':nonce}};
fs.writeFileSync(out+'/compose.json',JSON.stringify({services:{napcat:service,worker:{...service,hostname:'fixture-worker',volumes:['worker:/data']},protected:{...service,hostname:'fixture-protected',volumes:['protected:/data']}},volumes:{login:{},worker:{},protected:{}},networks:{default:{internal:true}}},null,2));
const state=c=>({id:c.Id,name:c.Name,image:c.Image,running:c.State.Running,started:c.State.StartedAt,restarts:c.RestartCount,runtime:objectHash(runtimeComparable(c))});
const others=()=>{const ids=run(['ps','-aq']).split(/\s+/).filter(Boolean);return JSON.parse(run(['inspect',...ids])).filter(c=>c.Config.Labels?.['com.docker.compose.project']!==project).map(state).sort((a,b)=>a.id.localeCompare(b.id));};
const protectedBefore=others();let created=false;
try{
 const baseImage=JSON.parse(run(['image','inspect',base]))[0],target=JSON.parse(run(['image','inspect',candidate]))[0];assert.deepEqual(target.Config,baseImage.Config);assert.deepEqual(target.RootFS.Layers.slice(0,baseImage.RootFS.Layers.length),baseImage.RootFS.Layers);assert.equal(target.RootFS.Layers.length,baseImage.RootFS.Layers.length+1);
 created=true;compose(['up','-d','--no-build','--pull','never']);const names=Object.fromEntries(['napcat','worker','protected'].map(s=>[s,project+'-'+s+'-1']));
 const before=Object.fromEntries(Object.entries(names).map(([k,n])=>[k,inspect(n)]));for(const c of Object.values(before)){assert.equal(c.Config.Labels['right.qq.ws-compose'],nonce);assert(c.State.Running);}
 const digest=()=>run(['exec',names.napcat,'node','-e',"console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/data/session')).digest('hex'))"]);
 const loginHash=digest();run(['stop','--timeout','15',names.worker]);run(['stop','--timeout','15',names.napcat]);
 fs.writeFileSync(out+'/candidate.json',JSON.stringify({services:{napcat:{image:candidate,hostname:before.napcat.Config.Hostname}}}));compose(['up','-d','--no-deps','--no-build','--pull','never','napcat'],'candidate.json');const switched=inspect(names.napcat);
 assertWSRuntime({...switched,Name:'/mooyu-qq-napcat-1'}, {...before.napcat,Name:'/mooyu-qq-napcat-1'},candidate);assert.notEqual(switched.Id,before.napcat.Id);assert.equal(digest(),loginHash);
 assert.equal(run(['exec',names.napcat,'node','-e',"console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/napcat/napcat.mjs')).digest('hex'))"]),WS_PATCH_SHA256);
 const sourceMode=JSON.parse(run(['exec',names.napcat,'node','-e',"const s=require('fs').statSync('/app/napcat/napcat.mjs');console.log(JSON.stringify({owner:s.uid,mode:s.mode&511}));"]));assert.equal(sourceMode.owner,1000);assert.equal(sourceMode.mode,0o444);
 run(['start',names.worker]);const worker=inspect(names.worker);assert.equal(worker.Id,before.worker.Id);assert.equal(worker.Image,before.worker.Image);assert.deepEqual(runtimeComparable(worker),runtimeComparable(before.worker));assert.deepEqual(state(inspect(names.protected)),state(before.protected));
 run(['stop','--timeout','15',names.worker]);run(['stop','--timeout','15',names.napcat]);fs.writeFileSync(out+'/rollback.json',JSON.stringify({services:{napcat:{image:base,hostname:before.napcat.Config.Hostname}}}));
 run([...composeArgs,'-f',out+'/candidate.json','-f',out+'/rollback.json','up','-d','--no-deps','--no-build','--pull','never','napcat']);const rolled=inspect(names.napcat);assertWSRuntime(rolled,before.napcat,base);assert.equal(digest(),loginHash);run(['start',names.worker]);assert.equal(inspect(names.worker).Id,before.worker.Id);assert.deepEqual(state(inspect(names.protected)),state(before.protected));assert.deepEqual(others(),protectedBefore);
 const result={result:'PASSED',realComposeGatewaySwitchAndRollback:true,workerSameContainerAndImage:true,loginVolumeAndDataRetained:true,originalHostnameAndRuntimePreserved:true,sourceModeVerified:sourceMode,baseImageConfigurationAndLayersPreserved:true,otherExistingContainersUnchanged:true,fixtureOnly:true,realQQStarted:false,productionAccessed:false,updaterSourceSha256:fileHash(source),commonSourceSha256:fileHash('scripts/qq-websocket-release-common.mjs')};fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 if(created){const ids=compose(['ps','-aq']).split(/\s+/).filter(Boolean);for(const id of ids)assert.equal(inspect(id).Config.Labels?.['right.qq.ws-compose'],nonce);compose(['down','--volumes','--remove-orphans']);}
}
