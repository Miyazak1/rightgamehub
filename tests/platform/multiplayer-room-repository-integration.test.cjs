const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const source = relative => pathToFileURL(path.join(root, relative));
const databaseUrl = process.env.GAMEHUB_TEST_DATABASE_URL;

test('PostgreSQL room lifecycle is capacity-safe and transfers ownership', { skip: !databaseUrl }, async t => {
  const [{ createDatabase }, { PostgresMultiplayerRoomRepository }, { createMultiplayerRoomService }, { PostgresRealtimeRoomRepository }, { PostgresMultiplayerMatchRepository }, { createMultiplayerMatchService }, { createRulesRegistry, hashRulesState }, { PostgresRealtimeMatchRepository }] = await Promise.all([
    import(source('apps/api/src/database.mjs')),
    import(source('apps/api/src/multiplayer-room-repository.mjs')),
    import(source('apps/api/src/multiplayer-room-service.mjs')),
    import(source('apps/realtime/src/room-repository.mjs')),
    import(source('apps/api/src/multiplayer-match-repository.mjs')),
    import(source('apps/api/src/multiplayer-match-service.mjs')),
    import(source('packages/rules-sdk/src/index.mjs')),
    import(source('apps/realtime/src/match-repository.mjs')),
  ]);
  const database = createDatabase({ databaseUrl, databaseSsl: false });
  const ownerId = crypto.randomUUID(); const guestId = crypto.randomUUID(); const thirdId = crypto.randomUUID(); const workId = crypto.randomUUID();
  const repository = new PostgresMultiplayerRoomRepository(database.pool);
  const service = createMultiplayerRoomService({ repository, roomCodeHmacKey: 'integration-room-code-key-at-least-32-bytes' });
  const realtimeRepository = new PostgresRealtimeRoomRepository(database.pool);
  const admin = { userId: ownerId, profile: { role: 'admin' } };
  const owner = { userId: ownerId }; const guest = { userId: guestId }; const third = { userId: thirdId };
  t.after(async () => {
    try {
      await database.pool.query('DELETE FROM idempotency_keys WHERE actor_id = ANY($1::uuid[])', [[ownerId,guestId,thirdId]]);
      await database.pool.query('ALTER TABLE multiplayer_admin_events DISABLE TRIGGER multiplayer_admin_events_no_delete');
      try {
        await database.pool.query('DELETE FROM multiplayer_admin_events WHERE match_id IN (SELECT mt.id FROM multiplayer_matches mt JOIN multiplayer_game_modes gm ON gm.id=mt.mode_id WHERE gm.work_id=$1)', [workId]);
      } finally { await database.pool.query('ALTER TABLE multiplayer_admin_events ENABLE TRIGGER multiplayer_admin_events_no_delete'); }
      await database.pool.query('DELETE FROM multiplayer_matches WHERE mode_id IN (SELECT id FROM multiplayer_game_modes WHERE work_id=$1)', [workId]);
      await database.pool.query('DELETE FROM multiplayer_rooms WHERE mode_id IN (SELECT id FROM multiplayer_game_modes WHERE work_id=$1)', [workId]);
      await database.pool.query('DELETE FROM works WHERE id=$1', [workId]);
      await database.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId,guestId,thirdId]]);
    } finally {
      await database.close();
    }
  });
  await database.pool.query(
    `INSERT INTO users(id,display_name,role,can_publish) VALUES ($1,'Owner','admin',true),($2,'Guest','user',false),($3,'Third','user',false)`,
    [ownerId,guestId,thirdId],
  );
  await database.pool.query(
    `INSERT INTO works(id,owner_user_id,title,kind,state,visibility) VALUES ($1,$2,'Room integration game','game','published','public')`,
    [workId,ownerId],
  );
  const mode = await service.createMode(admin, { workId, key: 'classic', name: '经典模式', authority: 'platform_authoritative', minPlayers: 2, maxPlayers: 2, rulesetVersion: '1', config: { turnSeconds: 60 } });
  const room = await service.createRoom(owner, { modeId: mode.id, visibility: 'public', capacity: 2, settings: { turnSeconds: 60 } }, `room-${crypto.randomUUID()}`);
  const joined = await service.joinRoom(guest, room.id);
  assert.equal(joined.members.length, 2);
  assert.deepEqual(joined.members.map(member => member.seat), [0,1]);
  await assert.rejects(service.joinRoom(third, room.id), error => error.code === 'ROOM_FULL');
  const connected = await realtimeRepository.connectMember({ roomId: room.id, userId: guestId, now: new Date() });
  assert.equal(connected.room.members.find(member => member.userId === guestId).connectionState, 'online');
  const realtimeReady = await realtimeRepository.setReady({ roomId: room.id, userId: guestId, ready: true, expectedRevision: connected.room.revision, now: new Date() });
  assert.equal(realtimeReady.room.members.find(member => member.userId === guestId).ready, true);
  const conflict = await realtimeRepository.setReady({ roomId: room.id, userId: guestId, ready: false, expectedRevision: connected.room.revision, now: new Date() });
  assert.equal(conflict.error, 'revision_conflict');
  assert.equal((await realtimeRepository.setMemberGrace({ roomId: room.id, userId: guestId, now: new Date() })).room.members.find(member => member.userId === guestId).connectionState, 'grace');
  assert.equal((await realtimeRepository.setMemberOffline({ roomId: room.id, userId: guestId, now: new Date() })).room.members.find(member => member.userId === guestId).connectionState, 'offline');
  const ready = await service.setReady(guest, room.id, true);
  assert.equal(ready.members.find(member => member.userId === guestId).ready, true);
  const transferred = await service.leaveRoom(owner, room.id);
  assert.equal(transferred.ownerUserId, guestId);
  const closed = await service.leaveRoom(guest, room.id);
  assert.equal(closed.status, 'closed');

  const invited = await service.createRoom(owner, { modeId: mode.id, visibility: 'invite_only', capacity: 2, settings: {} }, `room-${crypto.randomUUID()}`);
  await assert.rejects(service.joinRoom(guest, invited.id, { joinCode: 'BADCODE12345' }), error => error.code === 'ROOM_CODE_REQUIRED');
  const invitedJoined = await service.joinRoom(guest, invited.id, { joinCode: invited.joinCode });
  assert.equal(invitedJoined.members.length, 2);
  assert.equal((await service.getRoom(guest, invited.id)).id, invited.id);

  const matchRoom = await service.createRoom(owner, { modeId: mode.id, visibility: 'public', capacity: 2, settings: { turnSeconds: 60 } }, `room-${crypto.randomUUID()}`);
  await service.joinRoom(guest, matchRoom.id);
  await service.setReady(owner, matchRoom.id, true);
  await service.setReady(guest, matchRoom.id, true);
  const rulesRegistry = createRulesRegistry([{
    workId, modeKey: 'classic', rulesetVersion: '1',
    createInitialState: input => ({ turnUserId: input.players[0].userId, moves: [] }),
    getTurn: state => ({ userId: state.turnUserId, seconds: 60 }),
    getPlayerView: state => state,
    getSpectatorView: state => ({ turnUserId: state.turnUserId, moveCount: state.moves.length }),
    serializeState: state => structuredClone(state), deserializeState: state => structuredClone(state), hashState: hashRulesState,
    validateCommand: () => ({ valid: true }), applyCommand: state => state, handleResign: state => state, handleTimeout: state => state,
  }]);
  const matchService = createMultiplayerMatchService({ repository: new PostgresMultiplayerMatchRepository(database.pool), rulesRegistry });
  const startKey = `match-${crypto.randomUUID()}`;
  const match = await matchService.startRoom(owner, matchRoom.id, startKey);
  const replayedMatch = await matchService.startRoom(owner, matchRoom.id, startKey);
  assert.equal(match.id, replayedMatch.id);
  assert.equal(match.status, 'active');
  assert.equal(match.publicState.moveCount, 0);
  assert.equal((await database.pool.query('SELECT status FROM multiplayer_rooms WHERE id=$1', [matchRoom.id])).rows[0].status, 'in_match');
  assert.equal((await database.pool.query('SELECT count(*)::int AS count FROM multiplayer_match_events WHERE match_id=$1', [match.id])).rows[0].count, 1);
  assert.equal((await database.pool.query('SELECT count(*)::int AS count FROM multiplayer_match_snapshots WHERE match_id=$1', [match.id])).rows[0].count, 1);
  assert.equal((await matchService.getMatch(guest, match.id)).id, match.id);
  assert.equal((await matchService.listEvents(guest, match.id))[0].type, 'match.started');
  await assert.rejects(matchService.getMatch(third, match.id), error => error.code === 'MATCH_NOT_FOUND');

  const realtimeMatchRepository = new PostgresRealtimeMatchRepository(database.pool);
  const commandId = crypto.randomUUID();
  const commandTime = new Date();
  const command = await realtimeMatchRepository.applyAction({
    matchId: match.id,userId: ownerId,commandId,expectedRevision: 1,now: commandTime,
    transition: async current => {
      const state = { ...current.state,moves: [{ by: ownerId }] };
      return { state,publicState: { turnUserId: guestId,moveCount: 1 },stateHash: hashRulesState(state),eventType: 'match.command.applied',eventPayload: { moveNumber: 1 },completed: false,turnUserId: guestId,turnDeadlineAt: new Date(commandTime.getTime() + 60_000) };
    },
  });
  assert.equal(command.context.revision, '2');
  assert.equal(command.event.seq, '2');
  const replayedCommand = await realtimeMatchRepository.applyAction({
    matchId: match.id,userId: ownerId,commandId,expectedRevision: 1,now: commandTime,
    transition: async () => { throw new Error('duplicate command must not run again'); },
  });
  assert.equal(replayedCommand.replay, true);
  assert.equal(replayedCommand.event.seq, '2');
  const stale = await realtimeMatchRepository.applyAction({
    matchId: match.id,userId: guestId,commandId: crypto.randomUUID(),expectedRevision: 1,now: commandTime,transition: async () => ({}),
  });
  assert.equal(stale.error, 'revision_conflict');
  assert.equal((await realtimeMatchRepository.getSyncState({ matchId: match.id,userId: guestId,afterSeq: 1 })).events.length, 1);
  const timeoutTime = new Date(commandTime.getTime() + 120_000);
  assert.deepEqual(await realtimeMatchRepository.listDueMatchIds({ now: timeoutTime }), [match.id]);
  const timedOut = await realtimeMatchRepository.applyTimeout({
    matchId: match.id,now: timeoutTime,
    transition: async current => ({
      state: current.state,publicState: current.publicState,stateHash: current.stateHash,eventType: 'match.timed_out',eventPayload: { userId: guestId },
      completed: true,terminationReason: 'timeout',result: { timedOutUserId: guestId },playerResults: [{ userId: ownerId,result: 'win' },{ userId: guestId,result: 'loss' }],
    }),
  });
  assert.equal(timedOut.context.status, 'completed');
  assert.equal(timedOut.event.seq, '3');
  assert.equal((await database.pool.query('SELECT status FROM multiplayer_rooms WHERE id=$1', [matchRoom.id])).rows[0].status, 'closed');
  assert.equal((await database.pool.query('SELECT termination_reason FROM multiplayer_matches WHERE id=$1', [match.id])).rows[0].termination_reason, 'timeout');
  assert.equal((await realtimeMatchRepository.applyTimeout({ matchId: match.id,now: timeoutTime,transition: async () => { throw new Error('must not run twice'); } })).stale, true);

  const abortRoom = await service.createRoom(owner, { modeId: mode.id,visibility: 'public',capacity: 2,settings: { turnSeconds: 60 } }, `room-${crypto.randomUUID()}`);
  await service.joinRoom(guest, abortRoom.id); await service.setReady(owner,abortRoom.id,true); await service.setReady(guest,abortRoom.id,true);
  const abortMatch = await matchService.startRoom(owner, abortRoom.id, `match-${crypto.randomUUID()}`);
  const aborted = await new PostgresMultiplayerMatchRepository(database.pool).abortMatch({
    matchId: abortMatch.id,actorUserId: ownerId,reason: 'integration governance test',auditId: crypto.randomUUID(),now: new Date(),
  });
  assert.equal(aborted.match.status, 'aborted');
  assert.equal(aborted.event.type, 'match.aborted');
  assert.equal((await database.pool.query('SELECT count(*)::int AS count FROM multiplayer_admin_events WHERE match_id=$1', [abortMatch.id])).rows[0].count, 1);
  await assert.rejects(database.pool.query("UPDATE multiplayer_admin_events SET reason='changed' WHERE match_id=$1", [abortMatch.id]), /append-only/u);
});
