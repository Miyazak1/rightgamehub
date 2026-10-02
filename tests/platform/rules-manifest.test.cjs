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
  const { sdk,identity,manifest,manifestPath,trustedKeys } = await setup(t);
  const registry = sdk.loadRulesRegistry({ manifestPath,trustedKeys });
  assert.equal(registry.list().length,1);
  assert.equal(registry.get(identity).modeKey,'duel');
  assert.equal(registry.get(identity).createInitialState().turn,0);
  assert.deepEqual(registry.describe(),{
    installed: true,protocol: sdk.RULES_MANIFEST_PROTOCOL,manifestSha256: sdk.digestRulesBundle(fs.readFileSync(manifestPath)),
    keyId: manifest.keyId,createdAt: manifest.createdAt,adapterCount: 1,
  });
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

test('rules release CLI carries forward trusted adapters and materializes only signed bytes', async t => {
  const sdk = await import(modulePath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'gamehub-rules-release-')); t.after(() => fs.rmSync(root,{ recursive: true,force: true }));
  const current = path.join(root,'current'); fs.mkdirSync(current);
  const workId = '00000000-0000-4000-8000-000000000041';
  const firstIdentity = { workId,modeKey: 'duel',rulesetVersion: '1.0.0' };
  const secondIdentity = { workId,modeKey: 'duel',rulesetVersion: '1.1.0' };
  const firstBundle = adapterSource(firstIdentity); const secondBundle = adapterSource(secondIdentity);
  fs.writeFileSync(path.join(current,'duel-1.0.0.cjs'),firstBundle);
  const { privateKey,publicKey } = crypto.generateKeyPairSync('ed25519');
  const keyId = 'release-2026-10';
  const privatePath = path.join(root,'private.pem'); const trustedPath = path.join(root,'trusted.json');
  fs.writeFileSync(privatePath,privateKey.export({ format: 'pem',type: 'pkcs8' }));
  fs.writeFileSync(trustedPath,JSON.stringify({ [keyId]: publicKey.export({ format: 'der',type: 'spki' }).toString('base64') }));
  const currentManifest = path.join(current,'manifest.json');
  fs.writeFileSync(currentManifest,JSON.stringify(sdk.signRulesManifest({ protocol: sdk.RULES_MANIFEST_PROTOCOL,createdAt: '2026-10-01T00:00:00.000Z',keyId,entries: [{ ...firstIdentity,bundle: 'duel-1.0.0.cjs',sha256: sdk.digestRulesBundle(firstBundle) }] },privateKey)));
  const nextBundle = path.join(root,'next.cjs'); fs.writeFileSync(nextBundle,secondBundle);
  const staged = path.join(root,'staged'); const cli = path.resolve(__dirname,'../../scripts/rules-manifest-cli.mjs');
  const stage = spawnSync(process.execPath,[cli,'stage',staged,keyId,nextBundle,workId,'duel','1.1.0',currentManifest,trustedPath],{ encoding: 'utf8' });
  assert.equal(stage.status,0,stage.stderr); assert.equal(JSON.parse(stage.stdout).adapterCount,2);
  assert.equal(fs.existsSync(path.join(staged,'manifest.json')),false);
  const sign = spawnSync(process.execPath,[cli,'sign',path.join(staged,'manifest.unsigned.json'),privatePath,path.join(staged,'manifest.json')],{ encoding: 'utf8' });
  assert.equal(sign.status,0,sign.stderr);
  const verify = spawnSync(process.execPath,[cli,'verify-release',staged,trustedPath],{ encoding: 'utf8' });
  assert.equal(verify.status,0,verify.stderr); assert.equal(JSON.parse(verify.stdout).adapterCount,2);
  const deployed = path.join(root,'deployed');
  const materialize = spawnSync(process.execPath,[cli,'materialize',path.join(staged,'manifest.json'),trustedPath,deployed],{ encoding: 'utf8' });
  assert.equal(materialize.status,0,materialize.stderr); assert.equal(JSON.parse(materialize.stdout).adapterCount,2);
  assert.equal(fs.existsSync(path.join(deployed,'manifest.unsigned.json')),false);
  assert.equal(fs.existsSync(path.join(deployed,'release-plan.json')),false);
  assert.equal(sdk.loadRulesRegistry({ manifestPath: path.join(deployed,'manifest.json'),trustedKeys: JSON.parse(fs.readFileSync(trustedPath,'utf8')) }).list().length,2);
  const duplicateBundle = path.join(root,'duplicate.cjs'); fs.writeFileSync(duplicateBundle,firstBundle);
  const duplicate = spawnSync(process.execPath,[cli,'stage',path.join(root,'duplicate'),keyId,duplicateBundle,workId,'duel','1.0.0',currentManifest,trustedPath],{ encoding: 'utf8' });
  assert.notEqual(duplicate.status,0); assert.match(duplicate.stderr,/identity already exists/u);
});
