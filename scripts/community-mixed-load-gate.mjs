// Local, resource-capped qualification only. It never authorizes deployment.
export function evaluateCommunityLoad(report){
  const checks=[],add=(name,ok)=>checks.push({name,ok:Boolean(ok)});
  add('all three phases',report.phases.map(p=>p.name).join(',')==='baseline,mixed,recovery');
  for(const phase of report.phases){
    add(phase.name+': sustained offered load',phase.missed===0&&phase.errors.length===0);
    for(const kind of ['read','interaction','command','heartbeat',...(phase.name==='mixed'?['image']:[])]){
      const metric=phase.metrics[kind];
      add(phase.name+': '+kind+' samples',metric?.count>=(report.smoke?2:kind==='image'?16:20));
      for(const percentile of ['p95','p99'])add(phase.name+': '+kind+' '+percentile,
        Number.isFinite(metric?.[percentile])&&metric[percentile]>=0&&metric[percentile]<=report.thresholds[kind][percentile]);
    }
    add(phase.name+': fanout',Number.isFinite(phase.metrics.fanout?.p99)&&phase.metrics.fanout.p99<=report.thresholds.command.p99);
    add(phase.name+': loop samples',phase.observations.length>=2&&phase.observations.every(o=>{
      const stamp=o.realtime.gamehub_realtime_event_loop_sample_timestamp_seconds,age=Date.parse(o.at)/1000-stamp;
      return stamp>0&&age>=0&&age<15;
    }));
    add(phase.name+': loop delay',phase.observations.every(o=>Number.isFinite(o.realtime.gamehub_realtime_event_loop_delay_p99_seconds)&&o.realtime.gamehub_realtime_event_loop_delay_p99_seconds*1000<=100));
  }
  const active=report.budget?.containers?.filter(c=>c.status==='running')??[];
  add('CPU and memory bounded',active.length===6&&active.every(c=>c.cpus>0&&c.memoryBytes>0)&&report.budget.cpu<=2.001&&report.budget.memoryBytes<=4*1024**3);
  add('no OOM/restarts',report.finalContainers?.length===7&&report.finalContainers.every(c=>!c.oomKilled&&c.restartCount===0));
  add('database invariants',Object.keys(report.invariants??{}).length>=5&&Object.values(report.invariants).every(value=>value===0));
  add('cloud saves disabled',report.cloudSavesDisabled===true);
  add('ACK identities persisted',report.matchCommandsVerified===true);
  add('image reads checked',report.imageReads>0);
  add('sockets and runner clean',report.unexpectedSocketErrors===0&&report.errors.length===0);
  return {checks,localGatePassed:checks.every(c=>c.ok),productionReady:false,qualification:report.smoke?'smoke-only':'local-partial'};
}
