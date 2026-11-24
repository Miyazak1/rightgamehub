import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import{spawnSync}from'node:child_process';
import{groupReadyUpdater,SERVER_BASE,LOCAL_BASE}from'../../scripts/build-qq-group-ready-release.mjs';
const bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'bash';
const make=()=>groupReadyUpdater(fs.readFileSync(new URL('../../scripts/recover-qq-auth-client.mjs',import.meta.url),'utf8'));
test('group worker updater pins exact live base and checks runtime and source before stop, without old Node entry',()=>{
 const s=make();assert(s.includes("BASE='"+SERVER_BASE+"'"));assert(s.includes("proof.baseImage!=='"+LOCAL_BASE+"'"));assert(s.includes('ORIGINAL_WORKER_SOURCE_CHANGED'));assert(s.includes('verifyDeclaredRuntime(before,service,oldImage)'));assert(s.includes('BASE_IMAGE_CONFIG_OR_LAYERS_CHANGED'));assert(s.includes('QQ_GROUP_READINESS_NOT_CONFIRMED'));assert(s.includes('OLD_LOCKED_RECORD_CHANGED'));assert(s.includes('DESKTOP_PAPER_ADMISSION_CHANGED'));assert(s.includes('prior.ensureUpdateWindow'));assert(s.includes('agent_provider_calls'));assert(s.includes('respect-70-second-authentication-cooldown'));assert.doesNotMatch(s,/agent-plugins-stage-20261122-r3\/node|MOOYU_QQ_AUTH_FIX_AUTH|qq-auth-client-operation/);
 assert.equal(spawnSync(process.execPath,['--input-type=module','--check'],{input:s,encoding:'utf8'}).status,0);
 const mutated=fs.readFileSync(new URL('../../scripts/recover-qq-auth-client.mjs',import.meta.url),'utf8').replace('compare-this','unused').replace('function guards(){','function changedGuards(){');assert.throws(()=>groupReadyUpdater(mutated),/GROUP_UPDATER_ANCHOR_REQUIRED/);
});
test('group rollback is executable shell and rejects old stages, records, unverified runtimes and injection',()=>{
 const s=make(),context=vm.createContext({});vm.runInContext(s.slice(s.indexOf('export function groupRollbackCommand')).replace('export function','function'),context);
 const runtime='/root/mooyu-qq-gateway-runtime-20261124-Abc123/node',stage='/www/backup/gamehub/qq-group-ready-release-20261124-r1',record='/www/backup/gamehub/qq-group-ready-operation-20261124-Abc123';
 const sh=context.groupRollbackCommand(runtime,stage,record);assert(sh.includes('flock -n 9'));assert(sh.includes('MOOYU_QQ_GROUP_READY_AUTH=20261124'));assert.equal(spawnSync(bash,['-n'],{input:sh,encoding:'utf8'}).status,0);
 for(const args of [[runtime+'; x',stage,record],['/usr/bin/node',stage,record],[runtime,stage+'-old',record],[runtime,stage,record+'/../other']])assert.throws(()=>context.groupRollbackCommand(...args),/AUDITED_ROLLBACK_PATH_REQUIRED/);
});
