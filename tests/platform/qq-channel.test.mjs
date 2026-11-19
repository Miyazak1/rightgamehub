import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {parseConfig,parseInbound} from '../../apps/qq-channel/src/config.mjs';
import {createQQProvider,QQService} from '../../apps/qq-channel/src/service.mjs';
import {OneBotGateway} from '../../apps/qq-channel/src/onebot.mjs';
const {WebSocket}=createRequire(new URL('../../apps/qq-channel/package.json',import.meta.url))('ws');
const env={QQ_ACCESS_TOKEN:'test-only-token-'.repeat(3),QQ_DATABASE_URL:'postgresql://127.0.0.1/mooyu_qq_local_unit'};
const input={enabled:true,botId:'100000001',groupId:'100000002',allowedUsers:['100000003']};
const message={post_type:'message',message_type:'group',self_id:100000001,group_id:100000002,user_id:100000003,message_id:-123,
 message:[{type:'at',data:{qq:'100000001'}},{type:'text',data:{text:'你好'}}]};
test('QQ config is single-group, opt-in, local-only, explicitly allowlisted and papers-off',()=>{
 assert.equal(parseConfig(input,env).groupId,'100000002');
 for(const patch of [{allowedUsers:[]},{allowedUsers:['100000001']},{dailyCalls:0},{groupId:['100000002']},{tools:['publish']},{enabled:undefined},{model:'arbitrary/url'}])assert.throws(()=>parseConfig({...input,...patch},env));
 for(const database of ['postgresql://production/mooyu_qq_local_test','postgresql://127.0.0.1/gamehub','postgresql://127.0.0.1/postgres'])assert.throws(()=>parseConfig(input,{...env,QQ_DATABASE_URL:database}),{code:'QQ_LOCAL_DATABASE_REQUIRED'});
 assert.throws(()=>parseConfig(input,{...env,QQ_ACCESS_TOKEN:''}),{code:'QQ_ACCESS_TOKEN_REQUIRED'});
 assert.throws(()=>parseConfig(input,{...env,PAPER_STUDY_ENABLED:'true'}),{code:'QQ_PAPER_MUST_REMAIN_DISABLED'});
});
test('only an actual at segment in the expected group from an allowed human admits text',()=>{
 const c=parseConfig(input,env);assert.deepEqual(parseInbound(c,message),{messageId:'-123',userId:'100000003',text:'你好'});
 const denied=[{user_id:100000004},{user_id:100000001},{group_id:100000009},{self_id:100000009},{message_type:'private'},{post_type:'message_sent'},
  {message:'[CQ:at,qq=100000001]你好'},{message:[{type:'text',data:{text:'@小墨鱼'}}]},
  {message:[...message.message,{type:'image',data:{url:'http://localhost/secret'}}]},
  {message:[message.message[0],{type:'text',data:{text:'x'.repeat(4001)}}]}, {message_id:Number.MAX_SAFE_INTEGER+1}];
 for(const patch of denied)assert.equal(parseInbound(c,{...message,...patch}),null);
 assert.equal(parseInbound({...c,enabled:false},message),null);
 assert.equal(parseInbound(c,{...message,sender:{role:'owner'},user_id:100000004}),null);
});
test('QQ provider allows only a bounded final text response and invokes no tools or automatic retries',async()=>{
 let calls=0;const invoke=async request=>{calls++;assert.equal(request.tokenCeiling,512);assert.equal(request.timeoutSeconds,30);return {output:'{"reply":"你好"}',responseRef:{finishReason:'stop'},usage:{inputTokens:10,outputTokens:3}};};
 const provider=createQQProvider({apiKey:'local-fixture',model:'deepseek-chat',invoke});
 assert.equal((await provider({messages:[{role:'user',content:'hi'}],maxTokens:512,requestId:'test'})).reply,'你好');assert.equal(calls,1);
 for(const output of ['{"toolCall":{"name":"publish","arguments":{}}}','{"reply":"hello","toolCall":{}}','{"reply":"'+ 'x'.repeat(8001)+'"}'])
  await assert.rejects(createQQProvider({apiKey:'fixture',invoke:async()=>({output,responseRef:{finishReason:'stop'}})})({messages:[],maxTokens:512,requestId:'test'}));
 await assert.rejects(createQQProvider({apiKey:'fixture',invoke:async()=>({output:'{"reply":"partial"}',responseRef:{finishReason:'length'}})})({messages:[],maxTokens:512,requestId:'test'}));
});
test('QQ follow-up preserves the JSON output contract for assistant history only',()=>{
 const service=new QQService({config:parseConfig(input,env)});
 const history=[{role:'user',content:'用一句话介绍自己。'},{role:'assistant',content:'我是小墨鱼。\n引用："你好"，路径 \\test'},{role:'user',content:'继续'},{role:'assistant',content:'{"reply":"用户可见的字面 JSON"}'}];
 const before=structuredClone(history),messages=service.messages(history,{input_text:'我刚才让你做了什么？'});
 assert.deepEqual(history,before);
 assert.deepEqual(messages.filter(m=>m.role==='assistant').map(m=>JSON.parse(m.content)),history.filter(m=>m.role==='assistant').map(m=>({reply:m.content})));
 assert.deepEqual(messages.filter(m=>m.role==='user').map(m=>m.content),['用一句话介绍自己。','继续','我刚才让你做了什么？']);
 assert.equal(messages.length,6);
 assert.equal(service.messages([],{input_text:'首轮'})[1].content,'首轮');
});
test('real OneBot socket authenticates, binds one account, correlates echoes and sends only fixed text replies',async t=>{
 const c=parseConfig(input,env),received=[];const server=new OneBotGateway(c,{receive:async e=>received.push(e),actionTimeoutMs:150});
 t.after(()=>server.stop());const address=await server.start({port:0}),url=`ws://127.0.0.1:${address.port}/onebot/v11`;
 const connect=async(headers={})=>{const ws=new WebSocket(url,{headers});ws.on('error',()=>{});await once(ws,'open');return ws;};
 const denied=new WebSocket(url,{headers:{authorization:'Bearer wrong','x-self-id':c.botId}});denied.on('error',()=>{});
 await new Promise(resolve=>denied.once('close',resolve));assert.equal(server.connected(),false);
 const socket=await connect({authorization:'Bearer '+c.accessToken,'x-self-id':c.botId});t.after(()=>socket.terminate());
 socket.send(JSON.stringify(message));await new Promise(resolve=>setTimeout(resolve,30));assert.equal(received.length,1);
 const observed=once(socket,'message'),sending=server.send({message_id:'-123',user_id:'100000003',reply:'[CQ:at,qq=all] literal text'});
 const [bytes]=await observed,action=JSON.parse(bytes.toString());assert.equal(action.action,'send_group_msg');assert.equal(action.params.group_id,100000002);
 assert.equal(action.params.message.at(-1).type,'text');assert.match(action.params.message.at(-1).data.text,/CQ:at/);
 socket.send(JSON.stringify({status:'ok',retcode:0,echo:'wrong',data:{message_id:8}}));
 socket.send(JSON.stringify({status:'ok',retcode:0,echo:action.echo,data:{message_id:9}}));assert.equal(await sending,'9');
 await assert.rejects(server.send({message_id:'2',user_id:c.allowedUsers[0],reply:'timeout'}),{code:'QQ_DELIVERY_UNCERTAIN'});
 socket.terminate();await once(socket,'close');
 await assert.rejects(server.send({message_id:'3',user_id:c.allowedUsers[0],reply:'offline'}),{notSent:true});
});
