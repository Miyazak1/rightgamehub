import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {parseConfig} from './config.mjs';
import {QQRepository} from './repository.mjs';
import {OneBotGateway} from './onebot.mjs';
import {QQService,createQQProvider} from './service.mjs';
import {QQControlStore} from './control-store.mjs';
import {NapCatControl} from './napcat-control.mjs';
import {startQQControlServer} from './control-server.mjs';
import {QQAgentBridge,createQQAgentClient} from './agent-bridge.mjs';
const log=value=>console.log(JSON.stringify({at:new Date().toISOString(),...value}));
let pool,gateway,service,controlServer;
try{
  const [file,command='--run',messageId,disposition,remoteId]=process.argv.slice(2);
  if(!file||!['--init','--run','--status','--resolve'].includes(command))throw Object.assign(Error(),{code:'QQ_USAGE_CONFIG_INIT_RUN_STATUS_RESOLVE'});
  const config=parseConfig(JSON.parse(await readFile(file,'utf8')),process.env);
  const managed=process.env.QQ_ADMIN_ENABLED==='true';
  if(process.env.QQ_AGENT_INTERACTIONS_ENABLED!=null&&!['true','false'].includes(process.env.QQ_AGENT_INTERACTIONS_ENABLED))throw Object.assign(Error(),{code:'QQ_AGENT_ENABLE_FLAG_INVALID'});
  const useAgent=process.env.QQ_AGENT_INTERACTIONS_ENABLED==='true';
  if(useAgent&&!managed)throw Object.assign(Error(),{code:'QQ_AGENT_MANAGED_CHANNEL_REQUIRED'});
  if(managed&&config.deployment!=='server')throw Object.assign(Error(),{code:'QQ_CONTROL_SERVER_ONLY'});
  if(command==='--run'&&!config.enabled&&!managed){log({event:'disabled',paperEnabled:false});process.exitCode=0;}
  else{
    pool=new pg.Pool({connectionString:config.databaseUrl,max:5,connectionTimeoutMillis:3000,query_timeout:10000,application_name:'mooyu-qq-local'});
    pool.on('error',()=>log({event:'database-error',code:'QQ_DATABASE_UNAVAILABLE'}));
    const repository=new QQRepository(pool,config);
    if(managed&&command==='--run')await repository.enableControl();
    else if(managed&&command!=='--init')repository.control=true;
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
      let bridge=null;
      if(useAgent){await repository.enableAgentBridge();bridge=new QQAgentBridge({repository,client:createQQAgentClient({url:process.env.QQ_AGENT_API_URL??'http://api:3090',secret:(await readFile(process.env.QQ_ADMIN_SECRET_FILE,'utf8')).trim(),agentId:process.env.QQ_ADMIN_AGENT_USER_ID})});}
      service=new QQService({config,repository,bridge,provider:useAgent?null:createQQProvider({apiKey:process.env.DEEPSEEK_API_KEY,model:config.model}),log});
      gateway=new OneBotGateway(config,{receive:event=>service.receive(event),log});service.gateway=gateway;
      const address=await gateway.start();log({event:'listening',host:address.address,port:address.port,paperEnabled:false});
      let napcat;
      if(managed){
        napcat=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:config.accessToken});
        service.readiness=current=>napcat.readyGroup===current.groupId;
        const secret=await readFile(process.env.QQ_ADMIN_SECRET_FILE,'utf8');
        controlServer=await startQQControlServer({secret:secret.trim(),agentUserId:process.env.QQ_ADMIN_AGENT_USER_ID,store:new QQControlStore(repository),napcat,gateway});
        log({event:'control-listening',port:controlServer.address.port});
      }
      const stop=()=>service.stop();process.once('SIGINT',stop);process.once('SIGTERM',stop);
      let failures=0,lastError=null,lastLogged=0;
      try{while(!service.controller.signal.aborted){
        try{if(napcat)await napcat.maintain(await repository.check(),gateway.connected());await service.tick();failures=0;lastError=null;}catch(error){
          failures++;const code=/^[A-Z0-9_]{1,80}$/u.test(error.code??'')?error.code:'QQ_DATABASE_OR_WORKER_UNAVAILABLE';
          if(code!==lastError||Date.now()-lastLogged>60000){log({event:'worker-waiting',code});lastLogged=Date.now();lastError=code;}
        }
        await new Promise(resolve=>{const timer=setTimeout(done,Math.min(30000,1000*2**Math.min(failures,5)));function done(){clearTimeout(timer);service.controller.signal.removeEventListener('abort',done);resolve();}service.controller.signal.addEventListener('abort',done,{once:true});if(service.controller.signal.aborted)done();});
      }}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
    }
  }
}catch(error){log({event:'stopped',code:/^[A-Z0-9_]{1,80}$/u.test(error.code??'')?error.code:'QQ_START_FAILED'});process.exitCode=1;}
finally{service?.stop();await controlServer?.close();await gateway?.stop();await pool?.end();}
