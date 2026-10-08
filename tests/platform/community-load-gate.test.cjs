const test=require('node:test'),assert=require('node:assert/strict');
test('community load gate rejects missing evidence, overload, image errors and cloud saves',async()=>{
  const {evaluateCommunityLoad}=await import('../../scripts/community-mixed-load-gate.mjs');
  const metric={count:40,p95:10,p99:20};
  const phase=name=>({name,missed:0,errors:[],metrics:Object.fromEntries(['read','interaction','command','heartbeat','fanout','image'].map(kind=>[kind,metric])),observations:[1,2].map(()=>({at:new Date(100000).toISOString(),realtime:{gamehub_realtime_event_loop_sample_timestamp_seconds:95,gamehub_realtime_event_loop_delay_p99_seconds:.02}}))});
  const source={phases:['baseline','mixed','recovery'].map(phase),thresholds:Object.fromEntries(['read','interaction','command','heartbeat','image'].map(kind=>[kind,{p95:100,p99:200}])),budget:{cpu:2,memoryBytes:2*1024**3,containers:Array.from({length:6},()=>({status:'running',cpus:.2,memoryBytes:100000000}))},finalContainers:Array.from({length:7},()=>({oomKilled:false,restartCount:0})),invariants:{a:0,b:0,c:0,d:0,e:0},cloudSavesDisabled:true,matchCommandsVerified:true,imageReads:10,unexpectedSocketErrors:0,errors:[]};
  assert.equal(evaluateCommunityLoad(source).localGatePassed,true);assert.equal(evaluateCommunityLoad(source).productionReady,false);
  for(const mutate of [
    r=>r.phases.pop(),r=>r.phases[1].missed++,r=>r.phases[1].errors.push('IMAGE_TIMEOUT'),r=>r.phases[1].metrics.image={count:0},
    r=>r.phases[0].metrics.command={count:40,p95:1000,p99:2000},r=>r.phases[1].observations=[],
    r=>r.phases[0].observations[0].realtime.gamehub_realtime_event_loop_sample_timestamp_seconds=1,
    r=>r.budget.cpu=3,r=>r.budget.containers[0].memoryBytes=0,r=>r.finalContainers[0].oomKilled=true,
    r=>r.invariants.a=1,r=>r.invariants={},r=>r.cloudSavesDisabled=false,r=>r.matchCommandsVerified=false,
    r=>r.imageReads=0,r=>r.unexpectedSocketErrors=1,r=>r.errors.push('STOP_FAILED'),
  ]){const changed=structuredClone(source);mutate(changed);assert.equal(evaluateCommunityLoad(changed).localGatePassed,false);}
});
