import { setTimeout as delay } from 'node:timers/promises';

// A killed process cannot release its worker registration. Wait for its fenced
// registration to expire; never steal a still-live instance's worker identity.
export async function runPaperStudyWorker({runtime,signal,pollMilliseconds=500,registrationWaitMs=300000,
  now=Date.now,wait=(ms,signal)=>delay(ms,undefined,{signal}),onStatus=()=>{}}) {
  const deadline=now()+registrationWaitMs;
  let registered=false,announced=false;
  while(!signal.aborted){
    try{
      const result=await runtime.runOnce();registered=true;
      onStatus({status:result.status});
    }catch(error){
      if(registered||error.code!=='AGENT_RUNTIME_WORKER_ALREADY_ACTIVE')throw error;
      if(now()>=deadline)throw Object.assign(Error('PAPER_STUDY_WORKER_REGISTRATION_TIMEOUT'),{code:'PAPER_STUDY_WORKER_REGISTRATION_TIMEOUT'});
      if(!announced){announced=true;onStatus({status:'waiting-for-worker-lease'});}
    }
    if(signal.aborted)return;
    try{await wait(registered?pollMilliseconds:Math.min(pollMilliseconds,Math.max(1,deadline-now())),signal);}
    catch(error){if(!signal.aborted)throw error;}
  }
}
