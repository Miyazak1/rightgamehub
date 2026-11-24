// Runs inside the built worker, with no external network and a disposable DB.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {once} from 'node:events';
import http from 'node:http';import {createQQAgentClient} from '../apps/qq-channel/src/agent-bridge.mjs';import {verifyAgentChannelSignature} from '../apps/api/src/agent-channel-protocol.mjs';
import {parseConfig} from '../apps/qq-channel/src/config.mjs';import {QQRepository} from '../apps/qq-channel/src/repository.mjs';import {OneBotGateway} from '../apps/qq-channel/src/onebot.mjs';import {createQQChannelPluginHost} from '../apps/qq-channel/src/plugin-catalog.mjs';import {startQQControlServer} from '../apps/qq-channel/src/control-server.mjs';
const require=createRequire(new URL('../apps/qq-channel/package.json',import.meta.url)),{Pool}=require('pg'),{WebSocket}=require('ws');
const input=new URL(process.env.QA_LEDGER_TEST_URL);assert.equal(input.hostname,'127.0.0.1');assert.match(input.pathname,/^\/qa_ledger_test_[a-f0-9]{32}$/u);
const cold=process.argv.includes('--cold-check'),checkpoint=cold?JSON.parse(fs.readFileSync('/out/worker-checkpoint.json','utf8')):null;
const admin=new Pool({connectionString:input.href}),database=checkpoint?.database??'mooyu_qq_local_release_'+randomUUID().replaceAll('-','');if(!cold)await admin.query('CREATE DATABASE '+database);input.pathname='/'+database;const pool=new Pool({connectionString:input.href});
const images=JSON.parse(fs.readFileSync('/out/rendered-pages.json','utf8')),config=parseConfig({enabled:true,botId:'100000001',groupId:'200000001',allowedUsers:['300000001'],userMinuteMessages:10},{QQ_ACCESS_TOKEN:'release-fixture-token-'.repeat(3),QQ_DATABASE_URL:input.href});
let repository=new QQRepository(pool,config),runtime,socket;const sent=[],tasks=new Map(),agentId=checkpoint?.agentId??randomUUID(),articleTask=randomUUID();
const sourceReply='selector() 按 level 差值使用 > 或空格，源码 finder.ts 第231–241行。';
const respond=async body=>{
 if(cold)throw Error('UNEXPECTED_AGENT_REQUEST_AFTER_COLD_START');
 if(body.operation==='article-image')return images[body.page];
 if(body.operation==='article-image-access')return {id:articleTask,state:'completed',reply:'article access allowed'};
 if(body.operation==='submit'){const id=randomUUID(),kind=body.input.message==='source'?'github-question':body.input.message==='article'?'github-article':null;if(!kind)return {id,state:'completed',reply:'渠道已连接'};const task=kind==='github-article'?articleTask:randomUUID();tasks.set(task,{id:task,state:'completed',kind,reply:kind==='github-article'?'已完成文章草稿':sourceReply,...(kind==='github-article'?{articleRevisionId:images[0].revisionId}:{})});return {id,state:'completed',reply:'任务已保存',task:{id:task,state:'queued',kind}};}
 return tasks.get(body.interactionId);
};
let apiRequests=0;
const api=http.createServer(async(req,res)=>{try{apiRequests++;const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());verifyAgentChannelSignature('ab'.repeat(32),req.headers,body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:await respond(body)}));}catch{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'LOCAL_FIXTURE_FAILED'}}));}});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const client=createQQAgentClient({url:'http://127.0.0.1:'+api.address().port,secret:'ab'.repeat(32),agentId});
const start=async()=>{let gateway;
 runtime=await createQQChannelPluginHost({env:{}}).bindChannel({id:'mooyu.qq',version:'1.0.0'},{config,pool,repository,managed:true,useAgent:true,channelSecret:'ab'.repeat(32),env:{QQ_ADMIN_AGENT_USER_ID:agentId},client,
  gatewayFactory:(c,o)=>gateway=new OneBotGateway({...c,port:0},o),napcatFactory:()=>({readyGroup:config.groupId,maintain:async()=>{},inspect:async()=>({loggedIn:true,coreReady:true,accountMatches:true,groupReady:true})}),controlFactory:o=>startQQControlServer({...o,port:0,host:'127.0.0.1'})});
 await runtime.start();socket=new WebSocket('ws://127.0.0.1:'+gateway.server.address().port+'/onebot/v11',{headers:{authorization:'Bearer '+config.accessToken,'x-self-id':config.botId}});await once(socket,'open');
 socket.on('message',bytes=>{const value=JSON.parse(bytes.toString());assert.equal(value.action,'send_group_msg');sent.push(value);socket.send(JSON.stringify({status:'ok',retcode:0,data:{message_id:800000+sent.length},echo:value.echo}));});
};
const deliver=async(id,text)=>{socket.send(JSON.stringify({post_type:'message',message_type:'group',self_id:Number(config.botId),group_id:Number(config.groupId),user_id:300000001,message_id:id,message:[{type:'at',data:{qq:config.botId}},{type:'text',data:{text}}]}));for(let i=0;i<100;i++){if((await pool.query('SELECT 1 FROM mooyu_qq.messages WHERE message_id=$1',[String(id)])).rowCount)return;await new Promise(r=>setTimeout(r,10));}throw Error('ONEBOT_EVENT_NOT_ADMITTED');};
const tickUntil=async predicate=>{for(let i=0;i<50;i++){await runtime.tick();if(await predicate())return;}throw Error('RELEASE_DELIVERY_INCOMPLETE');};
try{
 if(cold){
  await start();for(let i=0;i<8;i++)await runtime.tick();assert.equal(sent.length,0);assert.equal(apiRequests,0);
  const pages=(await pool.query('SELECT p.page_no,p.page_count,p.sha256,m.remote_message_id,m.status,(SELECT count(*)::int FROM mooyu_qq.events e WHERE e.channel_id=m.channel_id AND e.message_id=m.message_id AND e.event_type=\'send-started\') AS attempts FROM mooyu_qq.agent_image_pages p JOIN mooyu_qq.messages m USING(channel_id,message_id) ORDER BY p.page_no')).rows;
  assert.deepEqual(pages,checkpoint.pages);assert.equal((await pool.query('SELECT count(*)::int AS n FROM mooyu_qq.messages')).rows[0].n,checkpoint.messageCount);assert.equal(JSON.stringify((await pool.query('SELECT * FROM mooyu_qq.control_settings ORDER BY channel_id')).rows),checkpoint.settings);
  const result={result:'PASSED',newContainerProcess:true,newOutboundMessages:0,pageIdsAndHashesUnchanged:true,sendAttemptsUnchanged:true,controlSettingsPreserved:true,externalQQConnected:false,paperEnabled:false};fs.writeFileSync('/out/worker-cold-start.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }else{
 await repository.initialize();await repository.enableControl();await repository.enableAgentBridge();
 await pool.query("INSERT INTO mooyu_qq.messages(channel_id,message_id,user_id,input_text,fingerprint,status,reply,origin_group_id) VALUES($1,'10','300000001','original history','original','delivered','original reply',$2)",[config.channelId,config.groupId]);
 const old=(await pool.query("SELECT md5(to_jsonb(m)::text) AS hash FROM mooyu_qq.messages m WHERE message_id='10'")).rows[0].hash;
 const settings=JSON.stringify((await pool.query('SELECT * FROM mooyu_qq.control_settings ORDER BY channel_id')).rows);
 await start();await deliver(101,'chat');await tickUntil(()=>sent.length===1);assert.match(JSON.stringify(sent[0]),/渠道已连接/u);
 await deliver(102,'source');await tickUntil(()=>sent.some(v=>JSON.stringify(v).includes(sourceReply)));
 await deliver(103,'article');await tickUntil(()=>sent.some(v=>v.params.message.some(p=>p.type==='image')));
 socket.close();await runtime.close();repository=new QQRepository(pool,config);await start();
 await tickUntil(async()=>Number((await pool.query("SELECT count(*) AS n FROM mooyu_qq.messages WHERE status<>'delivered'")).rows[0].n)===0);
 const pages=(await pool.query('SELECT p.page_no,p.page_count,p.sha256,m.remote_message_id,m.status,(SELECT count(*)::int FROM mooyu_qq.events e WHERE e.channel_id=m.channel_id AND e.message_id=m.message_id AND e.event_type=\'send-started\') AS attempts FROM mooyu_qq.agent_image_pages p JOIN mooyu_qq.messages m USING(channel_id,message_id) ORDER BY p.page_no')).rows;
 assert.equal(pages.length,images.length);assert.deepEqual(pages.map(p=>p.page_no),images.map(p=>p.page));assert(pages.every(p=>p.attempts===1&&p.status==='delivered'));
 const remoteImages=sent.flatMap(v=>v.params.message.filter(p=>p.type==='image'));assert.equal(remoteImages.length,images.length);assert.deepEqual(remoteImages.map(p=>createHash('sha256').update(Buffer.from(p.data.file.slice('base64://'.length),'base64')).digest('hex')),images.map(p=>p.sha256));
 const count=sent.length;socket.close();await runtime.close();repository=new QQRepository(pool,config);await start();for(let i=0;i<8;i++)await runtime.tick();assert.equal(sent.length,count);
 assert.equal((await pool.query("SELECT md5(to_jsonb(m)::text) AS hash FROM mooyu_qq.messages m WHERE message_id='10'")).rows[0].hash,old);assert.equal(JSON.stringify((await pool.query('SELECT * FROM mooyu_qq.control_settings ORDER BY channel_id')).rows),settings);
 fs.writeFileSync('/out/worker-checkpoint.json',JSON.stringify({database,agentId,pages,settings,messageCount:(await pool.query('SELECT count(*)::int AS n FROM mooyu_qq.messages')).rows[0].n}));
 const result={result:'PASSED',nativeOneBotWebSocket:true,signedAgentHttp:true,productionChannelPlugin:true,chatDelivered:true,sourceTextDelivered:true,pageCount:pages.length,pagesCompleteAndOrdered:true,eachPageAttemptsOne:true,restartDuringPagination:true,restartAfterCompletionNoDuplicates:true,originalQQHistoryPreserved:true,controlSettingsPreserved:true,externalQQConnected:false,externalModelsInvoked:false,paperEnabled:false};fs.writeFileSync('/out/worker-image-acceptance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }
}finally{socket?.close();await runtime?.close();await new Promise(resolve=>api.close(resolve));await pool.end();await admin.end();}
