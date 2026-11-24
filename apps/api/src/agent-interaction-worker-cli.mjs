import {createRuntime} from './runtime.mjs';
import {createAgentInteractionRuntime} from './agent-interaction-runtime.mjs';
let application,execution;
const stop=()=>execution?.worker.stop();
try{
 application=await createRuntime();
 if(!(await application.migrations.status()).ready)throw Object.assign(new Error('AGENT_INTERACTION_MIGRATIONS_REQUIRED'),{code:'AGENT_INTERACTION_MIGRATIONS_REQUIRED'});
 execution=createAgentInteractionRuntime({pool:application.database.pool,service:application.agentInteractionService,
  practiceService:application.practiceService,platformTools:application.platformAgentTools,
  log:event=>process.stdout.write(JSON.stringify({service:'agent-interactions',...event})+'\n')});
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 await execution.worker.run();
}catch(error){process.stderr.write(JSON.stringify({service:'agent-interactions',code:/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'AGENT_INTERACTION_WORKER_FAILED'})+'\n');process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await execution?.close();await application?.app.close();}
