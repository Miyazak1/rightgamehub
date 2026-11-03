import {desktopBusinessTestConfig} from './desktop-business-test-policy.mjs';
import {loadConfig} from './config.mjs';
import {createDatabase} from './database.mjs';
import {prepareDesktopPaperStudy,desktopPaperAgent,desktopPaperWorkerReady} from './desktop-paper-study.mjs';
import {createPaperStudyDurableRuntime} from './paper-study-durable-runtime.mjs';
import {runPaperStudyWorker} from './paper-study-worker-loop.mjs';
import fs from 'node:fs';

const settings=desktopBusinessTestConfig(process.env);
if(!settings.paperStudyEnabled)throw Error('DESKTOP_PAPER_DISABLED');
if(process.argv.length!==3||!['--prepare','--worker','--health'].includes(process.argv[2]))throw Error('DESKTOP_PAPER_COMMAND_INVALID');
const database=createDatabase(loadConfig(settings.env));let runtime;
const marker='/tmp/mooyu-desktop-paper-worker.json';let marked=false;
try{
  if(process.argv[2]==='--prepare')console.log(JSON.stringify(await prepareDesktopPaperStudy(database.pool)));
  else if(process.argv[2]==='--health'){
    let instanceId;try{instanceId=JSON.parse(fs.readFileSync(marker,'utf8')).instanceId;}catch{}
    process.exitCode=instanceId&&await desktopPaperWorkerReady(database.pool,instanceId)?0:1;
  }
  else{
    const controller=new AbortController();for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>controller.abort());
    runtime=createPaperStudyDurableRuntime({pool:database.pool,redisUrl:settings.env.REDIS_URL,executionAgentUserId:await desktopPaperAgent(database.pool),workerId:'desktop-paper-study-worker'});
    fs.rmSync(marker,{force:true});
    await runtime.initialize();
    await runPaperStudyWorker({runtime,signal:controller.signal,onStatus:state=>{
      if(state.status==='waiting-for-worker-lease')console.log(JSON.stringify(state));
      else if(!marked){fs.writeFileSync(marker,JSON.stringify({instanceId:runtime.worker.instanceId}),{mode:0o600});marked=true;}
    }});
  }
}finally{if(marked)fs.rmSync(marker,{force:true});await runtime?.close();await database.close();}
