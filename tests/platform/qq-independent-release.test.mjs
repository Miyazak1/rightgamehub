import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
import {QQ_RELEASE_ROLES,QQ_RELEASE_STAGE,independentDeploymentSequence,assertWorkerImageProbe,QQ_WORKER_PATCHES} from '../../scripts/qq-independent-release-common.mjs';
import {guardianUnits,QQ_SCAN_PROBE} from '../../scripts/deploy-qq-independent-plugin.mjs';
test('independent release mutates only the API, Web and QQ worker; recovery enablement follows backups and preservation checks',async()=>{
 assert.deepEqual(QQ_RELEASE_ROLES.map(r=>r.name),['gamehub-production-api-1','gamehub-production-web-1','mooyu-qq-worker-1']);
 const order=['preflight','record','prepareWorker','prepareGuardian','stopWorker','stopApi','backup','startApi','startWorker','startWeb','verifyPreservation','enableGuardian','verifyFinal'],seen=[];
 await independentDeploymentSequence(Object.fromEntries(order.map(k=>[k,async()=>seen.push(k)])));assert.deepEqual(seen,order);
 for(const failed of ['preflight','prepareWorker','backup','verifyPreservation']){const trace=[];await assert.rejects(independentDeploymentSequence(Object.fromEntries(order.map(k=>[k,async()=>{trace.push(k);if(k===failed)throw Error('injected');}]))));assert(!trace.includes('enableGuardian'));if(['preflight','prepareWorker'].includes(failed))assert(!trace.includes('stopWorker'));if(failed==='backup')assert(!trace.includes('startApi'));}
});
test('guardian units do not auto-start Docker, use reviewed immutable paths, and contain no restart loop',()=>{
 const options={runtime:'/root/mooyu-qq-gateway-runtime-20261124-Test12/node',stage:QQ_RELEASE_STAGE,stateRoot:'/www/backup/gamehub/qq-independent-guardian-20261124-r1'},units=guardianUnits(options),s=units['mooyu-qq-guardian.service'];
 assert(s.includes('Requisite=docker.service'));assert(!s.includes('Requires=docker.service'));assert(!s.includes('Restart='));assert(s.includes('ProtectSystem=strict'));assert(s.includes(' recover '));assert(units['mooyu-qq-guardian.timer'].includes('OnUnitInactiveSec=20'));
 for(const change of [{runtime:'/usr/bin/node'},{runtime:options.runtime+"';bad"},{stage:'/www/backup/old'},{stateRoot:'/tmp/shared'}])assert.throws(()=>guardianUnits({...options,...change}));
});
test('nonroot source validation rejects unreadable/root-owned/wrong worker patches before stopping the existing worker',()=>{
 const sources=Object.fromEntries(QQ_WORKER_PATCHES.map(f=>[f,'a'.repeat(64)])),probe={uid:1000,files:Object.fromEntries(QQ_WORKER_PATCHES.map(f=>[f,{sha256:sources[f],owner:1000,mode:0o444}]))};assertWorkerImageProbe(probe,sources);
 for(const bad of [{...probe,uid:0},{...probe,files:{...probe.files,[QQ_WORKER_PATCHES[0]]:{...probe.files[QQ_WORKER_PATCHES[0]],mode:0o600}}}])assert.throws(()=>assertWorkerImageProbe(bad,sources));
});
test('server deployment and scan probe are syntactically valid; scan output omits QR contents and never clears login data',()=>{
 for(const source of [fs.readFileSync(new URL('../../scripts/deploy-qq-independent-plugin.mjs',import.meta.url),'utf8'),QQ_SCAN_PROBE])assert.equal(spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8'}).status,0);
 assert(QQ_SCAN_PROBE.includes("operation:'qr'"));assert(QQ_SCAN_PROBE.includes('ALREADY_LOGGED_IN_QR_GUARD_CONFIRMED'));assert(!QQ_SCAN_PROBE.includes('qrText:v.data'));assert(!QQ_SCAN_PROBE.includes('Logout'));
 const s=fs.readFileSync(new URL('../../scripts/deploy-qq-independent-plugin.mjs',import.meta.url),'utf8');assert(!s.includes('migrate-cli'));assert(!s.includes('bootstrap-cli'));assert(!s.includes('docker([\'restart\''));assert(s.includes("'--no-deps','--no-build','--pull','never'"));assert(s.includes('UNACKNOWLEDGED_GATEWAY_RESTART'));assert(s.includes('QQ_NEW_MESSAGE_ACCEPTANCE_PENDING'));
});
