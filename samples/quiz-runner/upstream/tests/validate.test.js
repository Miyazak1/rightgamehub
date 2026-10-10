"use strict";
// Tests for the validation checks. Run with: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { runChecks, validate } = require('../src/validate.js');

// ── Helpers for building in-memory configs and question sets ──────────────────

// A baseline two-category config with a 4-team × 2-pick board (8 slots).
function baseConfig(overrides) {
  return Object.assign({
    event: { title: 'Test', coverLayout: 'standard' },
    assets: {},
    rules: { teamsDefault: 4, picksPerCategoryPerTeam: 2 },
    categories: [
      { name: 'Alpha', shortName: 'AL', shortcutKey: 'A', colour: 'blue' },
      { name: 'Beta',  shortName: 'BE', shortcutKey: 'B', colour: 'green' }
    ],
    questions: { drawOrder: 'auto' }
  }, overrides || {});
}

// Generates `n` questions of a given type for a category. ids are unique within
// the call via the offset, so callers can build deliberate duplicates if needed.
function makeQuestions(category, type, n, offset) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = (offset || 0) + i + 1;
    out.push({
      id: category[0] + type[0] + k,
      category, type, theme: 'T',
      primaryQuestion: 'Q' + k + '?', primaryAnswer: 'A' + k,
      secondaryQuestion: '', secondaryAnswer: '', imagePath: '', draw: null
    });
  }
  return out;
}

// A clean question set: exactly 8 mains + 3 tiebreakers per category.
function cleanQuestions() {
  return [].concat(
    makeQuestions('Alpha', 'main', 8),
    makeQuestions('Alpha', 'tiebreaker', 3),
    makeQuestions('Beta', 'main', 8),
    makeQuestions('Beta', 'tiebreaker', 3)
  );
}

// ── Structural checks ────────────────────────────────────────────────────────

test('a well-formed config produces no errors, warnings, or info', () => {
  const { errors, warnings, info } = runChecks(baseConfig(), cleanQuestions());
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(warnings, []);
  assert.deepStrictEqual(info, []);
});

test('extra main questions beyond the board size raise an INFO note', () => {
  // 9 mains for an 8-slot board → 1 unused.
  const qs = [].concat(makeQuestions('Alpha', 'main', 9), makeQuestions('Alpha', 'tiebreaker', 3),
                       makeQuestions('Beta', 'main', 8),  makeQuestions('Beta', 'tiebreaker', 3));
  const { errors, info } = runChecks(baseConfig(), qs);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(info.length, 1);
  assert.ok(info[0].includes('will not be drawn'));
});

test('too few main questions for the board raises a warning', () => {
  const qs = [].concat(makeQuestions('Alpha', 'main', 7), makeQuestions('Alpha', 'tiebreaker', 3),
                       makeQuestions('Beta', 'main', 8),  makeQuestions('Beta', 'tiebreaker', 3));
  const { warnings } = runChecks(baseConfig(), qs);
  assert.ok(warnings.some((w) => w.includes('only 7 main questions')));
});

test('fewer than three tiebreakers raises a warning', () => {
  const qs = [].concat(makeQuestions('Alpha', 'main', 8), makeQuestions('Alpha', 'tiebreaker', 2),
                       makeQuestions('Beta', 'main', 8),  makeQuestions('Beta', 'tiebreaker', 3));
  const { warnings } = runChecks(baseConfig(), qs);
  assert.ok(warnings.some((w) => w.includes('tiebreaker')));
});

test('a duplicate question id within a category is an error', () => {
  const qs = cleanQuestions();
  qs[1].id = qs[0].id; // force a duplicate in Alpha
  const { errors } = runChecks(baseConfig(), qs);
  assert.ok(errors.some((e) => e.includes('duplicate question id')));
});

test('a question referencing an undeclared category is an error', () => {
  const qs = cleanQuestions().concat(makeQuestions('Zeta', 'main', 1));
  const { errors } = runChecks(baseConfig(), qs);
  assert.ok(errors.some((e) => e.includes('Zeta')));
});

test('two categories sharing a shortcut key is an error', () => {
  const cfg = baseConfig();
  cfg.categories[1].shortcutKey = 'A'; // clash with Alpha
  const { errors } = runChecks(cfg, cleanQuestions());
  assert.ok(errors.some((e) => e.includes('Shortcut key')));
});

test('conflicting explicit draw numbers are an error', () => {
  const cfg = baseConfig({ questions: { drawOrder: 'explicit' } });
  const qs = cleanQuestions();
  // Give two Alpha mains the same draw number.
  qs[0].draw = 1;
  qs[1].draw = 1;
  const { errors } = runChecks(cfg, qs);
  assert.ok(errors.some((e) => e.includes('duplicate draw number')));
});

test('an invalid coverLayout is an error', () => {
  const cfg = baseConfig();
  cfg.event.coverLayout = 'fancy';
  const { errors } = runChecks(cfg, cleanQuestions());
  assert.ok(errors.some((e) => e.includes('coverLayout')));
});

test('a missing event title is an error', () => {
  const cfg = baseConfig();
  cfg.event.title = '';
  const { errors } = runChecks(cfg, cleanQuestions());
  assert.ok(errors.some((e) => e.includes('title')));
});

test('an invalid opening order is an error', () => {
  const cfg = baseConfig();
  cfg.rules.openingOrder = 'zigzag';
  const { errors } = runChecks(cfg, cleanQuestions());
  assert.ok(errors.some((e) => e.includes('openingOrder')));
});

test('"snake" and "circular" opening orders are accepted', () => {
  for (const order of ['snake', 'circular']) {
    const cfg = baseConfig();
    cfg.rules.openingOrder = order;
    const { errors } = runChecks(cfg, cleanQuestions());
    assert.deepStrictEqual(errors, []);
  }
});

test('a negative tiebreaker penalty count is an error', () => {
  const cfg = baseConfig();
  cfg.rules.tiebreakerPenaltyPerTeam = -1;
  const { errors } = runChecks(cfg, cleanQuestions());
  assert.ok(errors.some((e) => e.includes('tiebreakerPenaltyPerTeam')));
});

test('a non-boolean passingEnabled is an error', () => {
  const cfg = baseConfig();
  cfg.rules.passingEnabled = 'yes';
  const { errors } = runChecks(cfg, cleanQuestions());
  assert.ok(errors.some((e) => e.includes('passingEnabled')));
});

test('passingEnabled true or false is accepted', () => {
  for (const v of [true, false]) {
    const cfg = baseConfig();
    cfg.rules.passingEnabled = v;
    const { errors } = runChecks(cfg, cleanQuestions());
    assert.deepStrictEqual(errors, []);
  }
});

// ── Integration: validate() against the on-disk fixture ──────────────────────

test('the on-disk sample fixture validates cleanly', () => {
  const cfgPath = path.join(__dirname, 'fixtures', 'sample', 'config.json');
  const { errors } = validate(cfgPath);
  assert.deepStrictEqual(errors, []);
});
