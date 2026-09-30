const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const serverUrl = pathToFileURL(path.join(root, 'apps/realtime/src/realtime-server.mjs'));

const nextMessage = socket => new Promise((resolve, reject) => {
  socket.once('message', value => resolve(JSON.parse(value.toString())));
  socket.once('error', reject);
});

test('realtime server consumes a one-time ticket and answers heartbeats', async t => {
  const [{ createRealtimeServer }, { WebSocket }] = await Promise.all([
    import(serverUrl),
    import(pathToFileURL(path.join(root, 'apps/realtime/node_modules/ws/wrapper.mjs'))),
  ]);
  const rawTicket = crypto.randomBytes(32).toString('base64url');
  let consumed = false;
  const ticketStore = {
    ping: async () => true,
    consume: async () => {
      if (consumed) return null;
      consumed = true;
      return { userId: crypto.randomUUID(), scopes: [], expiresAt: new Date(Date.now() + 30_000).toISOString() };
    },
  };
  const realtime = createRealtimeServer({ ticketStore, heartbeatIntervalMs: 5_000, logger: { error() {}, warn() {} } });
  t.after(() => realtime.close());
  const address = await realtime.listen({ host: '127.0.0.1', port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/realtime?ticket=${rawTicket}`);
  t.after(() => socket.close());
  const ready = await nextMessage(socket);
  assert.equal(ready.type, 'session.ready');
  assert.equal(ready.payload.protocol, 'gamehub.realtime.v1');

  const commandId = crypto.randomUUID();
  socket.send(JSON.stringify({ v: 1, id: commandId, type: 'heartbeat.ping', payload: {} }));
  const pong = await nextMessage(socket);
  assert.equal(pong.type, 'heartbeat.pong');
  assert.equal(pong.payload.receivedMessageId, commandId);
});

test('realtime server exposes liveness and Redis-backed readiness', async t => {
  const { createRealtimeServer } = await import(serverUrl);
  const realtime = createRealtimeServer({ ticketStore: { consume: async () => null, ping: async () => true }, logger: { error() {}, warn() {} } });
  t.after(() => realtime.close());
  const address = await realtime.listen({ host: '127.0.0.1', port: 0 });
  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  const ready = await fetch(`http://127.0.0.1:${address.port}/ready`);
  assert.equal(health.status, 200);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).data.redis, true);
});
