const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MessageChannel } = require('node:worker_threads');

const eventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event) { for (const listener of listeners.get(type) ?? []) listener(event); },
  };
};

test('web game bridge exposes scoped multiplayer without credentials', async t => {
  const { createWebGameMultiplayerHost } = await import('../../packages/platform-client/src/web-game-multiplayer-host.mjs');
  const { createGameHubClient } = await import('../../packages/web-game-sdk/src/index.mjs');
  const hostWindow = eventTarget(); hostWindow.location = { origin: 'https://mooyu.fun',pathname: '/' };
  const gameWindow = eventTarget();
  gameWindow.parent = hostWindow;
  hostWindow.postMessage = data => hostWindow.dispatch('message', { data,source: gameWindow,ports: [] });
  gameWindow.postMessage = (data, _origin, ports = []) => gameWindow.dispatch('message', { data,source: hostWindow,ports });
  const modeId = crypto.randomUUID(); const roomId = crypto.randomUUID(); const matchId = crypto.randomUUID();
  let scopedJoinCalls = 0; let listArgs = null; const sessionListeners = new Map(); const sent = [];
  const session = {
    on(type, listener) { sessionListeners.set(type, listener); return () => sessionListeners.delete(type); },
    connect: async () => ({ protocol: 'gamehub.realtime.v1' }),close() {},getStatus: () => 'connected',getSubscribedRoomIds: () => [roomId],
    subscribeRoom: id => (sent.push(['room',id]),crypto.randomUUID()),unsubscribeRoom: () => crypto.randomUUID(),setReady: () => crypto.randomUUID(),
    subscribeMatch: id => (sent.push(['match',id]),crypto.randomUUID()),unsubscribeMatch() {},sendMatchCommand: (id, command) => (sent.push(['command',id,command]),crypto.randomUUID()),resignMatch: () => crypto.randomUUID(),
  };
  const room = { id: roomId,modeId,revision: '1',members: [] };
  const match = { id: matchId,roomId,modeId,revision: '0',nextEventSeq: '2' };
  const apiClient = {
    getProfile: async () => ({ data: { id: 'user-1',displayName: 'Player',avatar: { kind: 'preset' },role: 'admin',email: 'private@example.test' } }),
    listMultiplayerModes: async () => ({ data: [{ id: modeId,enabled: true,key: 'duel' }] }),
    listMultiplayerRooms: async (...args) => { listArgs = args; return { data: [room] }; },createMultiplayerRoom: async () => ({ data: room }),getMultiplayerRoom: async () => ({ data: room }),
    createMultiplayerInvite: async () => ({ data: { code: 'ABCDE-23456',expiresAt: '2026-09-30T00:30:00.000Z' } }),
    joinMultiplayerRoomScoped: async () => { scopedJoinCalls += 1; return { data: room }; },leaveMultiplayerRoom: async () => ({ data: room }),setMultiplayerReady: async () => ({ data: room }),
    startMultiplayerRoom: async () => ({ data: match }),getMultiplayerMatch: async () => ({ data: match }),createRealtimeTicket: async () => ({ data: {} }),
  };
  const bridge = createWebGameMultiplayerHost({ windowImpl: hostWindow,frame: { contentWindow: gameWindow },launchId: crypto.randomUUID(),descriptor: { capabilities: { multiplayer: true } },workId: crypto.randomUUID(),initialRoomId: roomId,apiClient,sessionFactory: () => session,MessageChannelImpl: MessageChannel,logger: { warn() {} } });
  t.after(() => bridge.close());
  const client = createGameHubClient({ windowImpl: gameWindow,parentWindow: hostWindow,requestTimeoutMs: 1_000 });
  t.after(() => client.close());
  await client.connect();
  assert.deepEqual(await client.getPlayer(), { id: 'user-1',displayName: 'Player',avatar: { kind: 'preset' } });
  assert.equal((await client.multiplayer.listModes())[0].id,modeId);
  assert.equal((await client.multiplayer.rooms.current()).id,roomId);
  assert.equal((await client.multiplayer.rooms.invite(roomId)).code,'ABCDE-23456');
  assert.equal((await client.multiplayer.rooms.list(modeId,'Miyazaki'))[0].id,roomId);
  assert.deepEqual(listArgs,[modeId,30,'Miyazaki']);
  await client.multiplayer.rooms.join(roomId,modeId,'ABCDE-23456');
  assert.equal(scopedJoinCalls,1);
  await client.multiplayer.connect();
  const started = await client.multiplayer.rooms.start(roomId);
  assert.equal(started.id,matchId);
  await client.multiplayer.matches.subscribe(matchId);
  await client.multiplayer.matches.command(matchId,{ type: 'move',from: 'a1',to: 'a2' });
  assert.deepEqual(sent.at(-1),['command',matchId,{ type: 'move',from: 'a1',to: 'a2' }]);
  await assert.rejects(client.multiplayer.rooms.join(roomId,crypto.randomUUID()), error => error.code === 'MODE_NOT_ALLOWED');
  assert.equal(scopedJoinCalls,1);
});

