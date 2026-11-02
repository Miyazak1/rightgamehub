import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID as id} from 'node:crypto';import {createRequire} from 'node:module';
import {createGameIoFixture} from '../desktop/game-io-fixture.mjs';
import {createMemoryCredentialVault} from '../../apps/capability-executor/src/credential-vault.mjs';
import {createDesktopAccountSession} from '../../apps/desktop/src/account-session.mjs';
import {createDesktopBusinessApi} from '../../apps/desktop/renderer/business-api.mjs';
import {createDesktopRealtime,desktopRealtimeUrl} from '../../apps/desktop/src/realtime-bridge.mjs';
import {createDesktopMultiplayerFactory} from '../../apps/desktop/renderer/realtime-adapter.mjs';
import {createDesktopFileExports} from '../../apps/desktop/src/file-exports.mjs';
import {businessArguments} from '../../apps/desktop/src/business-contract.mjs';
const {WebSocket}=createRequire(new URL('../../apps/realtime/package.json',import.meta.url))('ws');
const {createSaveBridge}=createRequire(import.meta.url)('../helpers/game-save-bridge.cjs');
const wait=async fn=>{const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,10));}};
async function setup(t){const f=await createGameIoFixture({runtime:false});t.after(()=>f.close());const vault=createMemoryCredentialVault();await vault.store('desktop-shell-account:'+createHash('sha256').update(f.origin).digest('hex'),JSON.stringify({origin:f.origin,tokens:{accessToken:'local-fixture-access',refreshToken:'local-fixture-refresh'}}));let realtime;
 const s=await createDesktopAccountSession({apiOrigin:f.origin,vault,businessRuntime:{domain:'localhost',scheme:'http',port:f.runtimePort},onChanged:()=>realtime?.closeAll()});
 const api=createDesktopBusinessApi({async call(method,args){try{return {ok:true,value:await s.call(method,args)};}catch(e){return {ok:false,error:{code:e.code,status:e.status,message:e.message}};}}},f.origin);
 const listeners=new Set(),events=[];realtime=createDesktopRealtime({account:s,origin:f.origin,WebSocketImpl:WebSocket,onEvent:e=>{events.push(e);for(const fn of listeners)fn(e);}});t.after(()=>realtime.closeAll());
 const factory=createDesktopMultiplayerFactory({onEvent(fn){listeners.add(fn);return()=>listeners.delete(fn);},async call(method,input){try{return {ok:true,value:realtime.call(method,input)};}catch(e){return {ok:false,error:{code:e.code}};}}},f.origin);
 await api.getLaunch(f.workId);return {f,s,api,factory,realtime,events};}

test('SDK multiplayer uses main-process sockets, reconnects/resumes rooms, synchronizes matches and closes on logout',async t=>{
 const {f,s,api,factory,events}=await setup(t);const h=await createSaveBridge({api,descriptor:f.descriptor,sessionFactory:factory});t.after(()=>h.close());
 const modes=await h.client.multiplayer.listModes();assert.equal(modes[0].workId,f.workId);
 await h.client.multiplayer.rooms.create({modeId:f.modeId,visibility:'invite_only',capacity:2});
 await h.client.multiplayer.rooms.list(f.modeId);await h.client.multiplayer.rooms.join(f.roomId,f.modeId);
 assert.equal((await h.client.multiplayer.rooms.invite(f.roomId)).code,'ABCDE-FGHJK');
 await h.client.multiplayer.connect();await h.client.multiplayer.rooms.subscribe(f.roomId);
 await wait(()=>events.some(e=>e.type==='message'&&JSON.parse(e.data).type==='room.snapshot'));
 f.dropSockets();await wait(()=>f.ticketCount>=2&&f.commands.some(c=>c.type==='session.resume'));
 const match=await h.client.multiplayer.rooms.start(f.roomId);await h.client.multiplayer.matches.subscribe(match.id);
 await wait(()=>events.some(e=>e.type==='message'&&JSON.parse(e.data).type==='match.snapshot'));
 await h.client.multiplayer.matches.command(match.id,{type:'move',x:1});await wait(()=>f.commands.some(c=>c.type==='match.command'));
 assert.equal(JSON.stringify(events).includes('local-fixture-access'),false);assert.equal(JSON.stringify(events).includes('ws://'),false);assert.equal(JSON.stringify(h.wire).includes('ticket'),false);
 const count=f.ticketCount;await s.call('clear');await wait(()=>events.some(e=>e.type==='retired'));
 await new Promise(r=>setTimeout(r,650));assert.equal(f.ticketCount,count,'logout must stop automatic reconnect');

});

test('sharing uses bound game sessions, accepts protocol-size payloads and resolves immutable version context',async t=>{
 const {f,api,s}=await setup(t),h=await createSaveBridge({api,descriptor:f.descriptor});t.after(()=>h.close());
 const share=await h.client.shares.create({title:'本地分享',payload:{text:'x'.repeat(8000)}});assert.equal(share.workId,f.workId);
 const resolved=(await api.getGameShare(share.code)).data;assert.equal(resolved.payload.text.length,8000);
 const replay=await createSaveBridge({api,descriptor:f.descriptor,initialShareCode:share.code});t.after(()=>replay.close());assert.equal((await replay.client.shares.current()).releaseId,f.releaseId);
 const mismatch=await createSaveBridge({api,descriptor:{...f.descriptor,releaseId:id()},initialShareCode:share.code});t.after(()=>mismatch.close());await assert.rejects(mismatch.client.shares.current(),{code:'SHARE_CONTEXT_MISMATCH'});
 await s.call('clear');await assert.rejects(api.createGameShare(f.gameToken,{title:'blocked',payload:{}}),{code:'DESKTOP_GAME_SESSION_DENIED'});
 for(const [method,args] of [['createMultiplayerRoom',[{modeId:f.modeId,visibility:'public',capacity:9}]],['joinMultiplayerRoomScoped',[f.roomId,f.modeId,'bad-code']],['getGameShare',['../me']],['createRealtimeTicket',[]]])assert.throws(()=>businessArguments(method,args));
});

