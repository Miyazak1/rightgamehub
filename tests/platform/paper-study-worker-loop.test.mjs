import test from 'node:test';
import assert from 'node:assert/strict';
import {runPaperStudyWorker} from '../../apps/api/src/paper-study-worker-loop.mjs';
const active=()=>Object.assign(Error(),{code:'AGENT_RUNTIME_WORKER_ALREADY_ACTIVE'});
test('same-ID registration waits without bypassing ownership and resumes after expiry',async()=>{
  const controller=new AbortController(),statuses=[];let clock=0,calls=0;
  await runPaperStudyWorker({signal:controller.signal,runtime:{async runOnce(){if(++calls<3)throw active();controller.abort();return{status:'completed'};}},
    now:()=>clock,wait:async ms=>{clock+=ms;},onStatus:s=>statuses.push(s.status)});
  assert.equal(calls,3);assert.deepEqual(statuses,['waiting-for-worker-lease','completed']);
});
test('a live competing worker is never taken over; registration wait is bounded',async()=>{
  let clock=0;const statuses=[];
  await assert.rejects(runPaperStudyWorker({signal:new AbortController().signal,runtime:{async runOnce(){throw active();}},registrationWaitMs:1000,
    now:()=>clock,wait:async ms=>{clock+=ms;},onStatus:s=>statuses.push(s.status)}),{code:'PAPER_STUDY_WORKER_REGISTRATION_TIMEOUT'});
  assert.equal(clock,1000);assert.deepEqual(statuses,['waiting-for-worker-lease']);
});
test('cancelling registration wait exits and unexpected failures stop immediately',async()=>{
  const controller=new AbortController();let calls=0;
  await runPaperStudyWorker({signal:controller.signal,runtime:{async runOnce(){calls++;throw active();}},wait:async()=>{controller.abort();throw Error('aborted');}});
  assert.equal(calls,1);
  await assert.rejects(runPaperStudyWorker({signal:new AbortController().signal,runtime:{async runOnce(){throw Error('unexpected');}}}),/unexpected/);
});
