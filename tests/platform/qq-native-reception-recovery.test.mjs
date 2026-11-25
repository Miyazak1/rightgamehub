import test from 'node:test';import assert from 'node:assert/strict';
import {reserveManualReceiveRecovery,manualReceiveRecoverySequence} from '../../scripts/recover-qq-native-reception-once.mjs';
const now=Date.UTC(2026,10,25,14,0),prior={version:1,attempts:[],incident:null,stableSince:null,manualRequired:false,lastAt:now-1000};
test('manual recovery preserves old attempt history and consumes the existing daily limit without resetting it',()=>{
 const old={...prior,attempts:[now-2*86400000,now-3600000]},r=reserveManualReceiveRecovery(old,now);
 assert.deepEqual(r.attempts,[...old.attempts,now]);assert.equal(r.manualRequired,true);assert.equal(r.incidentHandled,true);assert.equal(old.attempts.length,2);
 for(const p of [{...prior,manualRequired:true},{...prior,incidentHandled:true},{...prior,lastAt:now+1},{...prior,attempts:[now-10000]},{...prior,attempts:[now-7200000,now-3600000]}])assert.throws(()=>reserveManualReceiveRecovery(p,now));
});
function fixture(failAt){const seen=[],states=[];let stops=0,starts=0;const fn=name=>async()=>{seen.push(name);if(name===failAt)throw Error('INJECTED_'+name);};return {seen,states,get stops(){return stops;},get starts(){return starts;},io:{guard:fn('guard'),save:async s=>states.push(structuredClone(s)),backup:c=>fn(c?'cold':'warm')(),confirmIncident:fn('incident'),assertIdle:fn('idle'),stop:async()=>{stops++;return fn('stop')();},guardStopped:fn('guardStopped'),start:async()=>{starts++;return fn('start')();},verify:fn('verify')}};}
test('only original-gateway stop/start occur, after reservation, verified warm backup and repeated incident checks',async()=>{
 const f=fixture();const done=await manualReceiveRecoverySequence({reserved:reserveManualReceiveRecovery(prior,now),io:f.io});
 assert.deepEqual(f.seen,['guard','warm','guard','incident','idle','stop','cold','guardStopped','start','verify']);assert.equal(f.stops,1);assert.equal(f.starts,1);
 assert.equal(f.states[0].lastOutcome,'manual-reception-reserved');assert.equal(f.states[0].attempts.length,1);assert.equal(done.manualRequired,false);assert.equal(done.lastOutcome,'gateway-started');
});
test('pre-stop failures cannot stop or start the gateway and cannot erase the reserved attempt',async()=>{
 for(const point of ['warm','incident','idle']){const f=fixture(point);await assert.rejects(manualReceiveRecoverySequence({reserved:reserveManualReceiveRecovery(prior,now),io:f.io}),/INJECTED/);assert.equal(f.stops,0);assert.equal(f.starts,0);assert.equal(f.states.at(-1).manualRequired,true);assert.equal(f.states.at(-1).attempts.length,1);}
});
test('cold archive failure starts the original stopped gateway once, keeps warm backup and requires review',async()=>{
 const f=fixture('cold');await assert.rejects(manualReceiveRecoverySequence({reserved:reserveManualReceiveRecovery(prior,now),io:f.io}),/INJECTED_cold/);
 assert.equal(f.stops,1);assert.equal(f.starts,1);assert.equal(f.states.at(-1).lastOutcome,'review-required');assert.equal(f.states.at(-1).manualRequired,true);
});
test('uncertain stop/start and post-start verification failures never automatically retry a stop',async()=>{
 for(const point of ['stop','start','verify','guardStopped']){const f=fixture(point);await assert.rejects(manualReceiveRecoverySequence({reserved:reserveManualReceiveRecovery(prior,now),io:f.io}),/INJECTED/);assert.equal(f.stops,1);assert(f.starts<=1);assert.equal(f.states.at(-1).manualRequired,true);if(point==='stop'||point==='start')assert.equal(f.states.at(-1).lastOutcome,'gateway-start-required');}
});
