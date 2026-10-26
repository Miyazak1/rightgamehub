const test = require('node:test');
const assert = require('node:assert/strict');

test('Guess Baike keeps the complete normalized Wikipedia lead', async () => {
  const { normalizeWikipediaIntro } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  assert.equal(normalizeWikipediaIntro(' 第一段。\n\n 第二段。 \r\n'), '第一段。\n第二段。');
});

test('Guess Baike rejects leads below the configured Han-character floor', async () => {
  const { evaluateWikipediaIntro } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  const short = evaluateWikipediaIntro('这是一段太短的导言。', 20);
  const long = evaluateWikipediaIntro('这是一段足够长并且保留完整内容的百科导言。', 10);
  assert.equal(short.eligible, false);
  assert.match(short.reason, /低于 20 字门槛/);
  assert.equal(long.eligible, true);
});

test('Guess Baike strict selection accepts only unambiguous popular Chinese topics', async () => {
  const { evaluateGuessBaikeSelection } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  const content = '咖啡是一种世界各地都很常见的饮料，具有长期稳定的历史、文化和生活知识。'.repeat(20);
  const pageviews = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`202610${String(index + 1).padStart(2, '0')}`, 100]));
  const accepted = evaluateGuessBaikeSelection({ title: '咖啡', content, categories: ['Category:咖啡', 'Category:饮料'], pageviews });
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.category, '生活');
  assert.equal(accepted.signals.pageviews60Days, 6000);

  assert.equal(evaluateGuessBaikeSelection({ title: 'Coffee咖啡', content, categories: ['Category:饮料'], pageviews }).reasonCode, 'TITLE_HAS_LATIN');
  assert.equal(evaluateGuessBaikeSelection({ title: '年度选举', content, categories: ['Category:选举'], pageviews }).reasonCode, 'SENSITIVE_OR_UNSTABLE_TOPIC');
  assert.equal(evaluateGuessBaikeSelection({ title: '咖啡', content, categories: ['Category:饮料'], pageviews: {} }).reasonCode, 'POPULARITY_DATA_MISSING');
  assert.equal(evaluateGuessBaikeSelection({ title: '冷门器物', content, categories: ['Category:地方器物'], pageviews }).reasonCode, 'TOPIC_NOT_MAINSTREAM');
});

test('Guess Baike exposes punctuation and layout whitespace only', async () => {
  const { isVisibleGuessPunctuation, shouldMaskGuessCharacter } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  for (const character of Array.from('，。！？（）：,;.!?\'"-—\n \t')) {
    assert.equal(isVisibleGuessPunctuation(character), true, `${JSON.stringify(character)} should remain visible`);
    assert.equal(shouldMaskGuessCharacter(character), false, `${JSON.stringify(character)} should not be masked`);
  }
  for (const character of Array.from('中Aa09%×+')) {
    assert.equal(isVisibleGuessPunctuation(character), false, `${character} must not be exposed`);
    assert.equal(shouldMaskGuessCharacter(character), true, `${character} should be masked`);
  }
});

test('Guess Baike accepts Chinese, case-insensitive English and digits as guessable characters', async () => {
  const { countGuessOccurrences, isGuessTitleSolved, normalizeGuessCharacter, uniqueGuessCharacters } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  assert.deepEqual(uniqueGuessCharacters('足球 AI ai 2004！'), ['足', '球', 'a', 'i', '2', '0', '4']);
  assert.equal(normalizeGuessCharacter('A'), 'a');
  assert.equal(normalizeGuessCharacter('8'), '8');
  assert.equal(normalizeGuessCharacter('！'), null);
  assert.equal(countGuessOccurrences('AI ai 2004', ['A', '0']), 4);
  assert.equal(isGuessTitleSolved('足球', new Set(['足'])), false);
  assert.equal(isGuessTitleSolved('足球', new Set(['足', '球'])), true);
  assert.equal(isGuessTitleSolved('足球（运动）', ['足', '球', '运', '动']), true);
  assert.equal(isGuessTitleSolved('AI 2004', ['A', 'I']), false);
  assert.equal(isGuessTitleSolved('AI 2004', ['a', 'i', '2', '0', '4']), true);
});

test('Guess Baike is a daily-only game without practice mode', async () => {
  const { readFile } = require('node:fs/promises');
  const source = await readFile('packages/platform-client/src/GuessBaikeGame.jsx', 'utf8');
  assert.doesNotMatch(source, /guess-mode|setMode|练习局|PRACTICE/);
  assert.match(source, /guess-baike:daily/);
});

test('generated Guess Baike bank contains only complete eligible leads', async () => {
  const { readFile } = require('node:fs/promises');
  const bank = JSON.parse(await readFile('packages/platform-client/src/guess-baike-puzzles.json', 'utf8'));
  assert.equal(bank.policy.section, 'lead');
  assert.equal(bank.policy.complete, true);
  assert.equal(bank.policy.minimumHan, 180);
  assert.equal(bank.policy.selectionPolicyVersion, 2);
  assert.equal(bank.policy.defaultReject, true);
  assert.ok(bank.puzzles.length >= 3);
  for (const puzzle of bank.puzzles) {
    assert.ok(puzzle.introHanCount >= bank.policy.minimumHan, puzzle.title);
    assert.equal(puzzle.sourceKind, 'wikipedia-lead');
    assert.equal(puzzle.license, 'CC BY-SA 4.0');
    assert.match(puzzle.sourceUrl, /^https:\/\/zh\.wikipedia\.org\/wiki\//);
  }
});


test('generated Guess Baike categories survive startup validation', async () => {
  const { evaluateGuessBaikeSelection } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  const bank = require('../../packages/platform-client/src/guess-baike-puzzles.json');
  for (const puzzle of bank.puzzles) {
    const generated = evaluateGuessBaikeSelection({ ...puzzle, curatedCategory: puzzle.category, requirePopularity: false });
    assert.equal(generated.eligible, true, puzzle.title);
    const startup = evaluateGuessBaikeSelection({ ...puzzle, content: generated.content, curatedCategory: generated.category, requirePopularity: false });
    assert.equal(startup.eligible, true, puzzle.title + ': ' + startup.reason);
    assert.equal(startup.category, generated.category, puzzle.title);
  }
});

test('all canonical curated topics remain valid without bypassing other selection rules', async () => {
  const { evaluateGuessBaikeSelection } = await import('../../packages/platform-client/src/guess-baike-policy.mjs');
  const content = '这是完整的中文百科导言，用于介绍基本概念、主要特点及其对人类社会的影响。'.repeat(20);
  for (const curatedCategory of ['科学', '历史', '地理', '人文', '娱乐', '体育', '生活']) {
    const input = { title: '百科主题', content, curatedCategory, requirePopularity: false };
    const result = evaluateGuessBaikeSelection(input);
    assert.equal(result.eligible, true, curatedCategory);
    assert.equal(result.category, curatedCategory);
    assert.equal(evaluateGuessBaikeSelection({ ...input, title: 'AI主题' }).eligible, false);
    assert.equal(evaluateGuessBaikeSelection({ ...input, content: '短文' }).eligible, false);
    assert.equal(evaluateGuessBaikeSelection({ ...input, categories: ['Category:在世人物'] }).eligible, false);
    assert.equal(evaluateGuessBaikeSelection({ ...input, requirePopularity: true }).reasonCode, 'POPULARITY_DATA_MISSING');
  }
});
