import { createDatabase } from './database.mjs';
import { loadConfig } from './config.mjs';
import { createPaperStudyDurableRuntime } from './paper-study-durable-runtime.mjs';
import { runPaperStudyWorker } from './paper-study-worker-loop.mjs';

const config=loadConfig();
if(!config.paperStudy.workerEnabled)throw Error('PAPER_STUDY_WORKER_DISABLED');
const database=createDatabase(config);
const runtime=createPaperStudyDurableRuntime({pool:database.pool,redisUrl:config.redisUrl,executionAgentUserId:config.paperStudy.executionAgentUserId,
  workerId:process.env.PAPER_STUDY_WORKER_ID??'paper-study-worker'});
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());
try{
  await runtime.initialize();
  await runPaperStudyWorker({runtime,signal:controller.signal,onStatus:state=>{
    if(state.status==='waiting-for-worker-lease')console.log(JSON.stringify({service:'paper-study-worker',...state}));
  }});
}finally{await runtime.close();await database.close();}
