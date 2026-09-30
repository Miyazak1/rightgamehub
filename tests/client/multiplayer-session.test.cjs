const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const sessionUrl = pathToFileURL(path.join(root, 'packages/platform-client/src/multiplayer-session.mjs'));

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); this.sent = []; FakeWebSocket.instances.push(this); }
  addEventListener(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type,set); }
  emit(type, value = {}) { for (const listener of this.listeners.get(type) ?? []) listener(value); }
  open() { this.readyState = 1; this.emit('open'); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
}

test('multiplayer client obtains fresh tickets, caches room snapshots and resumes after reconnect', async t => {
  const { createMultiplayerSession } = await import(sessionUrl);
  FakeWebSocket.instances = [];
  let ticketCount = 0;
  const apiClient = { createRealtimeTicket: async () => ({ data: { ticket: `ticket-${++ticketCount}-${'x'.repeat(32)}`, websocketUrl: 'wss://mooyu.fun/v1/realtime' } }) };
  const session = createMultiplayerSession({ apiClient, WebSocketImpl: FakeWebSocket, randomUUID: () => crypto.randomUUID(), reconnectDelaysMs: [5], logger: { warn() {} } });
  t.after(() => session.close());
  const connecting = session.connect();
  await new Promise(resolve => setImmediate(resolve));
  const first = FakeWebSocket.instances[0];
  assert.match(first.url, /ticket=ticket-1-/u);
  first.open();
  first.message({ v: 1, id: crypto.randomUUID(), type: 'session.ready', sentAt: new Date().toISOString(), payload: { heartbeatIntervalMs: 20_000 } });
  await connecting;
  const roomId = crypto.randomUUID();
  session.subscribeRoom(roomId);
  assert.equal(first.sent.at(-1).type, 'room.subscribe');
  first.message({ v: 1, id: crypto.randomUUID(), type: 'room.snapshot', sentAt: new Date().toISOString(), roomId, revision: 2, payload: { room: { id: roomId, revision: '2', members: [] } } });
  assert.equal(session.getRoom(roomId).revision, '2');
  session.setReady(roomId, true);
  assert.equal(first.sent.at(-1).expectedRevision, 2);
  const matchId = crypto.randomUUID();
  session.subscribeMatch(matchId);
  assert.equal(first.sent.at(-1).type, 'match.sync.request');
  first.message({ v: 1,id: crypto.randomUUID(),type: 'match.event',sentAt: new Date().toISOString(),matchId,revision: 3,payload: { event: { seq: '3',type: 'match.command.applied' } } });
  first.message({ v: 1,id: crypto.randomUUID(),type: 'match.snapshot',sentAt: new Date().toISOString(),matchId,revision: 3,payload: { match: { id: matchId,revision: '3',nextEventSeq: '4' },state: {},publicState: {},stateHash: 'a'.repeat(64) } });
  session.sendMatchCommand(matchId, { type: 'move' });
  assert.equal(first.sent.at(-1).type, 'match.command');
  assert.equal(first.sent.at(-1).expectedRevision, 3);

  first.close();
  await new Promise(resolve => setTimeout(resolve, 15));
  const second = FakeWebSocket.instances[1];
  assert.match(second.url, /ticket=ticket-2-/u);
  second.open();
  second.message({ v: 1, id: crypto.randomUUID(), type: 'session.ready', sentAt: new Date().toISOString(), payload: { heartbeatIntervalMs: 20_000 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(second.sent[0].type, 'session.resume');
  assert.deepEqual(second.sent[0].payload.roomIds, [roomId]);
  assert.equal(second.sent[1].type, 'match.sync.request');
  assert.equal(second.sent[1].matchId, matchId);
  assert.equal(second.sent[1].payload.afterSeq, 3);
});
