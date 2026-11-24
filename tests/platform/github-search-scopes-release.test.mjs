import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {spawnSync} from 'node:child_process';
import {formatUpdater} from '../../scripts/build-github-plan-format-release.mjs';
import {SCOPES_BASE,RECOVERY_BASE,SCOPES_PREFIX,SCOPES_PRIVATE_RUNTIME,scopesUpdater} from '../../scripts/github-search-scopes-release.mjs';
const bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'bash';
const source=()=>scopesUpdater(formatUpdater(fs.readFileSync(new URL('../../scripts/update-github-search-online.mjs',import.meta.url),'utf8'),{base:SCOPES_BASE,operationPrefix:SCOPES_PREFIX}));
test('scopes release pins current base, two-role updater and new records without registration, old runtime or retries',()=>{
 const s=source();assert.match(s,new RegExp(SCOPES_BASE));assert.match(s,/MOOYU_GITHUB_SEARCH_AUTH!=='20261124'/);assert.match(s,/verify-existing-search-workflow-no-registration/);
 assert.doesNotMatch(s,/agent-interaction-bootstrap-cli|agent-plugins-stage-20261122-r3\/node|register-additive-search-contract/);
 assert.match(s,/scopesRollbackCommand\(process.execPath,stage,directory\)/);assert.match(s,/automaticRetry:false,automaticRollback:false/);
 assert.equal(spawnSync(process.execPath,['--input-type=module','--check'],{input:s,encoding:'utf8'}).status,0);
 assert.throws(()=>scopesUpdater(s),/SCOPES_UPDATER_ANCHOR_REQUIRED/);
});
test('generated rollback command uses the verified private runtime and shared lock; rejects other versions and injected paths',()=>{
 const s=source(),part=s.slice(s.indexOf('export function scopesRollbackCommand')).replace('export function','function'),context=vm.createContext({});vm.runInContext(part,context);
 const runtime='/root/mooyu-github-search-runtime-20261124-Abc123/node',stage='/www/backup/gamehub/github-search-release-20261124-scopes-r1',record='/www/backup/gamehub/'+SCOPES_PREFIX+'Abc123';
 const command=context.scopesRollbackCommand(runtime,stage,record);assert(command.includes(runtime));assert(command.includes('flock -n 9'));assert(command.includes(" rollback '"+stage+"' '"+record+"'"));
 assert.equal(spawnSync(bash,['-n'],{input:command,encoding:'utf8'}).status,0);
 for(const args of [[runtime+'; other',stage,record],['/usr/bin/node',stage,record],[runtime,stage+'-old',record],[runtime,stage,record+'/../other']])assert.throws(()=>context.scopesRollbackCommand(...args),/REVIEWED_ROLLBACK_PATH_REQUIRED/);
});
test('private runtime bootstrap syntax is valid and only reads API, checks hash/version and chmods newly created files',()=>{
 assert.equal(spawnSync(bash,['-n'],{input:SCOPES_PRIVATE_RUNTIME,encoding:'utf8'}).status,0);
 assert.match(SCOPES_PRIVATE_RUNTIME,/sha256sum --check --status/);assert.match(SCOPES_PRIVATE_RUNTIME,/node_hash/);assert.match(SCOPES_PRIVATE_RUNTIME,/v22\.\*/);
 assert.doesNotMatch(SCOPES_PRIVATE_RUNTIME,/docker (?:restart|stop|start|compose)|chmod[^\n]*candidate/);
});
test('recovery release pins the live scopes base and cannot roll back through an earlier release directory',()=>{
 const s=scopesUpdater(formatUpdater(fs.readFileSync(new URL('../../scripts/update-github-search-online.mjs',import.meta.url),'utf8'),{base:RECOVERY_BASE,operationPrefix:'github-search-recovery-operation-20261124-'}),{variant:'recovery'});
 assert(s.includes("const BASE='"+RECOVERY_BASE+"'"));assert.doesNotMatch(s,/github-search-scopes-operation|release-20261124-scopes-r1/);
 assert.equal(spawnSync(process.execPath,['--input-type=module','--check'],{input:s,encoding:'utf8'}).status,0);
 const context=vm.createContext({});vm.runInContext(s.slice(s.indexOf('export function scopesRollbackCommand')).replace('export function','function'),context);
 const runtime='/root/mooyu-qq-gateway-runtime-20261124-Abc123/node',stage='/www/backup/gamehub/github-search-release-20261124-recovery-r1',record='/www/backup/gamehub/github-search-recovery-operation-20261124-Abc123';
 const command=context.scopesRollbackCommand(runtime,stage,record);assert(command.includes('flock -n 9'));assert.equal(spawnSync(bash,['-n'],{input:command,encoding:'utf8'}).status,0);
 assert.throws(()=>context.scopesRollbackCommand(runtime,stage.replace('recovery','scopes'),record));assert.throws(()=>context.scopesRollbackCommand(runtime,stage,record.replace('recovery','scopes')));
});
