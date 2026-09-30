const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const message = (type, matchId, fields = {}) => ({ v: 1,id: crypto.randomUUID(),type,matchId,payload: {},...fields });
const socketFor = userId => ({ readyState: 1,session: { userId },matchIds: new Set(),messages: [],send(raw) { this.messages.push(JSON.parse(raw)); } });

test('match session manager syncs private views and serializes authoritative commands', async () => {
  const [{ createMatchSessionManager }, { createRulesRegistry, hashRulesState }] = await Promise.all([
    import('../../apps/realtime/src/match-session-manager.mjs'), import('../../packages/rules-sdk/src/index.mjs'),
  ]);
  const matchId = crypto.randomUUID(); const first = crypto.randomUUID(); const second = crypto.randomUUID();
  let context = {
    matchId,roomId: crypto.randomUUID(),modeId: crypto.randomUUID(),workId: 'work-1',modeKey: 'duel',rulesetVersion: '1',
    status: 'active',revision: '1',nextEventSeq: '2',turnUserId: first,turnDeadlineAt: new Date('2026-09-30T00:01:00Z'),result: null,
    players: [{ userId: first,displayName: 'One',seat: 0,team: null,result: null },{ userId: second,displayName: 'Two',seat: 1,team: null,result: null }],
    state: { value: 0,turn: first },publicState: { value: 0 },stateHash: hashRulesState({ value: 0,turn: first }),
  };
  const events = [{ seq: '1',type: 'match.started',actorUserId: first,commandId: null,payload: {},stateHash: context.stateHash,createdAt: '2026-09-30T00:00:00.000Z' }];
  const seen = new Map();
  const repository = {
    ping: async () => true,
    getSyncState: async ({ userId,afterSeq }) => context.players.some(player => player.userId === userId) ? { context,events: events.filter(event => Number(event.seq) > afterSeq) } : { error: 'not_member' },
    applyAction: async ({ userId,commandId,expectedRevision,now,transition }) => {
      if (seen.has(commandId)) return { replay: true,event: seen.get(commandId),context };
      if (String(expectedRevision) !== context.revision) return { error: 'revision_conflict',context };
      const output = await transition(context); const event = { seq: context.nextEventSeq,type: output.eventType,actorUserId: userId,commandId,payload: output.eventPayload,stateHash: output.stateHash,createdAt: now.toISOString() };
      context = { ...context,status: output.completed ? 'completed' : 'active',revision: String(BigInt(context.revision) + 1n),nextEventSeq: String(BigInt(context.nextEventSeq) + 1n),state: output.state,publicState: output.publicState,stateHash: output.stateHash,turnUserId: output.turnUserId,turnDeadlineAt: output.turnDeadlineAt,result: output.result };
      events.push(event); seen.set(commandId,event); return { event,context };
    },
  };
  let listener;
  const coordinator = { start: async fn => { listener = fn; return () => {}; },ping: async () => true,publish: async (id,signal) => listener(id,signal) };
  const adapter = {
    workId: 'work-1',modeKey: 'duel',rulesetVersion: '1',
    createInitialState() {},serializeState: structuredClone,deserializeState: structuredClone,hashState: hashRulesState,
    getTurn: state => ({ userId: state.turn,seconds: 30 }),
    getPlayerView: (state,userId) => ({ value: state.value,privateFor: userId }),getSpectatorView: state => ({ value: state.value }),
    validateCommand: ({ state,actorUserId }) => ({ valid: state.turn === actorUserId,code: 'NOT_YOUR_TURN' }),
    applyCommand: ({ state,players }) => ({ state: { value: state.value + 1,turn: players.find(player => player.userId !== state.turn).userId },event: { move: state.value + 1 } }),
    handleResign: ({ state,actorUserId,players }) => ({ state,completed: true,event: { userId: actorUserId },terminationReason: 'resignation',result: { resignedUserId: actorUserId },playerResults: players.map(player => ({ userId: player.userId,result: player.userId === actorUserId ? 'loss' : 'win' })) }),
    handleTimeout() {},
  };
  const manager = createMatchSessionManager({ repository,coordinator,rulesRegistry: createRulesRegistry([adapter]),clock: () => new Date('2026-09-30T00:00:10Z') });
  await manager.start();
  const socket = socketFor(first);
  await manager.handle(socket, message('match.sync.request', matchId, { payload: { afterSeq: 0 } }));
  assert.ok(socket.messages.some(item => item.type === 'match.snapshot' && item.payload.state.privateFor === first));
  const command = message('match.command', matchId, { expectedRevision: 1,payload: { command: { type: 'move' } } });
  await manager.handle(socket, command);
  assert.equal(context.revision, '2');
  assert.equal(context.state.value, 1);
  assert.ok(socket.messages.some(item => item.type === 'match.event' && item.payload.event.commandId === command.id));
  assert.ok(socket.messages.some(item => item.type === 'command.ack' && item.causedBy === command.id));
  manager.close();
});

test('match session manager rejects stale revisions before invoking game rules', async () => {
  const { createMatchSessionManager } = await import('../../apps/realtime/src/match-session-manager.mjs');
  const matchId = crypto.randomUUID(); const userId = crypto.randomUUID(); let applied = false;
  const repository = {
    ping: async () => true,
    getSyncState: async () => ({ context: { matchId,workId: 'w',modeKey: 'm',rulesetVersion: '1',revision: '4',state: {},players: [] },events: [] }),
    applyAction: async () => ({ error: 'revision_conflict',context: { revision: '4' } }),
  };
  const coordinator = { start: async () => () => {},ping: async () => true,publish: async () => {} };
  const manager = createMatchSessionManager({ repository,coordinator,rulesRegistry: { get: () => ({ applyCommand() { applied = true; } }) } });
  const socket = socketFor(userId); socket.matchIds.add(matchId);
  const command = message('match.command', matchId, { expectedRevision: 3,payload: { command: { type: 'move' } } });
  await manager.handle(socket, command);
  assert.equal(applied, false);
  assert.equal(socket.messages.at(-1).payload.code, 'REVISION_CONFLICT');
});
