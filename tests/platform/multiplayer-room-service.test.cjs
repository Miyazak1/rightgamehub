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

test('room service refuses a platform-authoritative mode whose rules are not trusted', async () => {
  const { createMultiplayerRoomService } = await import(modulePath);
  let created = false;
  const service = createMultiplayerRoomService({
    repository: { createMode: async input => { created = true; return input; } },roomCodeHmacKey: key,
    rulesRegistry: { get: () => null },
  });
  const input = { workId: id(1),key: 'classic',name: '经典',authority: 'platform_authoritative',minPlayers: 2,maxPlayers: 2,rulesetVersion: '1' };
  await assert.rejects(service.createMode({ userId: id(1),profile: { role: 'admin' } }, input), error => error.code === 'RULESET_NOT_AVAILABLE' && error.statusCode === 409);
  assert.equal(created,false);
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

test('room invites store only a digest and map first-claim conflicts', async () => {
  const { createMultiplayerRoomService } = await import(modulePath);
  let rotated; let claimed;
  const repository = {
    rotateInvite: async input => { rotated = input; return { expiresAt: '2026-09-30T00:30:00.000Z' }; },
    claimInvite: async input => { claimed = input; return { room: baseRoom({ visibility: 'invite_only' }),workId: id(9) }; },
  };
  const service = createMultiplayerRoomService({ repository,roomCodeHmacKey: key,ids: () => id(8),clock: () => new Date('2026-09-30T00:00:00.000Z') });
  const created = await service.createInvite({ userId: id(1) },id(3));
  assert.match(created.token,/^[A-Za-z0-9_-]{32}$/u);
  assert.ok(Buffer.isBuffer(rotated.tokenDigest));
  assert.doesNotMatch(JSON.stringify(rotated),new RegExp(created.token,'u'));
  const result = await service.claimInvite({ userId: id(4) },created.token);
  assert.equal(result.workId,id(9)); assert.ok(Buffer.isBuffer(claimed.tokenDigest));
  repository.claimInvite = async () => ({ error: 'claimed' });
  await assert.rejects(service.claimInvite({ userId: id(5) },created.token),error => error.code === 'INVITE_CLAIMED' && error.statusCode === 409);
});
