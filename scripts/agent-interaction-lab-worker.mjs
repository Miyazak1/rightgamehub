// Runs only in the isolated lab container. Uses production QQ transport classes.
import {readFile,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {parseConfig} from '../apps/qq-channel/src/config.mjs';
import {QQRepository} from '../apps/qq-channel/src/repository.mjs';
import {QQAgentBridge,createQQAgentClient} from '../apps/qq-channel/src/agent-bridge.mjs';
import {QQService} from '../apps/qq-channel/src/service.mjs';
import {OneBotGateway} from '../apps/qq-channel/src/onebot.mjs';
import {QQControlStore} from '../apps/qq-channel/src/control-store.mjs';
import {NapCatControl} from '../apps/qq-channel/src/napcat-control.mjs';
import {startQQControlServer} from '../apps/qq-channel/src/control-server.mjs';
const settings=JSON.parse(await readFile('/config/worker.private.json','utf8'));
const pg=createRequire(new URL('../apps/qq-channel/package.json',import.meta.url))('pg');
if(settings.lab!==true)throw Error('ISOLATION_REQUIRED');
const log=value=>console.log(JSON.stringify(value)),config=parseConfig(settings.config,settings.env),pool=new pg.Pool({connectionString:config.databaseUrl}),repository=new QQRepository(pool,config);
const exists=await pool.query("SELECT to_regclass('mooyu_qq.settings') AS name");
if(!exists.rows[0].name)await repository.initialize();
await repository.enableControl();await repository.enableAgentBridge();
const bridge=new QQAgentBridge({repository,client:createQQAgentClient({url:'http://api:3090',secret:settings.secret,agentId:settings.agentId})});
const service=new QQService({config,repository,bridge,log}),gateway=new OneBotGateway(config,{receive:event=>service.receive(event),log});service.gateway=gateway;
const napcat=new NapCatControl({token:settings.gatewayToken,accessToken:config.accessToken,workerUrl:'ws://interaction-worker:6700/onebot/v11'});
service.readiness=current=>napcat.readyGroup===current.groupId;
const control=await startQQControlServer({secret:settings.secret,agentUserId:settings.agentId,store:new QQControlStore(repository),napcat,gateway});
await gateway.start();let stopping=false;process.once('SIGTERM',()=>{stopping=true;service.stop();});process.once('SIGINT',()=>{stopping=true;service.stop();});
try{while(!stopping){try{const current=await repository.check(),active=await access('/config/activation/ready').then(()=>true,()=>false);if(active)await napcat.maintain(current,gateway.connected());else await napcat.inspect(current);await service.tick();}catch(error){log({event:'lab-worker-waiting',code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'LAB_WORKER_UNAVAILABLE'});}await new Promise(r=>setTimeout(r,1000));}}
finally{service.stop();await control.close();await gateway.stop();await pool.end();}
