const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('library combines saved and recent state with published work metadata', async () => {
  const { createEngagementService } = await import(pathToFileURL(path.join(root, 'apps/api/src/engagement-service.mjs')));
  const rows = [{ work_key: 'gamehub-guess-baike', saved_at: new Date('2026-09-28T10:00:00Z'), last_played_at: new Date('2026-09-28T11:00:00Z'), play_count: 2 }];
  const repository = {
    list: async () => rows,
    get: async () => rows[0],
    save: async () => rows[0],
    unsave: async () => null,
    recordPlay: async () => ({ ...rows[0], play_count: 3 }),
    saveGuessResult: async input => { repository.result = input; },
  };
  const service = createEngagementService({ repository, catalogService: { get: async () => null }, clock: () => new Date('2026-09-28T12:00:00Z') });
  const items = await service.list({ userId: 'u' });
  assert.equal(items[0].work.title, '猜百科');
  assert.equal(items[0].playCount, 2);
  assert.equal((await service.recordPlay({ userId: 'u' }, 'gamehub-guess-baike')).playCount, 3);
  assert.equal((await service.unsave({ userId: 'u' }, 'gamehub-guess-baike')).savedAt, null);
  assert.deepEqual(await service.saveGuessResult({ userId: 'u' }, { puzzleDate: '2026-09-28', puzzleId: 'wikipedia-1', guessedCount: 9, elapsedSeconds: 50, hints: 1 }), { saved: true });
  assert.equal(repository.result.userId, 'u');
});

test('daily Guess Baike selection is stable across the China calendar day', async () => {
  const { createGuessBaikeService } = await import(pathToFileURL(path.join(root, 'apps/api/src/guess-baike-service.mjs')));
  const bank = require('../../packages/platform-client/src/guess-baike-puzzles.json');
  const row = puzzle => ({
    id: puzzle.id, title: puzzle.title, aliases: puzzle.aliases, category: puzzle.category, source_kind: puzzle.sourceKind,
    source_title: puzzle.sourceTitle, source_url: puzzle.sourceUrl, source_revision: puzzle.sourceRevision,
    source_updated_at: puzzle.sourceUpdatedAt, license: puzzle.license, intro_han_count: puzzle.introHanCount, content: puzzle.content,
  });
  const repository = { daily: async date => row(bank.puzzles[date === '2026-09-28' ? 0 : 1]) };
  const morning = await createGuessBaikeService({ repository, clock: () => new Date('2026-09-28T00:01:00+08:00') }).daily();
  const evening = await createGuessBaikeService({ repository, clock: () => new Date('2026-09-28T23:59:00+08:00') }).daily();
  const next = await createGuessBaikeService({ repository, clock: () => new Date('2026-09-29T00:01:00+08:00') }).daily();
  assert.equal(morning.date, '2026-09-28');
  assert.equal(morning.puzzle.id, evening.puzzle.id);
  assert.notEqual(morning.puzzle.id, next.puzzle.id);
  assert.ok(morning.puzzle.introHanCount >= 180);
});

test('Guess Baike content pipeline seeds only qualified intros and requires admin scheduling', async () => {
  const { createGuessBaikeService, GuessBaikeError } = await import(pathToFileURL(path.join(root, 'apps/api/src/guess-baike-service.mjs')));
  let seeded;
  const repository = {
    seed: async puzzles => { seeded = puzzles; },
    list: async () => [],
    schedule: async input => ({ puzzle_date: input.date, puzzle_id: input.puzzleId }),
  };
  const service = createGuessBaikeService({ repository, clock: () => new Date('2026-09-29T08:00:00+08:00') });
  await service.seedBuiltIns();
  assert.ok(seeded.length >= 6);
  assert.ok(seeded.every(item => item.introHanCount >= 180 && item.status === 'ready' && item.qualityReason === null));
  await assert.rejects(service.listAdmin({ userId: 'member', role: 'user' }), error => error instanceof GuessBaikeError && error.code === 'FORBIDDEN');
  assert.deepEqual(await service.schedule({ userId: 'admin', role: 'admin' }, { date: '2026-09-30', puzzleId: seeded[0].id }), { date: '2026-09-30', puzzleId: seeded[0].id });
});
