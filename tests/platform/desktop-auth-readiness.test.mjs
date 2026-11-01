import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createDesktopAuthReadiness } from '../../apps/api/src/desktop-auth-readiness.mjs';

function harness(extra = {}) {
  let created = 0, disconnected = 0;
  const clientFactory = options => {
    created++; assert.equal(options.disableOfflineQueue, true); assert.equal(options.socket.reconnectStrategy, false);
    return { isOpen: false, on() {}, async connect() { this.isOpen = true; }, async ping() { return 'PONG'; },
      disconnect() { this.isOpen = false; disconnected++; } };
  };
  const service = createDesktopAuthReadiness({ database: { async ping() { return true; } },
    migrations: { async status() { return { ready: true }; } }, redisUrl: 'redis://unused-test', timeoutMs: 30, clientFactory, ...extra });
  return { service, created: () => created, disconnected: () => disconnected };
}

test('healthy readiness reuses concurrent probes and closes the Redis socket', async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 12 }, () => h.service.check()));
  assert.ok(results.every(value => value.status === 'ready'));
  assert.equal(h.created(), 1); assert.equal(h.disconnected(), 1);
  h.service.close(); assert.equal((await h.service.check()).status, 'not-ready');
});

test('deadline disconnects hung Redis, bounds repeated probes, and recovers after work settles', async () => {
  let finish, calls = 0, disconnected = 0, hanging = true;
  const h = harness({ clientFactory: () => {
    calls++;
    return { isOpen: false, on() {}, async connect() { this.isOpen = true; },
      ping() { return hanging ? new Promise(resolve => { finish = resolve; }) : Promise.resolve('PONG'); },
      disconnect() { this.isOpen = false; disconnected++; } };
  } });
  const started = Date.now();
  assert.equal((await h.service.check()).status, 'not-ready');
  assert.ok(Date.now() - started < 500); assert.equal(disconnected, 1);
  await Promise.all(Array.from({ length: 30 }, () => h.service.check()));
  assert.equal(calls, 1);
  hanging = false; finish('PONG'); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.service.check()).status, 'ready'); assert.equal(calls, 2);
  h.service.close();
});

test('late database probes do not accumulate after the response deadline', async () => {
  let finish, probes = 0;
  const h = harness({ database: { ping() { probes++; return new Promise(resolve => { finish = resolve; }); } } });
  assert.equal((await h.service.check()).status, 'not-ready');
  await Promise.all(Array.from({ length: 20 }, () => h.service.check())); assert.equal(probes, 1);
  finish(true); await new Promise(resolve => setImmediate(resolve)); h.service.close();
});

test('closing cancels a pending readiness response without waiting for Redis and prevents reconnect', async () => {
  let connectCalls = 0, rejectConnect, disconnected = 0;
  const h = harness({ timeoutMs: 10000, clientFactory: () => ({ isOpen: false, on() {},
    connect() { this.isOpen = true; connectCalls++; return new Promise((_resolve, reject) => { rejectConnect = reject; }); },
    async ping() { return 'PONG'; }, disconnect() { this.isOpen = false; disconnected++; rejectConnect(Error('closed')); } }) });
  const pending = h.service.check(); await new Promise(resolve => setImmediate(resolve));
  h.service.close(); assert.equal((await pending).status, 'not-ready');
  assert.equal((await h.service.check()).status, 'not-ready'); assert.equal(connectCalls, 1); assert.equal(disconnected, 1);
  const immediate = harness(); const request = immediate.service.check(); immediate.service.close();
  assert.equal((await request).status, 'not-ready'); assert.equal(immediate.created(), 0);
});

test('unavailable real loopback Redis fails promptly without reconnecting in the background', async () => {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const h = harness({ redisUrl: `redis://127.0.0.1:${port}`, clientFactory: undefined, timeoutMs: 200 });
  try {
    const start = Date.now(); assert.equal((await h.service.check()).status, 'not-ready');
    assert.ok(Date.now() - start < 1500);
  } finally { h.service.close(); }
});
