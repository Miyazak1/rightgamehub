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
  let scopedJoinCalls = 0; const sessionListeners = new Map(); const sent = [];
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
    listMultiplayerRooms: async () => ({ data: [room] }),createMultiplayerRoom: async () => ({ data: room }),getMultiplayerRoom: async () => ({ data: room }),
    createMultiplayerInvite: async () => ({ data: { token: 'a'.repeat(32),expiresAt: '2026-09-30T00:30:00.000Z' } }),
    joinMultiplayerRoomScoped: async () => { scopedJoinCalls += 1; return { data: room }; },leaveMultiplayerRoom: async () => ({ data: room }),setMultiplayerReady: async () => ({ data: room }),
    startMultiplayerRoom: async () => ({ data: match }),getMultiplayerMatch: async () => ({ data: match }),createRealtimeTicket: async () => ({ data: {} }),
  };
  const bridge = createWebGameMultiplayerHost({ windowImpl: hostWindow,frame: { contentWindow: gameWindow },launchId: crypto.randomUUID(),workId: crypto.randomUUID(),initialRoomId: roomId,apiClient,sessionFactory: () => session,MessageChannelImpl: MessageChannel,logger: { warn() {} } });
  t.after(() => bridge.close());
  const client = createGameHubClient({ windowImpl: gameWindow,parentWindow: hostWindow,requestTimeoutMs: 1_000 });
  t.after(() => client.close());
  await client.connect();
  assert.deepEqual(await client.getPlayer(), { id: 'user-1',displayName: 'Player',avatar: { kind: 'preset' } });
  assert.equal((await client.multiplayer.listModes())[0].id,modeId);
  assert.equal((await client.multiplayer.rooms.current()).id,roomId);
  assert.equal((await client.multiplayer.rooms.invite(roomId)).url,`https://mooyu.fun/#/invite/${'a'.repeat(32)}`);
  await client.multiplayer.rooms.join(roomId,modeId,'abcdefghijkl');
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

test('player core creates and closes a bridge only for an approved multiplayer release', async () => {
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
});
