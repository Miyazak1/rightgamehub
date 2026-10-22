import {checkResearcherWorkerHealth,createResearcherWorker,loadResearcherWorkerConfig} from './researcher-worker.mjs';

const config=loadResearcherWorkerConfig();

if(process.argv.includes('--health')){
  try{const health=await checkResearcherWorkerHealth(config);process.stdout.write(`${JSON.stringify({status:'ok',service:'researcher-worker',lastSeenAt:health.lastSeenAt,state:health.state})}\n`);}
  catch(error){process.stderr.write(`${JSON.stringify({status:'error',service:'researcher-worker',code:error.code??'RESEARCHER_WORKER_UNHEALTHY',message:error.message})}\n`);process.exitCode=1;}
}else{
  const worker=createResearcherWorker({config});let stopping=false;
  const stop=()=>{stopping=true;};
  const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  while(!stopping){
    try{const result=await worker.runOnce();if(!result)await pause(config.pollMilliseconds);else if(result.status==='failed')process.stderr.write(`${JSON.stringify({level:'error',service:'researcher-worker',code:result.error?.code??'RESEARCHER_WORKER_FAILED',message:result.error?.message??'Researcher task failed',jobId:result.jobId})}\n`);}
    catch(error){process.stderr.write(`${JSON.stringify({level:'error',service:'researcher-worker',code:error.code??'RESEARCHER_WORKER_FAILED',message:error.message})}\n`);await pause(config.pollMilliseconds);}
  }
}
