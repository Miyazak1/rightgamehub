import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {EventEmitter} from 'node:events';import crypto from 'node:crypto';
import {patchNativeWebSocketClient,patchNapCatWebSocketOwner} from '../../scripts/patch-napcat-websocket-owner.mjs';
const baseline=fs.readFileSync(new URL('./fixtures/napcat-websocket/client-7967149b.txt',import.meta.url),'utf8').replace(/\r\n/g,'\n');
assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'),'bdce0215c45bd5095f83e0113cc0ad3359a1f3b54ac4d145c6ee77f29c3ad886');
function nativeClass(source){const start=source.indexOf('class pO extends vd {'),end=source.indexOf('\nvar G_',start);assert(start>=0&&end>start,'audited native websocket class boundaries');return source.slice(start,end);}
function fixture({original=false}={}){
 const source=original?baseline:process.env.NAPCAT_OWNER_SOURCE?nativeClass(fs.readFileSync(process.env.NAPCAT_OWNER_SOURCE,'utf8')):patchNativeWebSocketClient(baseline),sockets=[],timers=[];
 class Socket extends EventEmitter{static OPEN=1;constructor(){super();this.readyState=0;this.sent=[];sockets.push(this);}open(){this.readyState=1;this.emit('open');}send(v){this.sent.push(JSON.parse(v));}close(){this.readyState=2;}terminate(){this.readyState=3;}}
 class Base{constructor(){this.config={enable:true,url:'ws://fixture:6700/onebot/v11',token:'fixture',heartInterval:30000,reconnectInterval:5000};this.core={selfInfo:{uin:'3922489710',online:true}};this.logger={logError(){},logDebug(){}};this.actions=new Map();}}
 class Heartbeat{}class Lifecycle{}
 const Client=new Function('vd','Sn','z0','wh','lr','Vy','ne','Gn','jt','setInterval','clearInterval','setTimeout',source+'\nreturn pO;')(
  Base,Socket,Heartbeat,{CONNECT:'connect'}, {NetWorkOpen:1,NetWorkClose:2,NetWorkReload:3,Normal:0},Lifecycle,{Unknown:'unknown'},JSON,{error:()=>({status:'failed'}),ok:(data,echo)=>({status:'ok',data,echo})},()=>1,()=>{},fn=>{timers.push(fn);return timers.length;});
 return {client:new Client(),sockets,timers,sha:crypto.createHash('sha256').update(source).digest('hex')};
}
test('the pinned original class reproduces an orphaned live socket after the old close arrives',async()=>{
 const f=fixture({original:true});await f.client.open();const old=f.sockets[0];old.open();await f.client.reload({...f.client.config,url:'ws://replacement:6700/onebot/v11'});f.sockets[1].open();old.emit('close');assert.equal(f.client.connection,null);assert.equal(f.sockets[1].readyState,1);
});
test('unknown full vendor builds are refused instead of silently patching a different runtime',()=>{
 assert.throws(()=>patchNapCatWebSocketOwner('unknown'),/AUDITED_NAPCAT_SOURCE_REQUIRED/);
});
test('old close after a URL reload must not detach the new authenticated reverse socket',async()=>{
 const f=fixture();await f.client.open();const old=f.sockets[0];old.open();await f.client.reload({...f.client.config,url:'ws://replacement:6700/onebot/v11'});const current=f.sockets[1];current.open();
 old.emit('close');assert.equal(f.client.connection,current);await f.client.onEvent({post_type:'message',message_id:123});assert(current.sent.some(v=>v.message_id===123));
});
test('late error from a closed socket cannot clear or schedule reconnect for its replacement',async()=>{
 const f=fixture();await f.client.open();const old=f.sockets[0];old.open();f.client.close();await f.client.open();const current=f.sockets[1];current.open();const before=f.timers.length;
 old.emit('error',Error('late-old-socket-error'));assert.equal(f.client.connection,current);assert.equal(f.timers.length,before);
});
test('a current socket error retires that socket and schedules one reconnect',async()=>{
 const f=fixture();await f.client.open();const socket=f.sockets[0];socket.emit('error',Error('current-failure'));assert.equal(f.client.connection,null);assert.equal(f.timers.length,1);
 socket.emit('close');assert.equal(f.timers.length,1);await f.timers.shift()();assert.equal(f.sockets.length,2);
});
test('an action response must remain attached to the socket that requested it',async()=>{
 const f=fixture();await f.client.open();const old=f.sockets[0];old.open();let finish;f.client.actions.set('read', {websocketHandle:()=>new Promise(r=>finish=r)});
 const pending=f.client.handleMessage(Buffer.from(JSON.stringify({action:'read',echo:'old-echo'})),old);
 f.client.close();await f.client.open();const current=f.sockets[1];current.open();finish({status:'ok',retcode:0,echo:'old-echo',data:{value:1}});
 await pending.catch(()=>{});assert(!current.sent.some(v=>v.echo==='old-echo'));
});
