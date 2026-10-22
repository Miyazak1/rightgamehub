const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('automatic Guess Baike supply fetches politely, filters candidates and fills future dates', async () => {
  const { createGuessBaikeAutomation, evaluateCandidate } = await import(pathToFileURL(path.join(root, 'apps/api/src/guess-baike-automation.mjs')));
  const content = '这是一个用于自动测试的百科条目，完整介绍相关概念、历史沿革、主要特点以及在现实世界中的影响。'.repeat(20);
  const pageviews = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`202609${String(index + 1).padStart(2, '0')}`, 100]));
  const pages = [
    { pageid: 100, ns: 0, title: '自动测试', extract: content, categories: [{ title: 'Category:软件测试' }], pageviews, canonicalurl: 'https://zh.wikipedia.org/wiki/%E8%87%AA%E5%8A%A8%E6%B5%8B%E8%AF%95', revisions: [{ revid: 9001, timestamp: '2026-09-29T00:00:00Z' }] },
    { pageid: 101, ns: 0, title: '测试列表', extract: content, canonicalurl: 'https://zh.wikipedia.org/wiki/test', revisions: [{ revid: 9002, timestamp: '2026-09-29T00:00:00Z' }] },
  ];
  let seeded = []; let finished; const inserted = [];
  const repository = {
    startAutomationRun: async () => {},
    finishAutomationRun: async input => { finished = input; },
    seed: async puzzles => { seeded = puzzles; },
    automationSnapshot: async () => ({ puzzles: [{ id: 'wikipedia-100', category: '百科' },{ id: 'wikipedia-200', category: '科技' },{ id: 'wikipedia-300', category: '历史' }], schedules: [] }),
    insertAutomaticSchedule: async input => { inserted.push(input); return input; },
  };
  const fetchImpl = async (url, options) => {
    assert.match(url, /generator=random/); assert.match(url, /categories/); assert.match(url, /pageviews/); assert.match(url, /maxlag=5/); assert.match(options.headers['User-Agent'], /GameHub-Test/);
    return { ok: true, json: async () => ({ query: { pages } }) };
  };
  const automation = createGuessBaikeAutomation({ repository,fetchImpl,clock: () => new Date('2026-09-29T08:00:00+08:00'),batchSize: 20,scheduleDays: 3,userAgent: 'GameHub-Test/1.0 (test@example.test)' });
  const result = await automation.runOnce();
  assert.equal(result.fetchedCount,2); assert.equal(result.acceptedCount,1); assert.equal(seeded[0].id,'wikipedia-100');
  assert.equal(seeded[0].selectionSignals.policyVersion,2); assert.equal(seeded[0].selectionSignals.pageviews60Days,6000);
  assert.deepEqual(inserted.map(item => item.date),['2026-09-29','2026-09-30','2026-10-01']);
  const categoryById = new Map([['wikipedia-100','百科'],['wikipedia-200','科技'],['wikipedia-300','历史']]);
  assert.equal(new Set(inserted.map(item => categoryById.get(item.puzzleId))).size,3);
  assert.equal(finished.status,'succeeded'); assert.equal(finished.scheduledCount,3);
  assert.equal(evaluateCandidate({ ...pages[0], pageprops: { disambiguation: '' } }).accepted,false);
});

test('automatic Guess Baike rejects Latin, sensitive, obscure and unverifiable topics without review', async () => {
  const { evaluateCandidate } = await import(pathToFileURL(path.join(root, 'apps/api/src/guess-baike-automation.mjs')));
  const content = '这是用于严格规则测试的完整中文百科导言，介绍主题的基本概念、发展过程、重要特点与大众影响。'.repeat(20);
  const pageviews = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`202608${String(index + 1).padStart(2, '0')}`, 100]));
  const base = { pageid: 400, ns: 0, extract: content, canonicalurl: 'https://zh.wikipedia.org/wiki/test', lastrevid: 9004, touched: '2026-09-29T00:00:00Z', pageviews };
  const cases = [
    [{ ...base, title: 'AI技术', categories: [{ title: 'Category:计算机科学' }] }, 'TITLE_HAS_LATIN'],
    [{ ...base, title: '年度选举', categories: [{ title: 'Category:选举' }] }, 'SENSITIVE_OR_UNSTABLE_TOPIC'],
    [{ ...base, title: '地方器物', categories: [{ title: 'Category:地方器物' }] }, 'TOPIC_NOT_MAINSTREAM'],
    [{ ...base, title: '太阳系', categories: [{ title: 'Category:天文学' }], pageviews: {} }, 'POPULARITY_DATA_MISSING'],
  ];
  for (const [page, reasonCode] of cases) {
    const result = evaluateCandidate(page);
    assert.equal(result.accepted, false);
    assert.equal(result.puzzle.status, 'rejected');
    assert.equal(result.puzzle.selectionSignals.reasonCode, reasonCode);
  }
});

test('automatic Guess Baike supply keeps fallback scheduling when Wikipedia is unavailable', async () => {
  const { createGuessBaikeAutomation } = await import(pathToFileURL(path.join(root, 'apps/api/src/guess-baike-automation.mjs')));
  let finished; let scheduleTouched = false;
  const repository = {
    startAutomationRun: async () => {}, finishAutomationRun: async input => { finished = input; },
    automationSnapshot: async () => { scheduleTouched = true; return { puzzles: [], schedules: [] }; },
  };
  const automation = createGuessBaikeAutomation({ repository,fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),clock: () => new Date('2026-09-29T08:00:00+08:00'),userAgent: 'GameHub-Test/1.0' });
  await assert.rejects(automation.runOnce(), /HTTP 503/);
  assert.equal(finished.status,'failed'); assert.equal(finished.errorCode,'WIKIPEDIA_HTTP_503'); assert.equal(scheduleTouched,true);
});

test('strict Guess Baike migration rejects unverifiable legacy inventory and removes future schedules atomically', async () => {
  const { PostgresGuessBaikeRepository } = await import(pathToFileURL(path.join(root, 'apps/api/src/guess-baike-repository.mjs')));
  const calls = []; let released = false;
  const client = {
    query: async (sql, values = []) => { calls.push({ sql, values }); return { rows: [] }; },
    release: () => { released = true; },
  };
  const repository = new PostgresGuessBaikeRepository({ connect: async () => client });
  const now = new Date('2026-10-21T08:00:00+08:00');
  await repository.rejectLegacyUnverified({ approvedIds: ['curated-1'], policyVersion: 2, fromDate: '2026-10-21', now });

  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /status='rejected'/);
  assert.deepEqual(calls[1].values, [['curated-1'], 2, now]);
  assert.match(calls[2].sql, /DELETE FROM guess_baike_schedule/);
  assert.deepEqual(calls[2].values, ['2026-10-21']);
  assert.equal(calls[3].sql, 'COMMIT');
  assert.equal(released, true);
});
