import {withTransaction} from './database.mjs';
// Best-effort, bounded, privacy-preserving aggregation. Save commits never depend on telemetry.
export function createSaveHealthMetrics({pool,clock=()=>new Date(),flushIntervalMs=30000,maxKeys=512}) {
  const buckets=new Map();let timer=null,pending=null,dropped=0,closed=false;
  const bounds=[10,50,100,250,500,1000,3000,10000,60000];
  function observe({workId,channel,operation,code,durationMs}) {
    if(closed||!workId||!['production','preview'].includes(channel))return;
    const hour=new Date(Math.floor(clock().getTime()/3600000)*3600000).toISOString();
    const latency=bounds.find(n=>durationMs<=n)??60001;
    const values=[hour,workId,channel,operation,code,latency],key=JSON.stringify(values);
    if(!buckets.has(key)&&buckets.size>=maxKeys){dropped++;return;}
    const bucket=buckets.get(key)??{values,count:0};bucket.count++;buckets.set(key,bucket);
    if(!timer){timer=setInterval(()=>{void flush();},flushIntervalMs);timer.unref?.();}
  }
  async function flush() {
    if(pending)return pending;
    const batch=[...buckets.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value);buckets.clear();
    if(!batch.length)return;
    pending=(async()=>{
      try {
        // One atomic upsert for the bounded batch. Ambiguous commit failures are not replayed.
        const params=[],tuples=batch.map(b=>{const start=params.length;params.push(...b.values,b.count);return '('+Array.from({length:7},(_,i)=>'$'+(start+i+1)).join(',')+')';});
        await withTransaction(pool,async tx=>{
          await tx.query("SET LOCAL statement_timeout='5s'");
          await tx.query("SET LOCAL lock_timeout='500ms'");
          await tx.query({text:'INSERT INTO game_save_health_buckets(hour,work_id,channel,operation,code,latency_bucket,count) VALUES '+tuples.join(',')+
          ' ON CONFLICT(hour,work_id,channel,operation,code,latency_bucket) DO UPDATE SET count=game_save_health_buckets.count+EXCLUDED.count',values:params});
        await tx.query({text:"DELETE FROM game_save_health_buckets WHERE ctid IN (SELECT ctid FROM game_save_health_buckets WHERE hour<now()-interval '7 days' LIMIT 1000)"});
        });
      } catch {dropped+=batch.reduce((n,b)=>n+b.count,0);}
      finally {pending=null;}
    })();
    return pending;
  }
  return {observe,flush,status:()=>({bufferedKeys:buckets.size,dropped}),close:async()=>{closed=true;if(timer)clearInterval(timer);timer=null;if(pending)await pending;await flush();}};
}
