export function createAgentInteractionWorker({repository,service,conversation,github,agentId,log=()=>{},pollMilliseconds=1000}){
 const shutdown=new AbortController();let stopping=false;const active=new Set();
 async function tick(kind){
  const row=await repository.claim(agentId,kind);if(!row)return {idle:true};
  const owner=new AbortController(),relay=()=>owner.abort(shutdown.signal.reason);if(shutdown.signal.aborted)relay();else shutdown.signal.addEventListener('abort',relay,{once:true});active.add(owner);
  let renewing=false;const timer=setInterval(async()=>{if(renewing)return;renewing=true;try{await service.authorize(row.origin_json,{invoke:row.kind==='github-article'});await repository.heartbeat(row);}catch(error){owner.abort(error);}finally{renewing=false;}},30000);timer.unref?.();
  try{
   await service.authorize(row.origin_json,{invoke:row.kind==='github-article'});
   const result=await (row.kind==='message'?conversation:github)(row,{signal:owner.signal});
   await repository.settle(row,{result});log({event:'interaction-completed',id:row.id,kind:row.kind});return {completed:true,id:row.id};
  }catch(error){
   const code=/^[A-Z0-9_]{1,120}$/u.test(error?.code??'')?error.code:'AGENT_INTERACTION_EXECUTION_FAILED';
   const retry=error.retryable===true||stopping||['ECONNRESET','ECONNREFUSED','57P01','08006'].includes(code);
   await repository.settle(row,{errorCode:code,retry,needsReview:error.uncertain===true,delaySeconds:row.kind==='message'?5:60}).catch(()=>{});
   log({event:'interaction-deferred',id:row.id,kind:row.kind,code});return {completed:false,id:row.id,code};
  }finally{clearInterval(timer);shutdown.signal.removeEventListener('abort',relay);active.delete(owner);}
 }
 const pause=()=>new Promise(resolve=>{const timer=setTimeout(done,pollMilliseconds);function done(){clearTimeout(timer);shutdown.signal.removeEventListener('abort',done);resolve();}shutdown.signal.addEventListener('abort',done,{once:true});if(stopping)done();});
 async function loop(kind){while(!stopping){try{await tick(kind);}catch(error){log({event:'interaction-worker-waiting',code:/^[A-Z0-9_]{1,120}$/u.test(error?.code??'')?error.code:'AGENT_INTERACTION_STORAGE_UNAVAILABLE'});}if(!stopping)await pause();}}
 return {tick,run:()=>Promise.all([loop('message'),loop('task')]),stop:()=>{stopping=true;shutdown.abort(Object.assign(new Error('AGENT_INTERACTION_INTERRUPTED'),{code:'AGENT_INTERACTION_INTERRUPTED'}));}};
}