test('web game bridge exports approved PNG files outside the sandbox', async t => {
  const { createWebGameMultiplayerHost } = await import('../../packages/platform-client/src/web-game-multiplayer-host.mjs');
  const { createGameHubClient } = await import('../../packages/web-game-sdk/src/index.mjs');
  const hostWindow = eventTarget(); const gameWindow = eventTarget(); gameWindow.parent = hostWindow;
  hostWindow.postMessage = data => hostWindow.dispatch('message', { data,source: gameWindow,ports: [] });
  gameWindow.postMessage = (data, _origin, ports = []) => gameWindow.dispatch('message', { data,source: hostWindow,ports });
  const exported = [];
  const bridge = createWebGameMultiplayerHost({
    windowImpl: hostWindow,frame: { contentWindow: gameWindow },launchId: crypto.randomUUID(),workId: crypto.randomUUID(),
    descriptor: { capabilities: { fileExport: true } },MessageChannelImpl: MessageChannel,
    fileExporter: async file => { exported.push(file); return { accepted: true,filename: file.filename,sizeBytes: file.data.byteLength }; },
  });
  t.after(() => bridge.close());
  const client = createGameHubClient({ windowImpl: gameWindow,parentWindow: hostWindow,requestTimeoutMs: 1_000 });
  t.after(() => client.close());
  const capabilities = await client.connect();
  assert.deepEqual(capabilities, ['fileExport']);
  const result = await client.files.download(new Blob([new Uint8Array([137,80,78,71])], { type: 'image/png' }), '我的-bingo.png');
  assert.deepEqual(result, { accepted: true,filename: '我的-bingo.png',sizeBytes: 4 });
  assert.equal(exported.length, 1);
  assert.equal(exported[0].mimeType, 'image/png');
  assert.deepEqual([...new Uint8Array(exported[0].data)], [137,80,78,71]);
  await assert.rejects(client.getPlayer(), error => error.code === 'BRIDGE_CAPABILITY_REQUIRED');
});

test('web game bridge creates and opens scoped playable share links', async t => {
  const { createWebGameMultiplayerHost } = await import('../../packages/platform-client/src/web-game-multiplayer-host.mjs');
  const { createGameHubClient } = await import('../../packages/web-game-sdk/src/index.mjs');
  const hostWindow = eventTarget(); hostWindow.location = { origin:'https://mooyu.fun' };
  const gameWindow = eventTarget(); gameWindow.parent = hostWindow;
  hostWindow.postMessage = data => hostWindow.dispatch('message', { data,source:gameWindow,ports:[] });
  gameWindow.postMessage = (data,_origin,ports=[]) => gameWindow.dispatch('message', { data,source:hostWindow,ports });
  const workId = crypto.randomUUID(); const code = 'BingoLink123';
  const payload = { kind:'bingo-pack',schemaVersion:1,pack:{ title:'动画 Bingo' } };
  const apiClient = {
    createGameShare: async (id,body) => ({ data:{ code,workId:id,title:body.title,payload:body.payload,createdAt:'2026-10-09T00:00:00.000Z' } }),
    getGameShare: async () => ({ data:{ code,workId,title:'动画 Bingo',payload,createdAt:'2026-10-09T00:00:00.000Z' } }),
  };
  const bridge = createWebGameMultiplayerHost({ windowImpl:hostWindow,frame:{ contentWindow:gameWindow },launchId:crypto.randomUUID(),workId,initialShareCode:code,descriptor:{ capabilities:{ shareLinks:true } },apiClient,MessageChannelImpl:MessageChannel });
  t.after(() => bridge.close());
  const client = createGameHubClient({ windowImpl:gameWindow,parentWindow:hostWindow,requestTimeoutMs:1_000 });
  t.after(() => client.close());
  assert.deepEqual(await client.connect(), ['shareLinks']);
  const created = await client.shares.create('动画 Bingo',payload);
  assert.equal(created.url,`https://mooyu.fun/#/play/${workId}/share/${code}`);
  assert.deepEqual((await client.shares.current()).payload,payload);
});

test('player core creates and closes a bridge only for approved bridge capabilities', async () => {
  const { PlayerCore } = await import('../../packages/player-core/src/index.mjs');
  let created = 0; let closed = 0;
  const frame = { setAttribute() {},addEventListener() {},remove() {},contentWindow: null };
  const container = { ownerDocument: { createElement: () => frame },replaceChildren(child) { child.contentWindow = {}; } };
  const descriptor = { apiVersion: 1,runtimeOrigin: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example',entryUrl: 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.gamehubusercontent.example/index.html',capabilities: { multiplayer: true } };
  const core = new PlayerCore({ createBridge: ({ frame: mountedFrame }) => { assert.ok(mountedFrame.contentWindow); created += 1; return { close() { closed += 1; } }; } });
  core.mount(container,descriptor); core.stop();
  assert.equal(created,1); assert.equal(closed,1);
  core.mount(container,{ ...descriptor,capabilities: { multiplayer: false } }); core.stop();
  assert.equal(created,1);
  core.mount(container,{ ...descriptor,capabilities: { fileExport: true } }); core.stop();
  assert.equal(created,2); assert.equal(closed,2);
  core.mount(container,{ ...descriptor,capabilities: { shareLinks: true } }); core.stop();
  assert.equal(created,3); assert.equal(closed,3);
});
