// Real channel plugin with the existing isolated lab's credentials/network and telemetry only.
import {readFile,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {parseConfig} from '../apps/qq-channel/src/config.mjs';
import {QQRepository} from '../apps/qq-channel/src/repository.mjs';
import {OneBotGateway} from '../apps/qq-channel/src/onebot.mjs';
import {NapCatControl} from '../apps/qq-channel/src/napcat-control.mjs';
import {startQQControlServer} from '../apps/qq-channel/src/control-server.mjs';
import {createQQChannelPluginHost} from '../apps/qq-channel/src/plugin-catalog.mjs';
const settings=JSON.parse(await readFile('/config/worker.private.json','utf8'));
if(settings.lab!==true)throw Error('ISOLATION_REQUIRED');
const present=file=>access(file).then(()=>true,()=>false);
if(!await present('/config/activation/ready')||await present('/config/activation/hold-task-delivery'))throw Error('LOCAL_LAB_ACTIVATION_REQUIRED');
const pg=createRequire(new URL('../apps/qq-channel/package.json',import.meta.url))('pg'),config=parseConfig(settings.config,settings.env),pool=new pg.Pool({connectionString:config.databaseUrl}),repository=new QQRepository(pool,config);
const ingress={received:0,accepted:0,rejected:0,upgrades:{},lastExpected:null},log=value=>console.log(JSON.stringify(value)),host=createQQChannelPluginHost({env:settings.env});
let runtime,gateway;
try{
 if(!(await pool.query("SELECT to_regclass('mooyu_qq.settings') AS name")).rows[0].name)throw Error('EXISTING_LAB_HISTORY_REQUIRED');
 runtime=await host.bindChannel({id:'mooyu.qq',version:'1.0.0'},{config,pool,repository,managed:true,useAgent:true,channelSecret:settings.secret,env:{...settings.env,QQ_AGENT_API_URL:'http://api:3090',QQ_ADMIN_AGENT_USER_ID:settings.agentId},log,
  gatewayFactory:(current,options)=>gateway=new OneBotGateway(current,{...options,receive:async event=>{
   ingress.received++;if(String(event.group_id)===config.groupId&&String(event.user_id)===settings.config.allowedUsers[0])ingress.lastExpected={postType:event.post_type,messageType:event.message_type,messageId:event.message_id,selfMatches:String(event.self_id)===config.botId,segments:Array.isArray(event.message)?event.message.map(p=>p.type).slice(0,32):typeof event.message};
   const result=await options.receive(event);ingress[result.accepted?'accepted':'rejected']++;return result;
  }}),
  napcatFactory:options=>{const client=new NapCatControl({...options,token:settings.gatewayToken,workerUrl:'ws://interaction-worker:6700/onebot/v11'}),maintain=client.maintain.bind(client);client.maintain=async(...args)=>{if(!await present('/config/activation/ready')||await present('/config/activation/hold-task-delivery'))throw Error('LOCAL_LAB_ACTIVATION_REQUIRED');return maintain(...args);};return client;},
  controlFactory:async options=>{const view=options.store.view.bind(options.store);options.store.view=async()=>({...await view(),ingress,plugins:host.status(),channelRuntime:runtime.status()});return startQQControlServer(options);}
 });
 await runtime.start();
 gateway.server.prependListener('upgrade',req=>{const reason=req.url!=='/onebot/v11'?'path':req.headers.authorization!=='Bearer '+config.accessToken?'authorization':String(req.headers['x-self-id']??'')!==config.botId?'account':gateway.connected()?'occupied':'accepted';ingress.upgrades[reason]=(ingress.upgrades[reason]??0)+1;});
 log({event:'channel-plugin-ready',plugins:host.status(),runtime:runtime.status()});
 const stop=()=>runtime.stop();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{await runtime.run();}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}finally{await runtime?.close();await pool.end();}
