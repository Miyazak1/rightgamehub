import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {observationSequence,assertWorkerSources,OLD_WORKER_SOURCES,assertDeploymentBaseline,observationRollbackCommand,newMessageAcceptanceSQL,OBSERVATION_RECORD} from '../../scripts/update-qq-observation.mjs';
import {runtimeComparable,objectHash} from '../../scripts/qq-independent-release-common.mjs';
test('worker repair refuses image/config drift and unidentified prior deployments before any stop',()=>{
 const before={Image:'sha256:'+'a'.repeat(64),Config:{Env:['KEEP=original'],Labels:{}},HostConfig:{Binds:[]},Mounts:[],NetworkSettings:{Networks:{}}};
 const state={releaseId:'qq-independent-20261124-r1',selected:{worker:before.Image},roles:[{key:'worker',name:'mooyu-qq-worker-1',compose:{project:'mooyu-qq',service:'worker'},runtimeHash:objectHash(runtimeComparable(before))}]},result={result:'QQ_INDEPENDENT_DEPLOYED_GUARDIAN_ENABLED_ACCEPTANCE_PENDING',images:{worker:before.Image}};
 assertDeploymentBaseline(before,state,result);assertWorkerSources({...OLD_WORKER_SOURCES});
 for(const mutate of [v=>v.Image='sha256:'+'b'.repeat(64),v=>v.Config.Env.push('EXTRA=change'),v=>v.Mounts.push({Destination:'/login',Source:'other'})]){const c=structuredClone(before);mutate(c);assert.throws(()=>assertDeploymentBaseline(c,state,result));}
 assert.throws(()=>assertDeploymentBaseline(before,{...state,releaseId:'invented'},result));assert.throws(()=>assertWorkerSources({...OLD_WORKER_SOURCES,'napcat-control.mjs':'unreviewed'}));
});
test('failed preflight/build never stops worker; failed backup cannot start an unverified candidate',async()=>{
 const names=['preflight','record','build','stop','cooldown','backup','start','verify'];
 for(const at of ['preflight','build','backup']){const trace=[];await assert.rejects(observationSequence(Object.fromEntries(names.map(n=>[n,async()=>{trace.push(n);if(n===at)throw Error('injected');}]))));assert(!trace.includes('start'));if(at!=='backup')assert(!trace.includes('stop'));}
});
test('rollback accepts only its private runtime and new record, and shell argument injection is rejected',()=>{
 const runtime='/root/mooyu-qq-gateway-runtime-20261124-Test12/node',record=OBSERVATION_RECORD+'Test12',s=observationRollbackCommand(runtime,record),bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'bash';
 assert.equal(spawnSync(bash,['-n'],{input:s,encoding:'utf8'}).status,0);assert(s.includes('flock -n 9'));assert(s.includes('flock -w 20 8'));
 for(const args of [['/usr/bin/node',record],[runtime+'; bad',record],[runtime,record+'/../old'],[runtime,'/www/backup/gamehub/old']])assert.throws(()=>observationRollbackCommand(...args));
 assert.throws(()=>newMessageAcceptanceSQL("invalid' OR true"));
});
