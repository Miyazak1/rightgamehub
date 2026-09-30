const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root, 'apps/api/src/realtime-ticket-service.mjs'));

test('realtime tickets are opaque, short-lived and stored only by hash', async () => {
  const { createRealtimeTicketService, hashRealtimeTicket } = await import(moduleUrl);
  const calls = [];
  const now = new Date('2026-09-30T00:00:00.000Z');
  const service = createRealtimeTicketService({
    store: { put: async (...args) => calls.push(args), ping: async () => true },
    websocketUrl: 'wss://mooyu.fun/v1/realtime',
    ttlSeconds: 30,
    clock: () => now,
    randomBytes: () => Buffer.alloc(32, 7),
  });
  const result = await service.issue({ userId: crypto.randomUUID(), grantId: crypto.randomUUID(), scopes: ['works:read'] });
  assert.equal(result.protocol, 'gamehub.realtime.v1');
  assert.equal(result.websocketUrl, 'wss://mooyu.fun/v1/realtime');
  assert.equal(result.expiresAt, '2026-09-30T00:00:30.000Z');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], hashRealtimeTicket(result.ticket));
  assert.equal(calls[0][2], 30);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(result.ticket, 'u'));
  assert.equal(await service.ready(), true);
});

test('realtime ticket issuance requires an authenticated actor', async () => {
  const { createRealtimeTicketService } = await import(moduleUrl);
  const service = createRealtimeTicketService({ store: { put: async () => {} }, websocketUrl: 'ws://localhost:3093/v1/realtime' });
  await assert.rejects(service.issue(null), error => error.code === 'AUTH_REQUIRED' && error.statusCode === 401);
});
