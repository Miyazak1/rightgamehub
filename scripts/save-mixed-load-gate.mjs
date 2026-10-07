export function evaluateMixedLoad(report){
  const checks=[],thresholds=report.thresholds,add=(name,ok)=>checks.push({name,ok:Boolean(ok)});
  add('three phases present',JSON.stringify(report.phases.map(p=>p.name))===JSON.stringify(['baseline','mixed','recovery']));
  for(const p of report.phases){
    add(p.name+': no errors',p.errors.length===0);add(p.name+': offered load sustained',p.missed===0);
    for(const kind of ['save','read','command','heartbeat']){
      const metric=p.metrics[kind];
      add(p.name+': '+kind+' samples',metric.count>=(report.smoke?2:20));
      for(const percentile of ['p95','p99'])add(p.name+': '+kind+' '+percentile,
        Number.isFinite(metric[percentile])&&metric[percentile]>=0&&metric[percentile]<=thresholds[kind+percentile.replace('p','P')+'Ms']);
    }
    add(p.name+': fan-out p99',Number.isFinite(p.metrics.fanout.p99)&&p.metrics.fanout.p99<=thresholds.commandP99Ms);
    add(p.name+': loop windows present',p.observations.length>=2&&p.observations.every(o=>{
      const age=Date.parse(o.at)/1000-o.realtime.gamehub_realtime_event_loop_sample_timestamp_seconds;
      return o.realtime.gamehub_realtime_event_loop_sample_timestamp_seconds>0&&age>=0&&age<15;
    }));
    add(p.name+': event loop delay',p.observations.every(o=>Number.isFinite(o.realtime.gamehub_realtime_event_loop_delay_p99_seconds)&&o.realtime.gamehub_realtime_event_loop_delay_p99_seconds*1000<=thresholds.maxWindowLoopP99Ms));
  }
  add('budget bounded',report.budget.cpu<=2.001&&report.budget.memoryBytes<=4*1024**3&&report.budget.containers.filter(c=>c.status==='running').every(c=>c.cpus>0&&c.memoryBytes>0));
  add('at least two concurrent backups',report.backups.length>=2&&report.backups.every(b=>b.bytes>0&&b.sha256?.length===64));
  add('no OOM or restarts',report.finalContainers.length>=6&&report.finalContainers.every(c=>!c.oomKilled&&c.restartCount===0));
  add('source invariants',Object.keys(report.invariants??{}).length>=7&&Object.values(report.invariants).every(v=>v===0));
  add('restored invariants',Object.keys(report.restoredInvariants??{}).length>=7&&Object.values(report.restoredInvariants).every(v=>v===0));
  add('backup contains prior acknowledged saves and commands',report.restoredAcknowledged?.saves===true&&report.restoredAcknowledged?.commands===true);
  add('all save receipt identities match',report.evidence?.saveReceipts===true);
  add('all acknowledged match command identities match',report.evidence?.matchCommands===true);
  add('no unexpected socket errors',report.unexpectedSocketErrors===0);
  add('maintenance executed',report.maintenance.some(r=>r.status==='ok'&&r.count>0));
  add('maintenance no integrity alerts',report.maintenance.every(r=>r.code!=='SAVE_INTEGRITY_ALERT'));
  add('runner has no errors',report.errors.length===0);
  return {checks,localGatePassed:checks.every(c=>c.ok),productionReady:false,qualification:report.smoke?'smoke-only':'local-partial'};
}
