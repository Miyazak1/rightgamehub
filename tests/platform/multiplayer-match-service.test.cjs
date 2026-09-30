const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const context = overrides => ({
  roomId: '00000000-0000-4000-8000-000000000101',
  modeId: '00000000-0000-4000-8000-000000000102',
  ownerUserId: '00000000-0000-4000-8000-000000000103',
  workId: '00000000-0000-4000-8000-000000000104',
  modeKey: 'duel', rulesetVersion: '1.0.0', authority: 'platform_authoritative',
  minPlayers: 2, maxPlayers: 2, settings: { turnSeconds: 45 },
  players: [
    { userId: '00000000-0000-4000-8000-000000000103', seat: 0, ready: true },
    { userId: '00000000-0000-4000-8000-000000000105', seat: 1, ready: true },
  ],
  ...overrides,
});

test('match service creates a server-seeded initial snapshot without persisting the seed', async () => {
  const { createMultiplayerMatchService } = await import('../../apps/api/src/multiplayer-match-service.mjs');
  const inputContext = context();
  let adapterInput; let persisted;
  const adapter = {
    createInitialState(input) { adapterInput = input; return { turn: input.players[0].userId, seedDigest: crypto.createHash('sha256').update(input.seed).digest('hex') }; },
    serializeState: value => value,
    deserializeState: value => structuredClone(value),
    hashState: value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    getSpectatorView: value => ({ turn: value.turn }),
    getTurn: value => ({ userId: value.turn, seconds: 45 }),
  };
  const repository = {
    getStartContext: async () => inputContext,
    startMatchIdempotent: async value => { persisted = value; return { id: value.matchId, status: 'active' }; },
  };
  const service = createMultiplayerMatchService({
    repository, rulesRegistry: { get: () => adapter },
    ids: () => '00000000-0000-4000-8000-000000000106',
    randomBytes: () => Buffer.alloc(32, 7), clock: () => new Date('2026-09-30T00:00:00.000Z'),
  });
  const result = await service.startRoom({ userId: inputContext.ownerUserId }, inputContext.roomId, 'match-start-test-0001');
  assert.equal(result.status, 'active');
  assert.equal(adapterInput.seed, Buffer.alloc(32, 7).toString('base64url'));
  assert.equal(persisted.seed, undefined);
  assert.equal(Buffer.isBuffer(persisted.seedHash), true);
  assert.equal(persisted.turnDeadlineAt.toISOString(), '2026-09-30T00:00:45.000Z');
  assert.deepEqual(persisted.publicState, { turn: inputContext.players[0].userId });
});

test('match service refuses unready rooms and unavailable rulesets', async () => {
  const { createMultiplayerMatchService, MultiplayerMatchError } = await import('../../apps/api/src/multiplayer-match-service.mjs');
  const actor = { userId: context().ownerUserId };
  const unavailable = createMultiplayerMatchService({ repository: { getStartContext: async () => context() }, rulesRegistry: { get: () => null } });
  await assert.rejects(unavailable.startRoom(actor, context().roomId, 'match-start-test-0002'), error => error instanceof MultiplayerMatchError && error.code === 'RULESET_NOT_AVAILABLE');
  const unready = createMultiplayerMatchService({ repository: { getStartContext: async () => context({ players: context().players.map((player, index) => ({ ...player, ready: index === 0 })) }) }, rulesRegistry: { get: () => ({}) } });
  await assert.rejects(unready.startRoom(actor, context().roomId, 'match-start-test-0003'), error => error instanceof MultiplayerMatchError && error.code === 'PLAYERS_NOT_READY');
});
