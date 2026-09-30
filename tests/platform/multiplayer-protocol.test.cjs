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

test('room commands require bounded semantic payloads', async () => {
  const { parseClientMessage } = await import(protocolUrl);
  const roomId = crypto.randomUUID();
  const base = { v: 1, id: crypto.randomUUID(), type: 'room.ready', roomId, payload: { ready: true } };
  assert.equal(parseClientMessage(JSON.stringify(base)).payload.ready, true);
  assert.throws(() => parseClientMessage(JSON.stringify({ ...base, roomId: undefined })), error => error.code === 'MESSAGE_REFERENCE_REQUIRED');
  assert.throws(() => parseClientMessage(JSON.stringify({ ...base, payload: { ready: true, admin: true } })), error => error.code === 'MESSAGE_PAYLOAD_INVALID');
  const resume = { v: 1, id: crypto.randomUUID(), type: 'session.resume', payload: { roomIds: [roomId] } };
  assert.deepEqual(parseClientMessage(JSON.stringify(resume)).payload.roomIds, [roomId]);
  assert.throws(() => parseClientMessage(JSON.stringify({ ...resume, payload: { roomIds: ['bad'] } })), error => error.code === 'MESSAGE_PAYLOAD_INVALID');
});

test('match commands require a match, revision and bounded command envelope', async () => {
  const { parseClientMessage } = await import(protocolUrl);
  const matchId = crypto.randomUUID();
  const command = { v: 1, id: crypto.randomUUID(), type: 'match.command', matchId, expectedRevision: 3, payload: { command: { type: 'move', from: 'a1', to: 'a2' } } };
  assert.equal(parseClientMessage(JSON.stringify(command)).expectedRevision, 3);
  assert.throws(() => parseClientMessage(JSON.stringify({ ...command, matchId: undefined })), error => error.code === 'MESSAGE_REFERENCE_REQUIRED');
  assert.throws(() => parseClientMessage(JSON.stringify({ ...command, expectedRevision: undefined })), error => error.code === 'MESSAGE_PAYLOAD_INVALID');
  assert.throws(() => parseClientMessage(JSON.stringify({ ...command, payload: { command: {}, secret: true } })), error => error.code === 'MESSAGE_PAYLOAD_INVALID');
  const resign = { v: 1, id: crypto.randomUUID(), type: 'match.resign', matchId, expectedRevision: 4, payload: {} };
  assert.equal(parseClientMessage(JSON.stringify(resign)).type, 'match.resign');
  const sync = { v: 1, id: crypto.randomUUID(), type: 'match.sync.request', matchId, payload: { afterSeq: 9 } };
  assert.equal(parseClientMessage(JSON.stringify(sync)).payload.afterSeq, 9);
});
