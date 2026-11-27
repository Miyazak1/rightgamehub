import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
import {patchNativeWebSocketClient} from '../../scripts/patch-napcat-websocket-owner.mjs';
import {OneBotGateway} from '../../apps/qq-channel/src/onebot.mjs';import {parseConfig,parseInbound} from '../../apps/qq-channel/src/config.mjs';
const {WebSocket}=createRequire(new URL('../../apps/qq-channel/package.json',import.meta.url))('ws');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await pause(10);}throw Error('WIRE_CONDITION_TIMEOUT');}
function nativeClient(config){
 const source=patchNativeWebSocketClient(fs.readFileSync(new URL('./fixtures/napcat-websocket/client-7967149b.txt',import.meta.url),'utf8').replace(/\r\n/g,'\n'));
 class Base{constructor(){this.config=config;this.core={selfInfo:{uin:'100000001',online:true}};this.logger={logError(){},logDebug(){}};this.actions=new Map();}}
 class Lifecycle{constructor(){this.post_type='meta_event';this.meta_event_type='lifecycle';this.self_id=100000001;}}
 class Heartbeat{constructor(){this.post_type='meta_event';this.meta_event_type='heartbeat';this.self_id=100000001;}}
 const Client=new Function('vd','Sn','z0','wh','lr','Vy','ne','Gn','jt',source+'\nreturn pO;')(Base,WebSocket,Heartbeat,{CONNECT:'connect'},{NetWorkOpen:1,NetWorkClose:2,NetWorkReload:3,Normal:0},Lifecycle,{Unknown:'unknown'},JSON,{error:(_,code,echo)=>({status:'failed',retcode:code,echo}),ok:(data,echo)=>({status:'ok',retcode:0,data,echo})});return new Client();
}
test('real reverse sockets survive delayed old close/error during 100 switches and confirm replies once',{timeout:30000},async t=>{
 const config=parseConfig({enabled:true,botId:'100000001',groupId:'100000002',allowedUsers:['100000003']},{QQ_ACCESS_TOKEN:'local-wire-token-'.repeat(3),QQ_DATABASE_URL:'postgresql://127.0.0.1/mooyu_qq_local_wire'}),events=[],sent=[],alive=new Set();
 const create=async(port=0)=>{const g=new OneBotGateway(config,{receive:async e=>{const parsed=parseInbound(config,e);if(parsed)events.push(parsed);return {accepted:!!parsed};}});await g.start({port});alive.add(g);return g;};
 let client;t.after(async()=>{client?.close();await pause(25);for(const g of alive)await g.stop();});
 let a=await create(),b=await create();client=nativeClient({enable:true,url:'ws://127.0.0.1:'+a.server.address().port+'/onebot/v11',token:config.accessToken,heartInterval:100,reconnectInterval:20});
 client.actions.set('send_group_msg',{websocketHandle:async(params,echo)=>{sent.push(params);return {status:'ok',retcode:0,data:{message_id:7000+sent.length},echo};}});
 await client.open();await until(()=>a.connected()&&client.isActive);
 for(let i=0;i<100;i++){
  const target=i%2? a:b,old=client.connection,emit=old.emit.bind(old);let delayedClose=null;
  old.emit=(name,...args)=>{if(name==='close'){delayedClose=args;return true;}return emit(name,...args);};
  await client.reload({...client.config,url:'ws://127.0.0.1:'+target.server.address().port+'/onebot/v11'});await until(()=>target.connected()&&client.isActive&&delayedClose);
  const current=client.connection;emit('close',...delayedClose);emit('error',Error('late-test-socket-error'));assert.equal(client.connection,current);
  await client.onEvent({post_type:'message',message_type:'group',self_id:100000001,group_id:100000002,user_id:100000003,message_id:i+1,message:[{type:'at',data:{qq:'100000001'}},{type:'text',data:{text:'wire-'+i}}]});
  await until(()=>events.length===i+1);assert.equal(await target.send({message_id:String(i+1),user_id:'100000003',reply:'ack-'+i}),String(7001+i));
 }
 assert.equal(new Set(events.map(e=>e.messageId)).size,100);assert.equal(sent.length,100);
 for(let i=0;i<5;i++){
  const current=client.config.url.includes(':'+a.server.address().port+'/')?a:b,port=current.server.address().port;await current.stop();alive.delete(current);
  const replacement=await create(port);if(current===a)a=replacement;else b=replacement;await until(()=>replacement.connected()&&client.isActive);
 }
 assert.equal(client.core.selfInfo.online,true);
});
