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
  assert.ok(bank.puzzles.length >= 3);
  for (const puzzle of bank.puzzles) {
    assert.ok(puzzle.introHanCount >= bank.policy.minimumHan, puzzle.title);
    assert.equal(puzzle.sourceKind, 'wikipedia-lead');
    assert.equal(puzzle.license, 'CC BY-SA 4.0');
    assert.match(puzzle.sourceUrl, /^https:\/\/zh\.wikipedia\.org\/wiki\//);
  }
});

