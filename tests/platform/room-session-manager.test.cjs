const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const managerUrl = pathToFileURL(path.join(root, 'apps/realtime/src/room-session-manager.mjs'));
const roomId = '00000000-0000-4000-8000-000000000051';
const userId = '00000000-0000-4000-8000-000000000052';
const baseRoom = state => ({
  id: roomId, modeId: crypto.randomUUID(), ownerUserId: userId, visibility: 'public', status: 'open', capacity: 2,
  settings: {}, revision: String(state.revision), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(),
  members: [{ userId, displayName: 'Player', seat: 0, role: 'player', ready: state.ready, connectionState: state.connectionState, joinedAt: new Date().toISOString() }],
});
const socketFor = connectionId => {
  const sent = [];
  return { readyState: 1, connectionId, session: { userId }, roomIds: new Set(), sent, send(value) { sent.push(JSON.parse(value)); } };
};

test('room realtime manager broadcasts state and preserves the seat during reconnect grace', async t => {
  const { createRoomSessionManager } = await import(managerUrl);
  const state = { revision: 0, ready: false, connectionState: 'offline', offlineCalls: 0 };
  let subscriber;
  const presence = new Set();
  const coordinator = {
    start: async listener => { subscriber = listener; return () => { subscriber = null; }; },
    ping: async () => true,
    publish: async (id, message) => { subscriber?.(id, message); },
    registerPresence: async input => { presence.add(input.connectionId); return presence.size; },
    removePresence: async input => { presence.delete(input.connectionId); return presence.size; },
    countPresence: async () => presence.size,
  };
  const change = connectionState => { const changed = state.connectionState !== connectionState; state.connectionState = connectionState; if (changed) state.revision += 1; return { room: baseRoom(state), changed, userId }; };
  const repository = {
    ping: async () => true,
    connectMember: async () => change('online'),
    setMemberGrace: async () => change('grace'),
    setMemberOffline: async () => { state.offlineCalls += 1; return change('offline'); },
    setReady: async ({ ready, expectedRevision }) => {
      if (String(expectedRevision) !== String(state.revision)) return { error: 'revision_conflict', revision: String(state.revision), room: baseRoom(state) };
      const changed = state.ready !== ready; state.ready = ready; if (changed) state.revision += 1;
      return { room: baseRoom(state), changed, userId };
    },
  };
  const manager = createRoomSessionManager({ repository, coordinator, heartbeatIntervalMs: 5, reconnectGraceMs: 25, logger: { error() {} } });
  t.after(() => manager.close());
  await manager.start();
  const first = socketFor('connection-one');
  const subscribe = { v: 1, id: crypto.randomUUID(), type: 'room.subscribe', roomId, payload: {} };
  await manager.handle(first, subscribe);
  assert.ok(first.sent.some(message => message.type === 'room.snapshot'));
  assert.ok(first.sent.some(message => message.type === 'command.ack'));
  await manager.handle(first, { v: 1, id: crypto.randomUUID(), type: 'room.ready', roomId, expectedRevision: state.revision, payload: { ready: true } });
  assert.equal(state.ready, true);
  await manager.disconnect(first);
  assert.equal(state.connectionState, 'grace');

  const second = socketFor('connection-two');
  await manager.handle(second, { ...subscribe, id: crypto.randomUUID() });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(state.offlineCalls, 0);
  assert.equal(state.connectionState, 'online');

  await manager.disconnect(second);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(state.offlineCalls, 1);
  assert.equal(state.connectionState, 'offline');
});
