import test from 'node:test';import assert from 'node:assert/strict';
import {recoverySequence,assertNoActiveDelivery} from '../../scripts/recover-qq-gateway-once.mjs';
const stages=['preflight','warmBackup','recheck','stopOnce','coldBackup','startOnce','verify'];
test('recovery backs up before stop and while stopped, starts the original container exactly once',async()=>{const seen=[],a=Object.fromEntries(stages.map(n=>[n,async()=>seen.push(n)]));await recoverySequence(a);assert.deepEqual(seen,stages);});
test('failure never skips backup, retries restart or starts after an invalid cold archive',async()=>{for(const failAt of ['preflight','warmBackup','recheck','stopOnce','coldBackup','startOnce']){const seen=[],a=Object.fromEntries(stages.map(n=>[n,async()=>{seen.push(n);if(n===failAt)throw Error('INJECTED');}]));await assert.rejects(recoverySequence(a),/INJECTED/);assert.deepEqual(seen,stages.slice(0,stages.indexOf(failAt)+1));}});
test('in-flight delivery blocks recovery, while unknown delivery counts cannot pass',()=>{assert.doesNotThrow(()=>assertNoActiveDelivery(0));for(const n of [1,-1,NaN,'0',0.5])assert.throws(()=>assertNoActiveDelivery(n));});
