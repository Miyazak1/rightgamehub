const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('timeout worker claims overdue matches idempotently and publishes terminal events', async () => {
  const [{ createMatchTimeoutWorker }, { createRulesRegistry, hashRulesState }] = await Promise.all([
    import('../../apps/realtime/src/match-timeout-worker.mjs'), import('../../packages/rules-sdk/src/index.mjs'),
  ]);
  const matchId = crypto.randomUUID(); const first = crypto.randomUUID(); const second = crypto.randomUUID();
  const now = new Date('2026-09-30T01:00:00.000Z');
  const context = {
    matchId,workId: 'work-timeout',modeKey: 'duel',rulesetVersion: '1',status: 'active',revision: '3',nextEventSeq: '4',
    turnUserId: first,players: [{ userId: first },{ userId: second }],state: { turn: first },
  };
  let transitionOutput; const published = [];
  const repository = {
    listDueMatchIds: async () => [matchId],
    applyTimeout: async input => { transitionOutput = await input.transition(context); return { event: { seq: '4',type: transitionOutput.eventType } }; },
  };
  const adapter = {
    workId: 'work-timeout',modeKey: 'duel',rulesetVersion: '1',
    createInitialState() {},getTurn: state => ({ userId: state.turn,seconds: 30 }),getPlayerView: state => state,getSpectatorView: state => state,
    serializeState: structuredClone,deserializeState: structuredClone,hashState: hashRulesState,validateCommand() {},applyCommand() {},handleResign() {},
    handleTimeout: ({ state,turnUserId,players }) => ({ state,completed: true,event: { timedOutUserId: turnUserId },result: { timedOutUserId: turnUserId },playerResults: players.map(player => ({ userId: player.userId,result: player.userId === turnUserId ? 'loss' : 'win' })) }),
  };
  const worker = createMatchTimeoutWorker({ repository,coordinator: { publish: async (...args) => published.push(args) },rulesRegistry: createRulesRegistry([adapter]),clock: () => now });
  assert.deepEqual(await worker.runOnce(), { processed: 1,skipped: false });
  assert.equal(transitionOutput.completed, true);
  assert.equal(transitionOutput.terminationReason, 'timeout');
  assert.equal(transitionOutput.eventType, 'match.timed_out');
  assert.equal(published[0][0], matchId);
});
