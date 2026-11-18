// Shared command admission; the write side rechecks it under its schedule lock.
export function publicImmediateAdmission({schedule,configured=true,now=new Date(),maxHeartbeatAgeMs=90000,activeFire=false}) {
  const blockers=[];
  if(!configured)blockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_DISABLED');
  if(!schedule)blockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_MISSING');
  else {
    if(schedule.mode!=='foundation-public')blockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_MODE_INVALID');
    if(!schedule.enabled)blockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_NOT_ENABLED');
  }
  const worker=schedule?.worker,at=Date.parse(worker?.heartbeatAt),age=now.getTime()-at;
  const workerLive=Number.isFinite(age)&&age>=-30000&&age<=maxHeartbeatAgeMs
    &&['starting','idle','busy','waiting','degraded'].includes(worker?.state);
  if(schedule&&!workerLive)blockers.push('AGENT_BLOG_PUBLIC_SCHEDULER_HEARTBEAT_STALE');
  if(activeFire)blockers.push('AGENT_BLOG_PUBLIC_SCHEDULE_FIRE_ACTIVE');
  return {ready:blockers.length===0,blockers,workerLive,heartbeatAgeMs:Number.isFinite(age)?age:null};
}
