// Durable, bounded host recovery policy. No Docker, credentials or native login
// calls here. Unknown observations and group-only faults never authorize restart.
export function decideQQRecovery(prior,input,now=Date.now()){
 const state=structuredClone(prior??{version:1,attempts:[],incident:null,stableSince:null,manualRequired:false});
 if(!Number.isSafeInteger(now)||state.version!==1||!Array.isArray(state.attempts)||state.attempts.some(t=>!Number.isSafeInteger(t)||t<0||t>now)||typeof state.manualRequired!=='boolean'||state.lastAt!=null&&!Number.isSafeInteger(state.lastAt)||state.incident!=null&&(!Number.isSafeInteger(state.incident.firstAt)||!Number.isSafeInteger(state.incident.samples)||state.incident.samples<0))throw Error('QQ_RECOVERY_STATE_INVALID');
 const clockBack=state.lastAt!=null&&now<state.lastAt;state.lastAt=now;
 const r=input?.runtime,age=now-Date.parse(r?.verifiedAt),fresh=r?.available===true&&age>=0&&age<=30000;
 const wait=reason=>({action:'wait',reason,state});
 if(clockBack){state.manualRequired=true;return wait('clock-changed');}
 if(state.manualRequired)return wait('manual-review-required');
 if(!fresh){state.stableSince=null;state.incident=null;return wait('observation-unavailable');}
 if(r.loggedIn===true){
  state.incident=null;
  if(r.coreReady&&r.accountMatches&&r.groupReady&&r.connected){state.stableSince??=now;if(now-state.stableSince>=600000)state.incidentHandled=false;}
  else state.stableSince=null;
  return wait(r.groupReady?'native-session-present':'group-check-only');
 }
 state.stableSince=null;
 if(r.restartRequired!==true||!['offline','failed','reconnecting'].includes(r.phase)){state.incident=null;return wait('waiting-login-or-native-recovery');}
 if(state.incidentHandled)return wait('incident-already-handled');
 const sample=r.checkedAt;
 if(typeof sample!=='string'||!Number.isFinite(Date.parse(sample))||Date.parse(sample)>now||now-Date.parse(sample)>30000)return wait('sample-not-fresh');
 state.incident??={firstAt:now,samples:0,lastSample:null};
 if(state.incident.lastSample===null||Date.parse(sample)>Date.parse(state.incident.lastSample)){state.incident.samples++;state.incident.lastSample=sample;}
 if(state.incident.samples<3||now-state.incident.firstAt<60000)return wait('confirming-native-failure');
 const attempts=state.attempts.filter(t=>now-t<86400000);
 if(attempts.length>=2)return wait('daily-restart-limit');
 if(attempts.length&&now-attempts.at(-1)<900000)return wait('restart-cooldown');
 return {action:'restart-same-gateway',reason:'confirmed-native-recovery-failure',state};
}
export function reserveQQRecovery(state,now=Date.now()){
 return {...state,attempts:[...state.attempts.filter(t=>now-t<86400000),now],incidentHandled:true,manualRequired:true,lastAt:now};
}
export async function executeQQRecovery({state,now=Date.now(),io}){
 // Durable reservation precedes EVERY side effect. A crash cannot reset the
 // circuit breaker or cause the next timer tick to repeat the restart.
 const reserved=reserveQQRecovery(state,now);await io.save(reserved);
 let stopIssued=false,started=false;
 try{
  await io.guard();await io.backup(false);await io.guard();
  const latest=await io.probe();
  if(latest.runtime?.available!==true||latest.runtime?.loggedIn!==false||latest.runtime?.restartRequired!==true)throw Error('QQ_RECOVERY_NO_LONGER_REQUIRED');
  await io.assertNoSending();reserved.lastOutcome='stop-requested';await io.save(reserved);stopIssued=true;await io.stop();
  try{await io.backup(true);}finally{
   // Backup validation failure after stop must not leave the gateway stopped.
   await io.guardStopped();reserved.lastOutcome='start-requested';await io.save(reserved);await io.start();started=true;
  }
  await io.verify();const complete={...reserved,manualRequired:false,lastOutcome:'gateway-started'};await io.save(complete);return complete;
 }catch(error){await io.save({...reserved,lastOutcome:stopIssued&&!started?'gateway-start-required':'review-required'});throw error;}
}
export async function resumeQQStart({state,io}){
 if(!state?.manualRequired||!['stop-requested','start-requested','gateway-start-required'].includes(state.lastOutcome)||state.compensationReserved)throw Error('QQ_START_COMPENSATION_REFUSED');
 const next={...state,compensationReserved:true};await io.save(next);
 await io.guardStopped();await io.verifyWarmBackup();await io.start();await io.verify();
 const done={...next,lastOutcome:'gateway-started',manualRequired:false};await io.save(done);return done;
}
