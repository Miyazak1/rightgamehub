import test from 'node:test';import assert from 'node:assert/strict';
import {assertScheduleWindow,performAuthorizedDeployment} from '../../scripts/authorized-agent-upgrade.mjs';
test('deployment refuses missing, overdue or near-trigger schedule; does not disable or reschedule it',()=>{
 const now=Date.now(),plans=[{enabled:true,next_fire_at:new Date(now+46*60000).toISOString()}],before=JSON.stringify(plans);assert.doesNotThrow(()=>assertScheduleWindow(plans,now));assert.equal(JSON.stringify(plans),before);
 for(const p of [[],null,[{enabled:true,next_fire_at:null}],[{enabled:true,next_fire_at:'invalid'}],[{enabled:true,next_fire_at:new Date(now-1).toISOString()}],[{enabled:true,next_fire_at:new Date(now+44*60000).toISOString()}]])assert.throws(()=>assertScheduleWindow(p,now));
});
test('authorized orchestration prepares a separate record before mutation and verifies afterward',async()=>{
 const seen=[],names=['preflight','prepare','verifyPrepared','upgrade','verifyFinal'],adapter=Object.fromEntries(names.map(name=>[name,async()=>seen.push(name)]));await performAuthorizedDeployment(adapter);assert.deepEqual(seen,names);
});
test('failed prerequisites never reach upgrade; failed upgrade never claims final verification or retries',async()=>{
 for(const stop of ['preflight','prepare','verifyPrepared','upgrade']){const seen=[],names=['preflight','prepare','verifyPrepared','upgrade','verifyFinal'],adapter=Object.fromEntries(names.map(name=>[name,async()=>{seen.push(name);if(name===stop)throw Error('INJECTED_FAILURE');}]));await assert.rejects(performAuthorizedDeployment(adapter),/INJECTED_FAILURE/);assert.deepEqual(seen,names.slice(0,names.indexOf(stop)+1));}
});
