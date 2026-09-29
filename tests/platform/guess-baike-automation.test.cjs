const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('automatic Guess Baike supply fetches politely, filters candidates and fills future dates', async () => {
  const { createGuessBaikeAutomation, evaluateCandidate } = await import(pathToFileURL(path.join(root, 'apps/api/src/guess-baike-automation.mjs')));
  const content = '这是一个用于自动测试的百科条目，完整介绍相关概念、历史沿革、主要特点以及在现实世界中的影响。'.repeat(20);
  const pages = [
    { pageid: 100, ns: 0, title: '自动测试', extract: content, canonicalurl: 'https://zh.wikipedia.org/wiki/%E8%87%AA%E5%8A%A8%E6%B5%8B%E8%AF%95', revisions: [{ revid: 9001, timestamp: '2026-09-29T00:00:00Z' }] },
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
    assert.match(url, /generator=random/); assert.match(url, /maxlag=5/); assert.match(options.headers['User-Agent'], /GameHub-Test/);
    return { ok: true, json: async () => ({ query: { pages } }) };
  };
  const automation = createGuessBaikeAutomation({ repository,fetchImpl,clock: () => new Date('2026-09-29T08:00:00+08:00'),batchSize: 20,scheduleDays: 3,userAgent: 'GameHub-Test/1.0 (test@example.test)' });
  const result = await automation.runOnce();
  assert.equal(result.fetchedCount,2); assert.equal(result.acceptedCount,1); assert.equal(seeded[0].id,'wikipedia-100');
  assert.deepEqual(inserted.map(item => item.date),['2026-09-29','2026-09-30','2026-10-01']);
  assert.equal(finished.status,'succeeded'); assert.equal(finished.scheduledCount,3);
  assert.equal(evaluateCandidate({ ...pages[0], pageprops: { disambiguation: '' } }).accepted,false);
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
