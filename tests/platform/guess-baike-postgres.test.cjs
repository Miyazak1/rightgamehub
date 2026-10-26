const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const databaseUrl = process.env.GAMEHUB_COMMUNITY_DATABASE_URL;

test('strict Guess Baike migration prevents legacy reactivation and preserves verified disabled puzzles', { skip: !databaseUrl, timeout: 120000 }, async t => {
  const { createCommunityTestDatabase } = require('../community-database.cjs');
  const { applyMigrations } = await import('../../apps/api/src/migrations.mjs');
  const { PostgresGuessBaikeRepository } = await import('../../apps/api/src/guess-baike-repository.mjs');
  const { createGuessBaikeService } = await import('../../apps/api/src/guess-baike-service.mjs');
  const { GUESS_BAIKE_SELECTION_POLICY_VERSION: policyVersion } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  const database = await createCommunityTestDatabase(databaseUrl);
  t.after(() => database.close());
  const { pool } = database;
  await applyMigrations(pool, path.resolve(__dirname, '../../apps/api/migrations'));
  const repository = new PostgresGuessBaikeRepository(pool);
  const now = new Date('2026-10-21T08:00:00+08:00');
  const service = createGuessBaikeService({ repository, clock: () => now });
  const admin = { userId: 'admin', role: 'admin' };
  const base = require('../../packages/platform-client/src/guess-baike-puzzles.json').puzzles[0];
  const fixture = (id, status, selectionSignals = {}, qualityReason = null) => ({ ...base, id, status, selectionSignals, qualityReason });
  await repository.seed([
    fixture('legacy-ready', 'ready'),
    fixture('legacy-disabled', 'disabled'),
    fixture('old-policy-disabled', 'disabled', { policyVersion: policyVersion - 1 }),
    fixture('verified-disabled', 'disabled', { policyVersion }),
    fixture('approved-disabled', 'disabled'),
    fixture('rejected', 'rejected', { policyVersion }, '正文不合格'),
  ], now);
  for (const date of ['2026-10-20', '2026-10-21', '2026-10-22']) {
    await pool.query('INSERT INTO guess_baike_schedule(puzzle_date,puzzle_id) VALUES($1,$2)', [date, 'legacy-disabled']);
  }
  // Even before startup cleanup, a disabled legacy row cannot bypass verification.
  await assert.rejects(service.setStatus(admin, 'legacy-disabled', 'ready'), { code: 'PUZZLE_NOT_READY' });
  await repository.rejectLegacyUnverified({ approvedIds: ['approved-disabled'], policyVersion, fromDate: '2026-10-21', now });
  const rows = new Map((await pool.query('SELECT * FROM guess_baike_puzzles')).rows.map(row => [row.id, row]));
  assert.equal(rows.get('legacy-ready').status, 'rejected');
  for (const id of ['legacy-disabled', 'old-policy-disabled']) {
    assert.equal(rows.get(id).status, 'disabled', 'retain the administrator disable decision');
    assert.ok(rows.get(id).quality_reason, 'mark missing current policy evidence');
    await assert.rejects(service.setStatus(admin, id, 'ready'), { code: 'PUZZLE_NOT_READY' });
  }
  assert.equal(rows.get('verified-disabled').status, 'disabled');
  assert.equal(rows.get('verified-disabled').quality_reason, null);
  assert.equal((await service.setStatus(admin, 'verified-disabled', 'ready')).status, 'ready');
  await assert.rejects(service.setStatus(admin, 'rejected', 'ready'), { code: 'PUZZLE_NOT_READY' });
  await service.setStatus(admin, 'rejected', 'disabled');
  await assert.rejects(service.setStatus(admin, 'rejected', 'ready'), { code: 'PUZZLE_NOT_READY' });
  assert.equal(rows.get('approved-disabled').quality_reason, null, 'built-ins are revalidated separately');
  await repository.seed([fixture('approved-disabled', 'ready', { policyVersion })], now);
  assert.equal((await pool.query('SELECT status FROM guess_baike_puzzles WHERE id=$1', ['approved-disabled'])).rows[0].status, 'disabled');
  assert.equal((await service.setStatus(admin, 'approved-disabled', 'ready')).status, 'ready');
  assert.deepEqual((await pool.query('SELECT puzzle_date::text AS date FROM guess_baike_schedule ORDER BY puzzle_date')).rows.map(row => row.date), ['2026-10-20']);
  // Repeated startup cleanup must not change already verified decisions.
  await repository.rejectLegacyUnverified({ approvedIds: ['approved-disabled'], policyVersion, fromDate: '2026-10-21', now });
  assert.equal((await pool.query('SELECT status FROM guess_baike_puzzles WHERE id=$1', ['verified-disabled'])).rows[0].status, 'ready');
});
