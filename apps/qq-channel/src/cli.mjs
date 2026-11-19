import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {parseConfig} from './config.mjs';
import {QQRepository} from './repository.mjs';
import {OneBotGateway} from './onebot.mjs';
import {QQService,createQQProvider} from './service.mjs';
const log=value=>console.log(JSON.stringify({at:new Date().toISOString(),...value}));
let pool,gateway,service;
try{
  const [file,command='--run',messageId,disposition,remoteId]=process.argv.slice(2);
  if(!file||!['--init','--run','--status','--resolve'].includes(command))throw Object.assign(Error(),{code:'QQ_USAGE_CONFIG_INIT_RUN_STATUS_RESOLVE'});
  const config=parseConfig(JSON.parse(await readFile(file,'utf8')),process.env);
  if(command==='--run'&&!config.enabled){log({event:'disabled',paperEnabled:false});process.exitCode=0;}
  else{
    pool=new pg.Pool({connectionString:config.databaseUrl,max:5,connectionTimeoutMillis:3000,query_timeout:10000,application_name:'mooyu-qq-local'});
    pool.on('error',()=>log({event:'database-error',code:'QQ_DATABASE_UNAVAILABLE'}));
    const repository=new QQRepository(pool,config);
    if(command==='--init'){
      const initialized=await repository.initialize();if(initialized.busy)throw Object.assign(Error(),{code:'QQ_WORKER_BUSY'});
      log({event:'initialized',...initialized});
    }
    else if(command==='--resolve'){
      if(!['--sent','--not-sent'].includes(disposition))throw Object.assign(Error(),{code:'QQ_REVIEW_INPUT_INVALID'});
      const resolved=await repository.resolve(messageId,{sent:disposition==='--sent',remoteId});
      if(resolved.busy)throw Object.assign(Error(),{code:'QQ_WORKER_BUSY'});log({event:'review',...resolved});
    }else if(command==='--status'){
      log({event:'status',...await repository.status(),paperEnabled:false});
    }else{
      await repository.check();
      service=new QQService({config,repository,provider:createQQProvider({apiKey:process.env.DEEPSEEK_API_KEY,model:config.model}),log});
      gateway=new OneBotGateway(config,{receive:event=>service.receive(event),log});service.gateway=gateway;
      const address=await gateway.start();log({event:'listening',host:address.address,port:address.port,paperEnabled:false});
      const stop=()=>service.stop();process.once('SIGINT',stop);process.once('SIGTERM',stop);
      let failures=0,lastError=null,lastLogged=0;
      try{while(!service.controller.signal.aborted){
        try{await service.tick();failures=0;lastError=null;}catch(error){
          failures++;const code=/^[A-Z0-9_]{1,80}$/u.test(error.code??'')?error.code:'QQ_DATABASE_OR_WORKER_UNAVAILABLE';
          if(code!==lastError||Date.now()-lastLogged>60000){log({event:'worker-waiting',code});lastLogged=Date.now();lastError=code;}
        }
        await new Promise(resolve=>{const timer=setTimeout(done,Math.min(30000,1000*2**Math.min(failures,5)));function done(){clearTimeout(timer);service.controller.signal.removeEventListener('abort',done);resolve();}service.controller.signal.addEventListener('abort',done,{once:true});if(service.controller.signal.aborted)done();});
      }}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
    }
  }
}catch(error){log({event:'stopped',code:/^[A-Z0-9_]{1,80}$/u.test(error.code??'')?error.code:'QQ_START_FAILED'});process.exitCode=1;}
finally{service?.stop();await gateway?.stop();await pool?.end();}
