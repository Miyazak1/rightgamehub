const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const protocolUrl = pathToFileURL(path.join(root, 'packages/multiplayer-protocol/src/index.mjs'));

test('realtime protocol accepts strict heartbeat envelopes', async () => {
  const { parseClientMessage } = await import(protocolUrl);
  const message = { v: 1, id: crypto.randomUUID(), type: 'heartbeat.ping', sentAt: new Date().toISOString(), payload: {} };
  assert.deepEqual(parseClientMessage(JSON.stringify(message)), message);
});

test('realtime protocol rejects unknown fields, versions and oversized messages', async () => {
  const { parseClientMessage, RealtimeProtocolError } = await import(protocolUrl);
  const base = { v: 1, id: crypto.randomUUID(), type: 'heartbeat.ping', payload: {} };
  assert.throws(() => parseClientMessage(JSON.stringify({ ...base, accessToken: 'secret' })), error => error instanceof RealtimeProtocolError && error.code === 'MESSAGE_FIELD_UNKNOWN');
  assert.throws(() => parseClientMessage(JSON.stringify({ ...base, v: 2 })), error => error.code === 'PROTOCOL_VERSION_UNSUPPORTED');
  assert.throws(() => parseClientMessage(JSON.stringify({ ...base, payload: { value: 'x'.repeat(17_000) } })), error => error.code === 'MESSAGE_TOO_LARGE');
});

test('server messages always carry protocol metadata', async () => {
  const { createServerMessage } = await import(protocolUrl);
  const message = createServerMessage('session.ready', { userId: crypto.randomUUID() });
  assert.equal(message.v, 1);
  assert.match(message.id, /^[0-9a-f-]{36}$/u);
  assert.equal(message.type, 'session.ready');
  assert.ok(Number.isFinite(Date.parse(message.sentAt)));
});
