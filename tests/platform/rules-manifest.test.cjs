const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const modulePath = '../../packages/rules-sdk/src/index.mjs';
const adapterSource = identity => Buffer.from(`
module.exports = {
  workId: ${JSON.stringify(identity.workId)}, modeKey: ${JSON.stringify(identity.modeKey)}, rulesetVersion: ${JSON.stringify(identity.rulesetVersion)},
  createInitialState() { return { turn: 0 }; },
  getTurn() { return { userId: 'player-1', seconds: 60 }; },
  getPlayerView(state) { return state; }, getSpectatorView(state) { return state; },
  serializeState(state) { return JSON.stringify(state); }, deserializeState(value) { return JSON.parse(value); },
  hashState() { return 'hash'; }, validateCommand() { return true; }, applyCommand(state) { return { state }; },
  handleResign(state) { return { state }; }, handleTimeout(state) { return { state }; }
};
`, 'utf8');

const setup = async t => {
  const sdk = await import(modulePath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-rules-'));
  t.after(() => fs.rmSync(root, { recursive: true,force: true }));
  const identity = { workId: 'work-1',modeKey: 'duel',rulesetVersion: '1.0.0' };
  const bundle = adapterSource(identity);
  fs.writeFileSync(path.join(root, 'duel.cjs'), bundle);
  const { privateKey,publicKey } = crypto.generateKeyPairSync('ed25519');
  const unsigned = {
    protocol: sdk.RULES_MANIFEST_PROTOCOL,createdAt: '2026-09-30T00:00:00.000Z',keyId: 'release-2026-09',
    entries: [{ ...identity,bundle: 'duel.cjs',sha256: sdk.digestRulesBundle(bundle) }],
  };
  const manifest = sdk.signRulesManifest(unsigned, privateKey);
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const trustedKeys = { 'release-2026-09': publicKey.export({ format: 'der',type: 'spki' }).toString('base64') };
  return { sdk,root,identity,manifest,manifestPath,trustedKeys,privateKey };
};

test('signed rules manifest loads the exact verified CommonJS adapter', async t => {
  const { sdk,identity,manifestPath,trustedKeys } = await setup(t);
  const registry = sdk.loadRulesRegistry({ manifestPath,trustedKeys });
  assert.equal(registry.list().length,1);
  assert.equal(registry.get(identity).modeKey,'duel');
  assert.equal(registry.get(identity).createInitialState().turn,0);
});

test('rules loading fails closed for untrusted signatures, changed bundles and identity drift', async t => {
  const { sdk,root,manifest,manifestPath,trustedKeys,privateKey } = await setup(t);
  assert.throws(() => sdk.loadRulesRegistry({ manifestPath,trustedKeys: {} }), error => error.code === 'RULES_MANIFEST_KEY_UNTRUSTED');
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest,createdAt: '2026-10-01T00:00:00.000Z' }));
  assert.throws(() => sdk.loadRulesRegistry({ manifestPath,trustedKeys }), error => error.code === 'RULES_MANIFEST_SIGNATURE_INVALID');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.appendFileSync(path.join(root, 'duel.cjs'), '\n// changed');
  assert.throws(() => sdk.loadRulesRegistry({ manifestPath,trustedKeys }), error => error.code === 'RULES_BUNDLE_DIGEST_MISMATCH');
  const different = adapterSource({ workId: 'work-2',modeKey: 'duel',rulesetVersion: '1.0.0' });
  fs.writeFileSync(path.join(root, 'duel.cjs'), different);
  const changed = { ...manifest,entries: [{ ...manifest.entries[0],sha256: sdk.digestRulesBundle(different) }] };
  fs.writeFileSync(manifestPath, JSON.stringify(sdk.signRulesManifest(changed, privateKey)));
  assert.throws(() => sdk.loadRulesRegistry({ manifestPath,trustedKeys }), error => error.code === 'RULES_BUNDLE_IDENTITY_MISMATCH');
  const { privateKey: rsaKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => sdk.signRulesManifest(changed, rsaKey), error => error.code === 'RULES_SIGNING_KEY_INVALID');
});

test('unsigned rules manifests require an explicit non-production opt-in', async t => {
  const { sdk,manifest,manifestPath } = await setup(t);
  fs.writeFileSync(manifestPath, JSON.stringify({ protocol: manifest.protocol,createdAt: manifest.createdAt,entries: manifest.entries }));
  assert.throws(() => sdk.loadRulesRegistry({ manifestPath }), error => error.code === 'RULES_MANIFEST_SIGNATURE_INVALID');
  assert.equal(sdk.loadRulesRegistry({ manifestPath,allowUnsigned: true }).list().length,1);
});

test('rules manifest CLI recomputes bundle digests, signs and verifies a release', async t => {
  const { manifest,manifestPath,trustedKeys,privateKey,root } = await setup(t);
  const privatePath = path.join(root, 'private.pem');
  const publicPath = path.join(root, 'public.json');
  fs.writeFileSync(privatePath, privateKey.export({ format: 'pem',type: 'pkcs8' }));
  fs.writeFileSync(publicPath, JSON.stringify(trustedKeys));
  fs.writeFileSync(manifestPath, JSON.stringify({ protocol: manifest.protocol,createdAt: manifest.createdAt,keyId: manifest.keyId,entries: manifest.entries.map(({ sha256: _sha256,...entry }) => entry) }));
  const cli = path.resolve(__dirname, '../../scripts/rules-manifest-cli.mjs');
  const signed = spawnSync(process.execPath, [cli,'sign',manifestPath,privatePath], { encoding: 'utf8' });
  assert.equal(signed.status,0,signed.stderr);
  const verified = spawnSync(process.execPath, [cli,'verify',manifestPath,publicPath], { encoding: 'utf8' });
  assert.equal(verified.status,0,verified.stderr);
  assert.match(verified.stdout,/Verified 1 trusted rules adapter/u);
});
