import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createAgentMemoryReadOnlyService } from '../../apps/api/src/agent-memory-readonly.mjs';
import { normalizeMemoryRead, normalizeMemoryReference } from '../../apps/api/src/agent-memory-readonly-contracts.mjs';
import { withAgentMemoryReadOnly } from '../../apps/api/src/agent-memory-readonly-transaction.mjs';

const id = () => crypto.randomUUID();
function fixture({ readonly = 'on', revoke = false, failData = false } = {}) {
  const agentId = id(), interactionId = id(), previousId = id(), actorRef = id(), conversationRef = id();
  const calls = []; let released = 0, authorized = 0;
  const pool = { async connect() { return { release: () => { released++; }, async query(sql, params) {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return { rows: [] };
    if (sql.includes("current_setting('transaction_read_only')")) return { rows: [{ read_only: readonly }] };
    if (sql.startsWith('SELECT id,agent_user_id')) return { rows: [{ id: interactionId, kind: 'message', created_at: new Date('2026-11-28T10:00:00Z') }] };
    if (sql.startsWith('SELECT message.id')) { if (failData) throw Error('SYNTHETIC_DATABASE_FAILURE'); return { rows: [{ id: previousId,
      input_json: { message: '原始提问' }, result_json: { reply: '原始回答' }, input_sha256: 'a'.repeat(64), run_id: null,
      created_at: new Date('2026-11-28T09:00:00Z'), task_result: null }] }; }
    throw Error('UNEXPECTED_FIXTURE_QUERY');
  } }; } };
  const interactionService = { agentId, async authorize() {
    authorized++; if (revoke && authorized > 1) throw Object.assign(Error('DENIED'), { code: 'AGENT_INTERACTION_CHANNEL_DENIED' });
    return { agent: { id: agentId } };
  } };
  const reader = createAgentMemoryReadOnlyService({ pool, interactionService, clock: () => new Date('2026-11-28T12:00:00Z') });
  const access = { origin: { channel: 'web', platformUserId: actorRef, actorRef, conversationRef, eventRef: id() }, interactionId };
  return { reader, pool, calls, access, agentId, previousId, released: () => released, authorized: () => authorized };
}

test('D1 contracts reject unknown types, elevated scope, writes, unbounded reads and malformed source references', () => {
  for (const value of [null, {}, { kind: 'paper' }, { kind: 'conversation', limit: 5 }, { kind: 'research', limit: 51 },
    { kind: 'editorial', limit: 201 }, { kind: 'research', use: 'publish' }, { kind: 'conversation', use: 'analysis' },
    { kind: 'research', agentId: id() }, { kind: 'research', owner: 'all' }, { kind: 'editorial', includePrivate: true }]) assert.throws(() => normalizeMemoryRead(value));
  assert.equal(normalizeMemoryRead({ kind: 'conversation' }).limit, 4);
  assert.equal(normalizeMemoryRead({ kind: 'research' }).limit, 20);
  assert.throws(() => normalizeMemoryReference({ kind: 'research', bindingId: id(), evidenceId: "x';DELETE" }, 'research'));
  assert.throws(() => normalizeMemoryReference({ kind: 'unknown', subjectKind: 'claim', subjectKey: 'claim:x', eventId: id() }, 'unknown'));
  assert.throws(() => normalizeMemoryReference({ kind: 'conversation', interactionId: id(), part: 'reply', taskId: id() }, 'conversation'));
  assert.throws(() => normalizeMemoryRead({ kind: 'research', reference: { kind: 'research', bindingId: id(), evidenceId: id(), table: 'users' } }));
});

test('D1 retains the legacy conversation envelope and exposes source hashes without claiming channel delivery', async () => {
  const f = fixture(), snapshot = await f.reader.read(f.access, { kind: 'conversation' });
  assert.deepEqual(snapshot.compatibility.history, [{ role: 'user', content: '原始提问' }, { role: 'assistant', content: '原始回答', requestId: f.previousId }]);
  assert.equal(snapshot.records.length, 2); assert.equal(snapshot.records[1].provenance.recordId, f.previousId);
  assert.equal(snapshot.records[1].provenance.field, 'result_json.reply');
  assert.equal(snapshot.records[1].observation, 'generated-result-delivery-not-asserted');
  assert.equal(snapshot.deliveryReceiptsResolved, false); assert.equal(snapshot.records[0].scope.visibility, 'participant');
  assert.match(snapshot.records[0].contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(f.authorized(), 2); assert.equal(f.released(), 1);
  assert.throws(() => { snapshot.records[0].content.text = 'overwrite'; }, TypeError);
  const explained = await f.reader.explain(f.access, { kind: 'conversation', reference: snapshot.records[0].reference });
  assert.equal(explained.provenance.recordId, f.previousId); assert(!Object.hasOwn(explained, 'content'));
  assert.deepEqual(Object.keys(f.reader).sort(), ['agentId', 'explain', 'read']);
  assert(!f.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

test('D1 authorization is rechecked after reading and cannot release a revoked snapshot', async () => {
  const f = fixture({ revoke: true });
  await assert.rejects(f.reader.read(f.access, { kind: 'conversation' }), { code: 'AGENT_INTERACTION_CHANNEL_DENIED' });
  assert.equal(f.authorized(), 2); assert(f.calls.some(({ sql }) => sql === 'COMMIT'));
});

test('D1 requires a verified read-only transaction and rolls back failures', async () => {
  const off = fixture({ readonly: 'off' });
  await assert.rejects(off.reader.read(off.access, { kind: 'conversation' }), { code: 'AGENT_MEMORY_READ_ONLY_REQUIRED' });
  assert(!off.calls.some(({ sql }) => sql.startsWith('SELECT message.id'))); assert.equal(off.released(), 1);
  const broken = fixture({ failData: true });
  await assert.rejects(broken.reader.read(broken.access, { kind: 'conversation' }), /SYNTHETIC_DATABASE_FAILURE/);
  assert(broken.calls.some(({ sql }) => sql === 'ROLLBACK')); assert(!broken.calls.some(({ sql }) => sql === 'COMMIT'));
});

test('D1 read facade blocks SQL side effects before the driver sees them', async () => {
  for (const sql of ['UPDATE users SET role=1', 'WITH x AS (DELETE FROM users) SELECT * FROM x',
    'SELECT 1; DELETE FROM users', 'SELECT nextval($1)', 'SELECT set_config($1,$2,true)',
    'SELECT pg_advisory_lock(1)', 'SELECT * INTO copy FROM users', 'SELECT * FROM users FOR SHARE']) {
    const f = fixture(); await assert.rejects(withAgentMemoryReadOnly(f.pool, db => db.query(sql)), { code: 'AGENT_MEMORY_SELECT_REQUIRED' });
    assert(!f.calls.some(call => call.sql === sql)); assert(f.calls.some(call => call.sql === 'ROLLBACK'));
  }
});

test('D1 missing, foreign or out-of-window references never manufacture a provenance result', async () => {
  const f = fixture();
  await assert.rejects(f.reader.explain(f.access, { kind: 'conversation', reference: { kind: 'conversation', interactionId: id(), part: 'request' } }), { code: 'AGENT_MEMORY_NOT_FOUND' });
  await assert.rejects(f.reader.read({ ...f.access, agentId: id() }, { kind: 'conversation' }), { code: 'AGENT_MEMORY_ACCESS_INVALID' });
  await assert.rejects(f.reader.read({ actor: { userId: id(), profile: { role: 'admin' } }, origin: f.access.origin }, { kind: 'editorial' }), { code: 'AGENT_MEMORY_ACCESS_INVALID' });
});