test('realtime bridge rejects arbitrary commands, cross-game rooms and late tickets after retirement',async t=>{
 const {f,api,factory,realtime,events}=await setup(t);await api.listMultiplayerModes(f.workId);await api.listMultiplayerRooms(f.modeId);
 const client=factory({workId:f.workId});t.after(()=>client.close());await client.connect();const connection=events[0].id;
 const message=roomId=>JSON.stringify({v:1,id:id(),type:'room.subscribe',sentAt:new Date().toISOString(),roomId,payload:{}});
 assert.throws(()=>realtime.call('send',{id:connection,workId:id(),data:message(f.roomId)}),{code:'DESKTOP_REALTIME_DENIED'});
 assert.throws(()=>realtime.call('send',{id:connection,workId:f.workId,data:message(id())}),{code:'DESKTOP_GAME_SESSION_DENIED'});
 assert.throws(()=>realtime.call('send',{id:connection,workId:f.workId,data:'x'.repeat(16385)}));
 let release,created=0;const pending=createDesktopRealtime({origin:f.origin,account:{gameContext:()=>()=>{},realtimeTicket:()=>new Promise(r=>{release=r;})},WebSocketImpl:class{constructor(){created++;}},onEvent(){}});
 pending.call('open',{id:id(),workId:f.workId});await wait(()=>!!release);pending.closeAll();release({websocketUrl:f.origin.replace('http:','ws:')+'/v1/realtime',ticket:'a'.repeat(43),expiresAt:new Date(Date.now()+30000).toISOString()});await new Promise(r=>setImmediate(r));assert.equal(created,0);
});

test('realtime endpoints reject cross-origin URLs, credentials, insecure remote transport and ticket redirects',()=>{
 const good={ticket:'a'.repeat(43),websocketUrl:'wss://mooyu.fun/v1/realtime',expiresAt:new Date(Date.now()+30000).toISOString()};
 assert.match(desktopRealtimeUrl(good,'https://mooyu.fun'),/^wss:\/\/mooyu.fun\/v1\/realtime\?ticket=/);
 for(const websocketUrl of ['ws://mooyu.fun/v1/realtime','wss://evil.test/v1/realtime','wss://user@mooyu.fun/v1/realtime','wss://mooyu.fun/v1/realtime?redirect=1','wss://mooyu.fun/other'])assert.throws(()=>desktopRealtimeUrl({...good,websocketUrl},'https://mooyu.fun'));
 assert.throws(()=>desktopRealtimeUrl({...good,expiresAt:'invalid'},'https://mooyu.fun'));
});

test('file exports save only native-selected JSON/PNG atomically; cancellation/changed authority preserve existing files',async t=>{
 const root=await fs.mkdtemp(path.resolve('.runtime/desktop-export-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let destination=path.join(root,'chosen.json'),allowed=true,checks=0;
 const selected=[],service=createDesktopFileExports({context:()=>()=>{if(!allowed)throw Object.assign(Error('changed'),{code:'DESKTOP_ACCOUNT_SESSION_CHANGED'});},verify:async()=>{checks++;},choosePath:async file=>{selected.push(file.filename);return destination;}});
 const data=new TextEncoder().encode('{"local":true}').buffer,input=()=>({id:id(),file:{filename:'safe.json',mimeType:'application/json',data},descriptor:{workId:id(),releaseId:id(),channel:'production'}});
 const result=await service.save(input());assert.equal(result.filename,'chosen.json');assert.equal('path' in result,false);assert.equal(await fs.readFile(destination,'utf8'),'{"local":true}');assert.equal(checks,2);
 const count=selected.length;await assert.rejects(service.save({...input(),file:{...input().file,filename:'../unsafe.json'}}));assert.equal(selected.length,count);
 let choose;const cancelService=createDesktopFileExports({context:()=>()=>{},verify:async()=>{},choosePath:()=>new Promise(r=>{choose=r;})});const cancelled=input(),pending=cancelService.save(cancelled);while(!choose)await new Promise(r=>setImmediate(r));cancelService.cancel(cancelled.id);choose(destination);await assert.rejects(pending,{code:'FILE_EXPORT_CANCELLED'});assert.equal(await fs.readFile(destination,'utf8'),'{"local":true}');
 let change;const changedService=createDesktopFileExports({context:()=>()=>{if(!allowed)throw Object.assign(Error('changed'),{code:'DESKTOP_ACCOUNT_SESSION_CHANGED'});},verify:async()=>{},choosePath:()=>new Promise(r=>{change=r;})});const changed=changedService.save(input());while(!change)await new Promise(r=>setImmediate(r));allowed=false;change(destination);await assert.rejects(changed,{code:'DESKTOP_ACCOUNT_SESSION_CHANGED'});allowed=true;
 const sharp=createRequire(new URL('../../apps/api/package.json',import.meta.url))('sharp'),png=await sharp({create:{width:1,height:1,channels:4,background:'#8b5cf6'}}).png().toBuffer();destination=path.join(root,'chosen.png');await service.save({...input(),file:{filename:'safe.png',mimeType:'image/png',data:png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength)}});assert.deepEqual(await fs.readFile(destination),png);
 assert.equal((await fs.readdir(root)).some(f=>f.endsWith('.tmp')),false);
});
