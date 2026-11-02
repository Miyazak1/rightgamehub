import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';
import {createDesktopMultiplayerFactory} from '../../apps/desktop/renderer/realtime-adapter.mjs';import {createDesktopRealtime} from '../../apps/desktop/src/realtime-bridge.mjs';import {desktopProxyUrl,createDesktopProxyResolver} from '../../apps/desktop/src/websocket-proxy.mjs';import {createProxyWebSocketFixture} from '../desktop/proxy-websocket-fixture.mjs';
const {attachGameIoNavigation}=createRequire(import.meta.url)('../../apps/desktop/electron/game-io-navigation.cjs');
const wait=async fn=>{const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,10));}};

test('only main-frame navigation retires game IO; child hashes/reloads and no-op main history preserve it',()=>{
 const c=new EventEmitter();c.getURL=()=> 'mooyu-app://client/play/game';let retired=0;const detach=attachGameIoNavigation(c,()=>retired++);
 c.emit('did-start-loading');c.emit('did-start-navigation',{isMainFrame:false,isSameDocument:true,url:'http://game.local/#tab'});c.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false,url:'http://game.local/next.html'});assert.equal(retired,0);
 c.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true,url:c.getURL()});assert.equal(retired,0);
 c.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true,url:'mooyu-app://client/discover'});assert.equal(retired,1);
 c.emit('did-start-navigation',{},'mooyu-app://client/discover',false,true);assert.equal(retired,2,'reload must retire even at same URL');detach();assert.equal(c.listenerCount('did-start-navigation'),0);
});

test('closing between construction and queued open sends no IPC open and removes its event listener',async()=>{
 for(let i=0;i<5;i++){
   const calls=[],listeners=new Set();const s=createDesktopMultiplayerFactory({onEvent(fn){listeners.add(fn);return()=>listeners.delete(fn);},async call(method){calls.push(method);return {ok:true};}},'http://127.0.0.1:49190')({workId:crypto.randomUUID()});
   const pending=s.connect().catch(()=>{});queueMicrotask(()=>s.close());await pending;await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[]);assert.equal(listeners.size,0);assert.equal(s.getStatus(),'closed');
 }
});

test('proxy routes use Chromium selection, strip ticket before resolution and reject unsupported/malformed routes',async()=>{
 assert.equal(desktopProxyUrl('DIRECT'),null);assert.equal(desktopProxyUrl('PROXY 127.0.0.1:8080; DIRECT'),'http://127.0.0.1:8080/');assert.equal(desktopProxyUrl('HTTPS proxy.example:443'),'https://proxy.example/');assert.equal(desktopProxyUrl('SOCKS5 [::1]:1080'),'socks5h://[::1]:1080');
 for(const rule of ['',null,'QUIC proxy:443','PROXY user:secret@host:80','PROXY host:0','PROXY host:65536','PROXY host:80/path'])assert.throws(()=>desktopProxyUrl(rule),{code:'DESKTOP_PROXY_UNSUPPORTED'});
 let seen;const direct=await createDesktopProxyResolver(async url=>{seen=url;return 'DIRECT';})('wss://example.test/v1/realtime?ticket=private');assert.deepEqual(direct,{});assert.equal(seen,'wss://example.test/v1/realtime');
 const socks=await createDesktopProxyResolver(async()=> 'SOCKS5 127.0.0.1:1080')('wss://example.test/v1/realtime');assert.equal(socks.agent.constructor.name,'SocksProxyAgent');socks.dispose();
 await assert.rejects(createDesktopProxyResolver(async()=>{throw Error('resolution failed');})('wss://example.test/v1/realtime'));
});

test('retirement during proxy resolution disposes route and never creates a late socket',async()=>{
 let resolve,constructed=0,disposed=0;const b=createDesktopRealtime({origin:'http://127.0.0.1:49190',account:{gameContext:()=>()=>{},realtimeTicket:async()=>({ticket:'a'.repeat(43),websocketUrl:'ws://127.0.0.1:49190/v1/realtime',expiresAt:new Date(Date.now()+30000).toISOString()})},WebSocketImpl:class{constructor(){constructed++;}},getProxyRoute:()=>new Promise(r=>{resolve=r;}),onEvent(){}});
 b.call('open',{id:crypto.randomUUID(),workId:crypto.randomUUID()});await wait(()=>!!resolve);b.closeAll();resolve({dispose(){disposed++;}});await new Promise(r=>setImmediate(r));assert.equal(constructed,0);assert.equal(disposed,1);
});

test('WSS requires the configured CONNECT proxy and retains certificate/hostname validation',async t=>{
 const f=await createProxyWebSocketFixture();t.after(()=>f.close());const seen=[];const route=createDesktopProxyResolver(async url=>{seen.push(url);return f.rule;});
 async function connect(WebSocketImpl,origin=f.origin){const events=[];const b=createDesktopRealtime({origin,account:{gameContext:()=>()=>{},realtimeTicket:async()=>f.ticket(origin),receiveRealtime:()=>true},WebSocketImpl,getProxyRoute:route,onEvent:e=>events.push(e)});b.call('open',{id:crypto.randomUUID(),workId:crypto.randomUUID()});await wait(()=>events.some(e=>e.type==='message'||e.type==='close'));b.closeAll();return events;}
 const good=await connect(f.TrustedFixtureSocket);assert.ok(good.some(e=>e.type==='message'));assert.equal(f.stats.connects,1);assert.equal(f.stats.connections,1);assert.ok(seen.every(url=>!url.includes('ticket')));
 assert.ok((await connect(f.WebSocket)).some(e=>e.type==='error'),'untrusted fixture CA must fail');assert.equal(f.stats.connections,1);
 assert.ok((await connect(f.TrustedFixtureSocket,'https://localhost:9')).some(e=>e.type==='error'),'trusted CA must not bypass hostname validation');assert.equal(f.stats.connections,1);assert.equal(f.stats.accountAuthorization,false);assert.equal(f.stats.proxyAuthorization,false);
});
