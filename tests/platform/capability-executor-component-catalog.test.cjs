const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const now = new Date('2026-10-29T04:00:00.000Z');
const modelSha = 'a'.repeat(64);
const component = { componentId: 'pp-ocr-rec-model', role: 'ocr-recognition-model',
  version: '3.0.0', sha256: modelSha, sizeBytes: 2048 };

function keys() {
  const pair = crypto.generateKeyPairSync('ed25519');
  return { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
}

const catalogInput = overrides => ({ schemaVersion: 'capability-component-catalog-v1',
  catalogId: 'mooyu-capability-components', sequence: 1,
  generatedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2026-11-05T00:00:00.000Z',
  keyId: 'component-release-2026', releases: [{ componentId: component.componentId,
    componentVersion: component.version, releaseSequence: 1, role: component.role,
    engine: { name: 'PP-StructureV3', version: '3.0.0' }, platform: 'win32-x64',
    languages: ['zh-Hans', 'en'], download: { url: 'https://downloads.mooyu.fun/components/pp-rec.bin',
      sha256: modelSha, sizeBytes: component.sizeBytes } }], revokedComponentSha256s: [],
  ...overrides });
const keyring = publicKey => [{ keyId: 'component-release-2026', status: 'active', publicKeyPem: publicKey,
  notBefore: '2026-10-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z' }];

test('signed component catalog selects an exact engine model without bundling it in desktop release',
  async () => {
    const api = await import(apiUrl), pair = keys();
    const catalog = api.signCapabilityComponentCatalog(catalogInput(), pair.privateKey);
    const verified = api.verifyCapabilityComponentCatalog({ catalog,
      trustedKeys: keyring(pair.publicKey), now });
    assert.equal(verified.releases[0].download.sha256, modelSha);
    const selected = api.selectCapabilityComponentRelease({ catalog,
      trustedKeys: keyring(pair.publicKey), now, component,
      engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['zh-Hans'] });
    assert.equal(selected.download.url,
      'https://downloads.mooyu.fun/components/pp-rec.bin');
    assert.equal(selected.download.sizeBytes, component.sizeBytes);
  });

test('component selection verifies signature, exact digest, language and revocation', async () => {
  const api = await import(apiUrl), pair = keys(), trustedKeys = keyring(pair.publicKey);
  const catalog = api.signCapabilityComponentCatalog(catalogInput(), pair.privateKey);
  const tampered = structuredClone(catalog);
  tampered.releases[0].download.url = 'https://evil.example/model.bin';
  assert.throws(() => api.selectCapabilityComponentRelease({ catalog: tampered, trustedKeys, now,
    component, engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['zh-Hans'] }),
  /CAPABILITY_COMPONENT_CATALOG_SIGNATURE_INVALID/u);
  assert.throws(() => api.selectCapabilityComponentRelease({ catalog, trustedKeys, now,
    component: { ...component, sha256: 'b'.repeat(64) },
    engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['zh-Hans'] }),
  /CAPABILITY_COMPONENT_RELEASE_UNAVAILABLE/u);
  assert.throws(() => api.selectCapabilityComponentRelease({ catalog, trustedKeys, now,
    component, engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['ja'] }),
  /CAPABILITY_COMPONENT_RELEASE_UNAVAILABLE/u);
  const revoked = api.signCapabilityComponentCatalog(catalogInput({
    revokedComponentSha256s: [modelSha],
  }), pair.privateKey);
  assert.throws(() => api.selectCapabilityComponentRelease({ catalog: revoked, trustedKeys, now,
    component, engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['zh-Hans'] }),
  /CAPABILITY_COMPONENT_RELEASE_UNAVAILABLE/u);
});

test('component catalog rejects expiry, duplicate release identities and unknown fields', async () => {
  const api = await import(apiUrl), pair = keys(), input = catalogInput();
  const catalog = api.signCapabilityComponentCatalog(input, pair.privateKey);
  assert.throws(() => api.verifyCapabilityComponentCatalog({ catalog,
    trustedKeys: keyring(pair.publicKey), now: new Date('2026-11-05T00:00:00.000Z') }),
  /CAPABILITY_COMPONENT_CATALOG_EXPIRED/u);
  assert.throws(() => api.normalizeCapabilityComponentCatalog({ ...catalog,
    releases: [...catalog.releases, structuredClone(catalog.releases[0])] }),
  /CAPABILITY_COMPONENT_RELEASE_DUPLICATE/u);
  assert.throws(() => api.normalizeCapabilityComponentCatalog({ ...catalog, upload: true }),
    /CAPABILITY_COMPONENT_CATALOG_INVALID/u);
});

test('component catalog v2 signs the internal bundle manifest identity and limits', async () => {
  const api = await import(apiUrl), pair = keys(), content = { kind: 'zip-bundle',
    manifestSha256: 'b'.repeat(64), fileCount: 17, expandedSizeBytes: 123456 };
  const base = catalogInput({ schemaVersion: 'capability-component-catalog-v2' });
  base.releases = base.releases.map(release => ({ ...release, content }));
  const catalog = api.signCapabilityComponentCatalog(base, pair.privateKey);
  const selected = api.selectCapabilityComponentRelease({ catalog,
    trustedKeys: keyring(pair.publicKey), now, component,
    engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['zh-Hans'] });
  assert.deepEqual(selected.content, content);
  const tampered = structuredClone(catalog);
  tampered.releases[0].content.fileCount = 18;
  assert.throws(() => api.verifyCapabilityComponentCatalog({ catalog: tampered,
    trustedKeys: keyring(pair.publicKey), now }),
  /CAPABILITY_COMPONENT_CATALOG_SIGNATURE_INVALID/u);
  assert.throws(() => api.normalizeCapabilityComponentCatalog({ ...catalog,
    releases: [{ ...catalog.releases[0], content: { ...content, expandedSizeBytes: 0 } }] }),
  /CAPABILITY_COMPONENT_CONTENT_INVALID/u);
});
