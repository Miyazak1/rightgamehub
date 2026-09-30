const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const modulePath = '../../apps/api/src/multiplayer-room-service.mjs';
const key = 'room-code-test-key-that-is-at-least-32-bytes';
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const baseRoom = overrides => ({
  id: id(3), modeId: id(2), ownerUserId: id(1), visibility: 'public', status: 'open', capacity: 2,
  settings: {}, revision: '0', expiresAt: '2026-09-30T00:30:00.000Z', createdAt: '2026-09-30T00:00:00.000Z', members: [], ...overrides,
});

test('room service creates deterministic invite codes without persisting plaintext', async () => {
  const { createMultiplayerRoomService } = await import(modulePath);
  const calls = [];
  const repository = { createRoomIdempotent: async input => { calls.push(input); return baseRoom({ id: input.roomId, visibility: input.visibility }); } };
  const make = () => createMultiplayerRoomService({ repository, roomCodeHmacKey: key, ids: () => id(3), clock: () => new Date('2026-09-30T00:00:00.000Z') });
  const actor = { userId: id(1) };
  const input = { modeId: id(2), visibility: 'invite_only', capacity: 2, settings: { turnSeconds: 60 } };
  const first = await make().createRoom(actor, input, 'room-create-key-0001');
  const second = await make().createRoom(actor, input, 'room-create-key-0001');
  assert.match(first.joinCode, /^[A-Za-z0-9_-]{12}$/u);
  assert.equal(second.joinCode, first.joinCode);
  assert.ok(Buffer.isBuffer(calls[0].joinCodeDigest));
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(first.joinCode, 'u'));
  assert.equal(calls[0].expiresAt.toISOString(), '2026-09-30T00:30:00.000Z');
});

test('room service restricts mode creation to admins and validates player range', async () => {
  const { createMultiplayerRoomService } = await import(modulePath);
  const service = createMultiplayerRoomService({ repository: { createMode: async input => input }, roomCodeHmacKey: key });
  const input = { workId: id(1), key: 'classic', name: '经典', authority: 'platform_authoritative', minPlayers: 2, maxPlayers: 2, rulesetVersion: '1' };
  await assert.rejects(service.createMode({ userId: id(1), profile: { role: 'user' } }, input), error => error.code === 'ADMIN_REQUIRED');
  await assert.rejects(service.createMode({ userId: id(1), profile: { role: 'admin' } }, { ...input, minPlayers: 4, maxPlayers: 2 }), error => error.code === 'PLAYER_RANGE_INVALID');
  assert.equal((await service.createMode({ userId: id(1), profile: { role: 'admin' } }, input)).key, 'classic');
});

test('room service maps repository join and state failures to stable API errors', async () => {
  const { createMultiplayerRoomService } = await import(modulePath);
  let result = { error: 'full' };
  const service = createMultiplayerRoomService({ repository: {
    joinRoom: async () => result, leaveRoom: async () => result, setReady: async () => result,
  }, roomCodeHmacKey: key });
  const actor = { userId: crypto.randomUUID() };
  await assert.rejects(service.joinRoom(actor, crypto.randomUUID()), error => error.code === 'ROOM_FULL' && error.statusCode === 409);
  result = { error: 'not_open' };
  await assert.rejects(service.leaveRoom(actor, crypto.randomUUID()), error => error.code === 'ROOM_NOT_OPEN');
  await assert.rejects(service.setReady(actor, crypto.randomUUID(), true), error => error.code === 'ROOM_NOT_OPEN');
});

test('room service scopes joins to the caller supplied multiplayer mode', async () => {
  const { createMultiplayerRoomService } = await import(modulePath);
  let received;
  const repository = { joinRoom: async input => { received = input; return { error: 'not_found' }; } };
  const service = createMultiplayerRoomService({ repository, roomCodeHmacKey: key, clock: () => new Date('2026-09-30T00:00:00.000Z') });
  const actor = { userId: id(1) };
  const roomId = id(3);
  const modeId = id(2);
  await assert.rejects(service.joinRoom(actor, roomId, { modeId }), error => error.code === 'ROOM_NOT_FOUND' && error.statusCode === 404);
  assert.equal(received.roomId, roomId);
  assert.equal(received.expectedModeId, modeId);
});

test('built-in non-UUID work keys return no database-backed multiplayer modes', async () => {
  const { createMultiplayerRoomService } = await import(modulePath);
  let called = false;
  const service = createMultiplayerRoomService({ repository: { listModes: async () => { called = true; return []; } }, roomCodeHmacKey: key });
  assert.deepEqual(await service.listModes('gamehub-guess-baike'), []);
  assert.equal(called, false);
});
