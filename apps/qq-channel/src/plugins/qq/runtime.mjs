import {readFile} from 'node:fs/promises';
import {QQRepository} from '../../repository.mjs';
import {QQService,createQQProvider} from '../../service.mjs';
import {OneBotGateway} from '../../onebot.mjs';
import {QQAgentBridge,createQQAgentClient} from '../../agent-bridge.mjs';
import {NapCatControl} from '../../napcat-control.mjs';
import {QQControlStore} from '../../control-store.mjs';
import {startQQControlServer} from '../../control-server.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
// A trusted channel adapter. It owns no Agent key, model budget, login volume or database pool.
export function createQQChannelRuntime({config,pool,managed=false,useAgent=false,env=process.env,log=()=>{},assertAvailable=()=>{},binding={id:'mooyu.qq',version:'1.0.0'},repository=null,client=null,provider=null,channelSecret=null,gatewayFactory=(c,o)=>new OneBotGateway(c,o),napcatFactory=o=>new NapCatControl(o),controlFactory=startQQControlServer}={}){
 if(!config||!pool||typeof managed!=='boolean'||typeof useAgent!=='boolean')fail('QQ_PLUGIN_CONFIG_REQUIRED');
 if(useAgent&&!managed)fail('QQ_AGENT_MANAGED_CHANNEL_REQUIRED');
 repository??=new QQRepository(pool,config);
 const controller=new AbortController();let service,gateway,napcat,control,starting=null,started=false,closed=false;
 const available=()=>{assertAvailable();if(closed||controller.signal.aborted)fail('QQ_CHANNEL_RUNTIME_STOPPED');};
 const receive=async event=>{available();if(!started)fail('QQ_CHANNEL_NOT_STARTED');return service.receive(event);};
 const stop=()=>{controller.abort();service?.stop();};
 const close=async()=>{if(closed)return;closed=true;stop();const results=await Promise.allSettled([control?.close(),gateway?.stop()]);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;};
 const start=async()=>{
  available();if(started)return;if(starting)return starting;
  starting=(async()=>{try{
   if(managed)await repository.enableControl();await repository.check();available();
   const secret=managed?(channelSecret??await readFile(env.QQ_ADMIN_SECRET_FILE,'utf8')).trim():null;
   let bridge=null;if(useAgent){await repository.enableAgentBridge();bridge=new QQAgentBridge({repository,client:client??createQQAgentClient({url:env.QQ_AGENT_API_URL??'http://api:3090',secret,agentId:env.QQ_ADMIN_AGENT_USER_ID})});}
   service=new QQService({config,repository,bridge,provider:useAgent?null:provider??createQQProvider({apiKey:env.DEEPSEEK_API_KEY,model:config.model}),log});
   gateway=gatewayFactory(config,{receive,log});service.gateway=gateway;
   available();const address=await gateway.start();available();started=true;
   log({event:'listening',host:address.address,port:address.port,plugin:{...binding},paperEnabled:false});
   if(managed){
    napcat=napcatFactory({token:env.QQ_NAPCAT_TOKEN,accessToken:config.accessToken});
    service.readiness=current=>napcat.readyGroup===current.groupId;
    control=await controlFactory({secret,agentUserId:env.QQ_ADMIN_AGENT_USER_ID,store:new QQControlStore(repository),napcat,gateway});available();
    log({event:'control-listening',port:control.address.port,plugin:{...binding}});
   }
  }catch(error){await close().catch(()=>{});throw error;}})();return starting;
 };
 const tick=async()=>{if(controller.signal.aborted)return {idle:true};available();if(!started)fail('QQ_CHANNEL_NOT_STARTED');if(napcat)await napcat.maintain(await repository.check(),()=>gateway.connected());available();return service.tick();};
 const pause=ms=>new Promise(resolve=>{const timer=setTimeout(done,ms);function done(){clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();}controller.signal.addEventListener('abort',done,{once:true});if(controller.signal.aborted)done();});
 const run=async()=>{
  if(!started)await start();let failures=0,lastError=null,lastLogged=0;
  while(!controller.signal.aborted&&!service.controller.signal.aborted){
   try{await tick();failures=0;lastError=null;}catch(error){
    failures++;const code=/^[A-Z0-9_]{1,80}$/u.test(error.code??'')?error.code:'QQ_DATABASE_OR_WORKER_UNAVAILABLE';
    if(code!==lastError||Date.now()-lastLogged>60000){log({event:'worker-waiting',code,plugin:{...binding}});lastLogged=Date.now();lastError=code;}
   }
   await pause(Math.min(30000,1000*2**Math.min(failures,5)));
  }
 };
 return {start,run,receive,tick,stop,close,status:()=>({plugin:{...binding},started,stopped:controller.signal.aborted,managed,executionMode:useAgent?'agent':'legacy',paperEnabled:false})};
}
