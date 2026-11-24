import test from'node:test';import assert from'node:assert/strict';import{qqAuthRecoverySequence}from'../../scripts/recover-qq-auth-client.mjs';
test('QQ client recovery stops only after preparation, respects cooldown before starting, and failures stop continuation',async()=>{
 const steps=['check','record','build','stop','cooldown','backup','start','verify'],seen=[];await qqAuthRecoverySequence(Object.fromEntries(steps.map(k=>[k,async()=>seen.push(k)])));assert.deepEqual(seen,steps);
 for(const stop of steps){const calls=[];await assert.rejects(qqAuthRecoverySequence(Object.fromEntries(steps.map(k=>[k,async()=>{calls.push(k);if(k===stop)throw Error('BLOCK');}]))),/BLOCK/);assert.deepEqual(calls,steps.slice(0,steps.indexOf(stop)+1));}
});
