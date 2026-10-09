const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MessageChannel } = require('node:worker_threads');
const target = () => {
  const events = new Map();
  return { addEventListener(k, f) { if (!events.has(k)) events.set(k, new Set()); events.get(k).add(f); },
    removeEventListener(k, f) { events.get(k)?.delete(f); }, dispatch(k, v) { for (const f of events.get(k) ?? []) f(v); } };
};
async function setup(t, capabilities, modules = {}, api = {}, options = {}) {
  const { createWebGameHost } = await import('../../packages/platform-client/src/web-game-host.mjs');
  const { bridgeEnvelope } = await import('../../packages/web-game-sdk/src/protocol.mjs');
  const host = target(), game = target(); let ready;
  const ports = [];
  game.postMessage = (data, origin, supplied) => { ready = data; ports.push(supplied[0]); supplied[0].start(); };
  const descriptor = { workId: crypto.randomUUID(), releaseId: crypto.randomUUID(), capabilities };
  const bridge = createWebGameHost({
    windowImpl: host, frame: { contentWindow: game }, launchId: crypto.randomUUID(), descriptor,
    MessageChannelImpl: MessageChannel, modules, logger: { warn() {} }, ...options,
    apiClient: { getProfile: async () => ({ data: { id: 'user', displayName: 'Player', token: 'secret' } }),
      createGameSession: async () => ({ data: { gameSessionId: 'secret-session', expiresAt: new Date(Date.now()+300000).toISOString(), capabilities: ['cloudSave','competition'] } }),
      revokeGameSession: async () => ({}), ...api },
  });
  const connect = () => {
    host.dispatch('message', { source: game, data: bridgeEnvelope({ type: 'gamehub.bridge.connect', clientNonce: '0123456789abcdef' }) });
    return ports.at(-1);
  };
  const request = (method, params = {}, port = ports.at(-1)) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => reject(new Error('test bridge timeout')), 1000);
    const receive = ({ data }) => { if (data.id !== id) return; clearTimeout(timeout); port.removeEventListener('message', receive); resolve(data); };
    port.addEventListener('message', receive); port.postMessage(bridgeEnvelope({ type: 'request', id, method, params }));
  });
  t.after(() => { bridge.close(); for (const port of ports) port.close(); });
  return { host, game, connect, request, bridge, get ready() { return ready; } };
}
test('generic bridge supports save-only, competition-only, multiplayer-only and combinations without extra authority', async t => {
  for (const capabilities of [{ cloudSave: true }, { competition: true }, { multiplayer: true }, { cloudSave: true, competition: true, multiplayer: true }]) {
    let disabledCalled = 0;
    const setupValue = await setup(t, capabilities, {
      cloudSave: () => ({ handlers: { 'cloudSave.policy.get': async () => ({ maxDocumentBytes: 262144 }) } }),
      competition: () => ({ handlers: { 'competition.modes.list': async () => [] } }),
      multiplayer: () => ({ handlers: { 'multiplayer.modes.list': async () => { disabledCalled++; return []; } } }),
    });
    setupValue.connect();
    assert.deepEqual(setupValue.ready.capabilities, ['identity', ...['cloudSave','competition','multiplayer'].filter(c => capabilities[c])]);
    assert.doesNotMatch(JSON.stringify(setupValue.ready), /secret|gameSessionId|bearer/u);
    assert.deepEqual((await setupValue.request('player.get')).result, { id: 'user', displayName: 'Player', avatar: null });
    const response = await setupValue.request('multiplayer.modes.list');
    assert.equal(response.ok, Boolean(capabilities.multiplayer));
    assert.equal(disabledCalled, capabilities.multiplayer ? 1 : 0);
    if (!capabilities.multiplayer) assert.equal(response.error.code, 'BRIDGE_CAPABILITY_NOT_GRANTED');
    if (capabilities.cloudSave) assert.equal((await setupValue.request('cloudSave.policy.get')).ok,true);
    if (capabilities.competition) assert.equal((await setupValue.request('competition.modes.list')).ok,true);
  }
});
test('old async operations cannot deliver responses into a reconnected channel', async t => {
  let finish; let disposed = 0;
  const state = await setup(t, { cloudSave: true }, { cloudSave: () => ({
    handlers: { 'cloudSave.policy.get': () => new Promise(resolve => { finish = resolve; }) }, close() { disposed++; },
  }) });
  const old = state.connect();
  const { bridgeEnvelope } = await import('../../packages/web-game-sdk/src/protocol.mjs');
  old.postMessage(bridgeEnvelope({ type: 'request', id: crypto.randomUUID(), method: 'cloudSave.policy.get', params: {} }));
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const next = state.connect(); const received = []; next.on('message', data => received.push(data));
  finish({ fromOldAccount: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(received, []); assert.equal(disposed,1);
  assert.equal((await state.request('player.get', {}, next)).ok,true);
  state.bridge.close(); assert.equal(disposed,2);
});
test('server-denied service scope is rejected before a domain handler executes', async t => {
  let called=0;
  const state = await setup(t, { cloudSave:true }, { cloudSave:()=>({ handlers: { 'cloudSave.policy.get':()=>{called++;return {};} } }) },
    { createGameSession:async()=>({ data:{gameSessionId:'secret',expiresAt:new Date(Date.now()+300000).toISOString(),capabilities:['identity']} }) });
  state.connect();
  assert.equal((await state.request('cloudSave.policy.get')).error.code,'BRIDGE_CAPABILITY_NOT_GRANTED');
  assert.equal(called,0);
});
test('player core creates a bridge for each service capability and preserves opaque sandbox', async () => {
  const { PlayerCore } = await import('../../packages/player-core/src/index.mjs');
  let count=0, close=0; const attrs={};
  const frame={setAttribute(k,v){attrs[k]=v;},addEventListener(){},remove(){},contentWindow:{}};
  const container={ownerDocument:{createElement:()=>frame},replaceChildren(){}};
  const core=new PlayerCore({createBridge(){count++;return {close(){close++;}};}});
  const descriptor={apiVersion:1, runtimeOrigin:'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example',entryUrl:'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example/index.html'};
  for(const cap of ['cloudSave','competition','multiplayer']) {core.mount(container,{...descriptor,capabilities:{[cap]:true}});assert.equal(attrs.sandbox,'allow-scripts');core.stop();}
  assert.equal(count,3);assert.equal(close,3);core.dispose();
});
test('SDK close cancels an unfinished handshake', async () => {
  const { createGameHubClient }=await import('../../packages/web-game-sdk/src/index.mjs');
  const client=createGameHubClient({windowImpl:target(),parentWindow:{postMessage(){}},requestTimeoutMs:1000});
  const connecting=client.connect();client.close();await assert.rejects(connecting,/closed/u);
});
test('session creation finishing after frame disposal revokes its credential', async () => {
  const { createGameSessionManager }=await import('../../packages/platform-client/src/game-session-manager.mjs');
  let finish; const revoked=[];
  const manager=createGameSessionManager({descriptor:{workId:'w',releaseId:'r'},apiClient:{
    createGameSession:()=>new Promise(resolve=>{finish=resolve;}),revokeGameSession:async id=>revoked.push(id),
  }});
  const operation=manager.get('cloudSave'); manager.close();
  finish({data:{gameSessionId:'private',expiresAt:new Date(Date.now()+300000).toISOString(),capabilities:['cloudSave']}});
  await assert.rejects(operation,/closed/u); assert.deepEqual(revoked,['private']);
});

test('account grant switch closes the old bridge before it can access the new account',async t=>{
  let identity='account-a/grant-a',profiles=0,closed=0;
  const state=await setup(t,{multiplayer:true},{multiplayer:()=>({handlers:{'multiplayer.modes.list':async()=>[]},close(){closed++;}})},
    {getProfile:async()=>{profiles++;return {data:{id:identity,displayName:'Player'}};}},{getAccountIdentity:async()=>identity});
  state.connect();assert.equal((await state.request('player.get')).result.id,'account-a/grant-a');
  identity='account-b/grant-b';
  const result=state.request('player.get').catch(()=>null);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(closed,1);assert.equal(profiles,1);
  await result;
});
test('SDK rejects a large outgoing command before sending it to the host',async t=>{
  const {createGameHubClient}=await import('../../packages/web-game-sdk/src/index.mjs');
  const {bridgeEnvelope}=await import('../../packages/web-game-sdk/src/protocol.mjs');
  const window=target(),parent={};let messages=0;const channel=new MessageChannel();
  parent.postMessage=data=>window.dispatch('message',{source:parent,ports:[channel.port2],data:bridgeEnvelope({type:'gamehub.bridge.ready',clientNonce:data.clientNonce,capabilities:['multiplayer']})});
  channel.port1.on('message',()=>messages++);
  const client=createGameHubClient({windowImpl:window,parentWindow:parent});
  t.after(()=>{client.close();channel.port1.close();channel.port2.close();});
  assert.deepEqual(await client.connect(),['multiplayer']);
  assert.deepEqual(await client.connect(),['multiplayer']);
  await assert.rejects(client.multiplayer.matches.command(crypto.randomUUID(),{data:'a'.repeat(33000)}),{code:'BRIDGE_REQUEST_INVALID'});
  assert.equal(messages,0);
});

test('legacy multiplayer responses retain their existing size behavior',async t=>{
  const payload=[{id:'mode',configuration:'a'.repeat(40000)}];
  const state=await setup(t,{multiplayer:true},{multiplayer:()=>({handlers:{'multiplayer.modes.list':async()=>payload}})});
  state.connect();assert.deepEqual((await state.request('multiplayer.modes.list')).result,payload);
});

test('file/share-only launches expose declared methods while refusing cross-frame and undeclared requests',async t=>{
 const descriptor={workId:crypto.randomUUID(),releaseId:crypto.randomUUID(),capabilities:{fileExport:true,shareLinks:true}};let exports=0;
 const api={getLaunch:async()=>({data:descriptor}),createGameSession:async()=>({data:{gameSessionId:'parent-secret',expiresAt:new Date(Date.now()+300000).toISOString(),capabilities:['shareLinks']}}),createGameShare:async token=>{assert.equal(token,'parent-secret');return {data:{code:'A'.repeat(32),url:'https://mooyu.fun/#/s/'+ 'A'.repeat(32)}};}};
 const s=await setup(t,descriptor.capabilities,{},api,{descriptor,exportFile:async()=>{exports++;return {status:'saved'};}});const {bridgeEnvelope}=await import('../../packages/web-game-sdk/src/protocol.mjs');s.host.dispatch('message',{source:{},data:bridgeEnvelope({type:'gamehub.bridge.connect',clientNonce:'0123456789abcdef'})});assert.equal(s.ready,undefined);s.connect();assert.deepEqual(s.ready.capabilities,['identity','fileExport','shareLinks']);
 const request={filename:'Bingo.json',mimeType:'application/json',data:new TextEncoder().encode('{}').buffer};assert.equal((await s.request('files.download',request)).result.status,'saved');assert.equal(exports,1);assert.equal((await s.request('shares.current')).result,null);
 assert.equal((await s.request('shares.create',{title:'Bingo',payload:{kind:'bingo-pack'}})).ok,true);assert.equal((await s.request('shares.current',{code:'untrusted'})).ok,false);
 const denied=await setup(t,{},{});denied.connect();assert.equal((await denied.request('files.download',request)).error.code,'BRIDGE_CAPABILITY_NOT_GRANTED');assert.equal((await denied.request('shares.create',{title:'Bingo',payload:{}})).error.code,'BRIDGE_CAPABILITY_NOT_GRANTED');
});

test('reconnecting the iframe cannot reset export admission limits',async t=>{
 const descriptor={workId:crypto.randomUUID(),releaseId:crypto.randomUUID(),capabilities:{fileExport:true}};
 const s=await setup(t,descriptor.capabilities,{}, {getLaunch:async()=>({data:descriptor})},{descriptor,exportFile:async()=>({status:'saved'})});s.connect();
 const input={filename:'a.json',mimeType:'application/json',data:new TextEncoder().encode('{}').buffer};for(let i=0;i<5;i++)assert.equal((await s.request('files.download',input)).ok,true);s.connect();assert.equal((await s.request('files.download',input)).error.code,'FILE_EXPORT_BUSY');
});
