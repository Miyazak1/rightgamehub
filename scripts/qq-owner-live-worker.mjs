// Isolated, opt-in real QQ transport acceptance. No production database/API or
// model key is loaded. Only a fixed, fresh test marker reaches admission.
import fs from 'node:fs';import {createRequire} from 'node:module';
import {parseConfig} from '../apps/qq-channel/src/config.mjs';import {QQRepository} from '../apps/qq-channel/src/repository.mjs';
import {createQQChannelPluginHost} from '../apps/qq-channel/src/plugin-catalog.mjs';import {OneBotGateway} from '../apps/qq-channel/src/onebot.mjs';
const s=JSON.parse(fs.readFileSync('/config/worker.private.json','utf8'));
if(s.lab!==true||s.marker!=='本地QQ验收20261127'||s.config.botId!=='3922489710'||!/^qq_owner_local_[a-f0-9]{20}$/.test(s.labId??''))throw Error('LOCAL_TEST_SCOPE_REQUIRED');
const {Pool}=createRequire(new URL('../apps/qq-channel/package.json',import.meta.url))('pg'),config=parseConfig(s.config,s.env);
const pool=new Pool({connectionString:config.databaseUrl,max:5,connectionTimeoutMillis:3000,query_timeout:10000}),repository=new QQRepository(pool,config);
const host=createQQChannelPluginHost({env:s.env});let runtime;
try{
 // Bootstrap only the fresh lab database. A restarted managed worker must use
 // its existing policy and history, never reinitialize or reset them.
 const initialized=(await pool.query("SELECT to_regclass('mooyu_qq.settings') IS NOT NULL AS present")).rows[0].present;
 if(!initialized)await repository.initialize();
 runtime=await host.bindChannel({id:'mooyu.qq',version:'1.0.0'},{config,pool,repository,managed:true,useAgent:false,env:s.env,channelSecret:s.secret,
 provider:async()=>({reply:'本地验收收到20261127',usage:{inputTokens:3,outputTokens:3},providerRequestId:'isolated-fixed-response'}),
 gatewayFactory:(cfg,options)=>new OneBotGateway(cfg,{...options,receive:async event=>{
  const text=Array.isArray(event?.message)?event.message.filter(p=>p?.type==='text').map(p=>typeof p.data?.text==='string'?p.data.text:'').join(''):'';
  if(!text.includes(s.marker))return {accepted:false,code:'LOCAL_TEST_SCOPE_ONLY'};
  return options.receive(event);
 }}),log:v=>{if(['admission','admission-failed','worker-waiting','gateway-connected','gateway-disconnected'].includes(v.event))console.log(JSON.stringify({at:new Date().toISOString(),event:v.event,code:v.code??null}));}
 });
 await runtime.start();const stop=()=>runtime.stop();process.once('SIGTERM',stop);process.once('SIGINT',stop);await runtime.run();
}finally{await runtime?.close();await pool.end();}
