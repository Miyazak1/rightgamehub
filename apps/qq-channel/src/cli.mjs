import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {parseConfig} from './config.mjs';
import {QQRepository} from './repository.mjs';
import {createQQChannelPluginHost} from './plugin-catalog.mjs';
const log=value=>console.log(JSON.stringify({at:new Date().toISOString(),...value}));
let pool,runtime;
try{
 const [file,command='--run',messageId,disposition,remoteId]=process.argv.slice(2);
 if(!file||!['--init','--run','--status','--resolve'].includes(command))throw Object.assign(Error(),{code:'QQ_USAGE_CONFIG_INIT_RUN_STATUS_RESOLVE'});
 const config=parseConfig(JSON.parse(await readFile(file,'utf8')),process.env),managed=process.env.QQ_ADMIN_ENABLED==='true';
 if(process.env.QQ_AGENT_INTERACTIONS_ENABLED!=null&&!['true','false'].includes(process.env.QQ_AGENT_INTERACTIONS_ENABLED))throw Object.assign(Error(),{code:'QQ_AGENT_ENABLE_FLAG_INVALID'});
 const useAgent=process.env.QQ_AGENT_INTERACTIONS_ENABLED==='true';
 if(useAgent&&!managed)throw Object.assign(Error(),{code:'QQ_AGENT_MANAGED_CHANNEL_REQUIRED'});
 if(managed&&config.deployment!=='server')throw Object.assign(Error(),{code:'QQ_CONTROL_SERVER_ONLY'});
 const host=command==='--run'?createQQChannelPluginHost():null;
 if(command==='--run'&&((!config.enabled&&!managed)||!host.status().some(p=>p.id==='mooyu.qq'&&p.enabled))){log({event:'disabled',plugin:'mooyu.qq',paperEnabled:false});}
 else{
  pool=new pg.Pool({connectionString:config.databaseUrl,max:5,connectionTimeoutMillis:3000,query_timeout:10000,application_name:'mooyu-qq-local'});
  pool.on('error',()=>log({event:'database-error',code:'QQ_DATABASE_UNAVAILABLE'}));
  if(command==='--run'){
   runtime=await host.bindChannel({id:'mooyu.qq',version:'1.0.0'},{config,pool,managed,useAgent,env:process.env,log});
   const stop=()=>runtime.stop();process.once('SIGINT',stop);process.once('SIGTERM',stop);
   try{await runtime.start();await runtime.run();}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  }else{
   const repository=new QQRepository(pool,config);if(managed&&command!=='--init')repository.control=true;
   if(command==='--init'){
    const result=await repository.initialize();if(result.busy)throw Object.assign(Error(),{code:'QQ_WORKER_BUSY'});log({event:'initialized',...result});
   }else if(command==='--resolve'){
    if(!['--sent','--not-sent'].includes(disposition))throw Object.assign(Error(),{code:'QQ_REVIEW_INPUT_INVALID'});
    const result=await repository.resolve(messageId,{sent:disposition==='--sent',remoteId});if(result.busy)throw Object.assign(Error(),{code:'QQ_WORKER_BUSY'});log({event:'review',...result});
   }else log({event:'status',...await repository.status(),paperEnabled:false});
  }
 }
}catch(error){log({event:'stopped',code:/^[A-Z0-9_]{1,80}$/u.test(error.code??'')?error.code:'QQ_START_FAILED'});process.exitCode=1;}
finally{try{await runtime?.close();}catch(error){log({event:'channel-close-failed',code:/^[A-Z0-9_]{1,80}$/u.test(error.code??'')?error.code:'QQ_CHANNEL_CLOSE_FAILED'});process.exitCode=1;}finally{await pool?.end();}}
