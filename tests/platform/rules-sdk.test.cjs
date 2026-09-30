const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = overrides => ({
  workId: 'work-1', modeKey: 'duel', rulesetVersion: '1.0.0',
  createInitialState() {}, getTurn() {}, getPlayerView() {}, getSpectatorView() {},
  serializeState() {}, deserializeState() {}, hashState() {}, validateCommand() {}, applyCommand() {}, handleTimeout() {},
  ...overrides,
});

test('rules SDK canonical hashing is stable across object key order', async () => {
  const { canonicalJson, hashRulesState } = await import('../../packages/rules-sdk/src/index.mjs');
  const left = { z: [3, { b: true, a: null }], a: 'value' };
  const right = { a: 'value', z: [3, { a: null, b: true }] };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(hashRulesState(left), hashRulesState(right));
  assert.match(hashRulesState(left), /^[a-f0-9]{64}$/u);
  assert.throws(() => canonicalJson(undefined), /JSON serializable/u);
});

test('rules registry validates adapters and rejects duplicate identities', async () => {
  const { createRulesRegistry, validateRulesAdapter } = await import('../../packages/rules-sdk/src/index.mjs');
  const registered = adapter();
  const registry = createRulesRegistry([registered]);
  assert.equal(registry.get(registered), registered);
  assert.equal(registry.get({ workId: 'work-1', modeKey: 'other', rulesetVersion: '1.0.0' }), null);
  assert.throws(() => createRulesRegistry([registered, adapter()]), /Duplicate rules adapter/u);
  assert.throws(() => validateRulesAdapter({}), /workId is required/u);
});
