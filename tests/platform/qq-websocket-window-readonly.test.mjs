import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {collectWSWindow,wsWindowReadonlyCommand} from '../../scripts/qq-websocket-window-readonly.mjs';
test('window diagnosis identifies blocking ledgers without modifying or echoing content',()=>{
 const calls=[],out=[],r={exists:()=>true,sql:(db,q)=>{calls.push(q);assert(q.startsWith('SELECT '));assert(!/\b(?:UPDATE|INSERT|DELETE|ALTER|CREATE|DROP)\b/i.test(q));if(q.includes("'retainedCompleted'"))return '{"total":2,"retainedCompleted":2}';if(q.includes('json_agg(s)')){assert(!q.includes('input_text'));assert(!q.includes('reply'));return '[{"item":{"id":"fixture","state":"uncertain","createdAt":"2026-11-20T00:00:00Z"}}]';}return q.includes('FROM agent_runs ')?'1':'0';}};
 const result=collectWSWindow(r,{api:{},qq:{}},v=>out.push(JSON.parse(v)));assert.deepEqual(result.blocking,[{database:'api',table:'agent_runs',count:1}]);assert.equal(result.tasksRetried,false);assert.equal(result.locksModified,false);assert.equal(out.find(v=>v.table==='agent_runtime_outbox').blocking,0);assert(calls.length>10);
});
test('window diagnosis reports missing required ledgers without manufacturing zero counts',()=>{
 const result=collectWSWindow({exists:()=>false},{api:{},qq:{}},()=>{});assert(result.missing.includes('agent_runs'));assert(!result.missing.includes('agent_interactions'));assert.equal(result.blocking.length,0);
});
test('generated command parses and calls only existing read-only diagnostics',()=>{
 const body=wsWindowReadonlyCommand(),bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';assert.equal(spawnSync(bash,['-n'],{input:body,encoding:'utf8'}).status,0);assert(body.includes('collectWSWindow(reader,databases)'));assert(!body.includes('updateQQWebSocket'));assert(!body.includes('MOOYU_QQ_WEBSOCKET_AUTH'));assert(!body.includes('docker stop'));assert(!body.includes('flock'));assert(!body.includes('mkdir'));
 const script=body.split("<<'NODE'\n")[1].split('\nNODE\n')[0];assert.equal(spawnSync(process.execPath,['--input-type=module','--check'],{input:script,encoding:'utf8'}).status,0);
});
