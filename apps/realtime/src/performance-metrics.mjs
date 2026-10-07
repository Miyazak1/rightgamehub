import {monitorEventLoopDelay} from 'node:perf_hooks';

// The most recent complete five-second window, not a process-lifetime percentile.
export function createRealtimePerformanceMetrics({intervalMs=5000,histogram=monitorEventLoopDelay({resolution:20}),clock=Date.now}={}){
  let sample={p99:0,max:0,at:0};histogram.enable();
  const collect=()=>{
    if(histogram.count>0)sample={p99:histogram.percentile(99)/1e9,max:histogram.max/1e9,at:clock()/1000};
    histogram.reset();
  };
  const timer=setInterval(collect,intervalMs);timer.unref?.();
  return {
    collect,
    text:()=>[
      '# TYPE gamehub_realtime_event_loop_delay_p99_seconds gauge',
      'gamehub_realtime_event_loop_delay_p99_seconds '+sample.p99,
      '# TYPE gamehub_realtime_event_loop_delay_max_seconds gauge',
      'gamehub_realtime_event_loop_delay_max_seconds '+sample.max,
      '# TYPE gamehub_realtime_event_loop_sample_timestamp_seconds gauge',
      'gamehub_realtime_event_loop_sample_timestamp_seconds '+sample.at,
      '# TYPE gamehub_realtime_process_rss_bytes gauge',
      'gamehub_realtime_process_rss_bytes '+process.memoryUsage().rss,
    ].join('\n'),
    close(){clearInterval(timer);histogram.disable();},
  };
}
