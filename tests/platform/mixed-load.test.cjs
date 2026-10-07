const test=require('node:test'),assert=require('node:assert/strict');

test('realtime performance metrics publish a complete window and release monitoring resources',async()=>{
  const {createRealtimePerformanceMetrics}=await import('../../apps/realtime/src/performance-metrics.mjs');
  let enabled=0,disabled=0,resets=0;
  const histogram={count:2,max:90000000,enable:()=>enabled++,disable:()=>disabled++,reset:()=>resets++,percentile:p=>{assert.equal(p,99);return 50000000;}};
  const metrics=createRealtimePerformanceMetrics({histogram,clock:()=>100000});
  try{
    assert.match(metrics.text(),/sample_timestamp_seconds 0/);metrics.collect();
    assert.match(metrics.text(),/delay_p99_seconds 0.05/);assert.match(metrics.text(),/delay_max_seconds 0.09/);
    assert.match(metrics.text(),/sample_timestamp_seconds 100/);
    histogram.count=0;metrics.collect();assert.match(metrics.text(),/sample_timestamp_seconds 100/);
  }finally{metrics.close();}
  assert.equal(enabled,1);assert.equal(disabled,1);assert.equal(resets,2);
});

test('fixed schedule records missed starts instead of silently reducing offered load',async()=>{
  const {scheduled}=await import('../../scripts/save-mixed-load-support.mjs');
  const r=await scheduled({durationMs:120,periodMs:10,run:()=>new Promise(resolve=>setTimeout(resolve,40))});
  assert.ok(r.missed>0);assert.equal(r.attempts+r.missed,12);assert.deepEqual(r.errors,[]);
});

test('mixed-load gate fails on incomplete or corrupted evidence and never authorizes production',async()=>{
  const {evaluateMixedLoad}=await import('../../scripts/save-mixed-load-gate.mjs');
  const metric={count:30,p95:10,p99:20};
  const phase=name=>({name,missed:0,errors:[],metrics:{save:metric,read:metric,command:metric,heartbeat:metric,fanout:metric},
    observations:Array.from({length:2},()=>({at:new Date(100000).toISOString(),realtime:{gamehub_realtime_event_loop_sample_timestamp_seconds:95,gamehub_realtime_event_loop_delay_p99_seconds:.02}}))});
  const source={smoke:false,thresholds:{saveP95Ms:300,saveP99Ms:1000,readP95Ms:150,readP99Ms:500,commandP95Ms:150,commandP99Ms:500,heartbeatP95Ms:100,heartbeatP99Ms:250,maxWindowLoopP99Ms:100},
    phases:['baseline','mixed','recovery'].map(phase),budget:{cpu:2,memoryBytes:2*1024**3,containers:[{status:'running',cpus:1,memoryBytes:1024}]},
    backups:[{bytes:1,sha256:'a'.repeat(64)},{bytes:1,sha256:'b'.repeat(64)}],finalContainers:Array.from({length:6},()=>({oomKilled:false,restartCount:0})),
    invariants:{a:0,b:0,c:0,d:0,e:0,f:0,g:0},restoredInvariants:{a:0,b:0,c:0,d:0,e:0,f:0,g:0},evidence:{saveReceipts:true,matchCommands:true},restoredAcknowledged:{saves:true,commands:true},
    unexpectedSocketErrors:0,maintenance:[{status:'ok',code:'OK',count:1}],errors:[]};
  const result=evaluateMixedLoad(source);assert.equal(result.localGatePassed,true);assert.equal(result.productionReady,false);
  for(const mutate of [
    r=>r.phases.pop(),r=>r.phases[1].missed++,r=>r.phases[1].errors.push('TIMEOUT'),r=>r.phases[0].metrics.save.p99=2000,
    r=>r.phases[0].observations=[],r=>r.phases[0].observations[0].realtime.gamehub_realtime_event_loop_sample_timestamp_seconds=1,
    r=>r.budget.cpu=3,r=>r.finalContainers[0].oomKilled=true,r=>r.invariants.a=1,r=>r.restoredInvariants={},
    r=>r.restoredAcknowledged.saves=false,r=>r.restoredAcknowledged.commands=false,r=>r.evidence.matchCommands=false,r=>r.evidence.saveReceipts=false,r=>r.maintenance=[],r=>r.backups.pop(),r=>r.errors.push('STOP_FAILED')
  ]){
    const changed=structuredClone(source);mutate(changed);assert.equal(evaluateMixedLoad(changed).localGatePassed,false);
  }
});
