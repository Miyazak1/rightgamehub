const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const zipUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/zip-buffer-writer.mjs')).href;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

async function fixture(root) {
  const { createZipBuffer } = await import(zipUrl);
  const payload = [{ path: 'models/layout.json', data: Buffer.from('{"layout":true}') },
    { path: 'models/weights.bin', data: Buffer.from([7, 8, 9]) }];
  const manifest = { schemaVersion: 'capability-component-bundle-v1',
    component: { componentId: 'pp-layout-model', role: 'layout-model', version: '3.0.0' },
    files: payload.map(item => ({ path: item.path, sha256: digest(item.data),
      sizeBytes: item.data.length, executable: false })) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const archive = createZipBuffer([{ name: 'component.bundle.json', data: manifestBytes },
    ...payload.map(item => ({ name: `payload/${item.path}`, data: item.data }))]);
  const sourceFile = path.join(root, 'component.zip');
  await fs.promises.writeFile(sourceFile, archive);
  const component = { componentId: manifest.component.componentId, role: manifest.component.role,
    version: manifest.component.version, sha256: digest(archive), sizeBytes: archive.length };
  const content = { kind: 'zip-bundle', manifestSha256: digest(manifestBytes),
    fileCount: payload.length,
    expandedSizeBytes: payload.reduce((sum, item) => sum + item.data.length, 0) };
  const release = { componentId: component.componentId, componentVersion: component.version,
    releaseSequence: 1, role: component.role,
    engine: { name: 'PP-StructureV3', version: '3.0.0' }, platform: 'win32-x64',
    languages: ['zh-Hans'], download: { url: 'https://downloads.mooyu.fun/layout.zip',
      sha256: component.sha256, sizeBytes: component.sizeBytes }, content };
  return { archive, sourceFile, component, content, release };
}

test('bundle store persists the archive and re-verifies every expanded file on resolve', async t => {
  const api = await import(apiUrl);
  const root = await fs.promises.mkdtemp(path.resolve('.runtime/component-bundle-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const item = await fixture(root);
  const store = api.createCapabilityComponentBundleStore({ rootDirectory: path.join(root, 'store'),
    quotaBytes: item.component.sizeBytes + item.content.expandedSizeBytes + 1024 });
  const installed = await store.install({ release: item.release, sourceFile: item.sourceFile });
  assert.equal(installed.existing, false);
  assert.equal(path.isAbsolute(installed.archivePath), true);
  assert.deepEqual(installed.files.map(file => file.path),
    ['models/layout.json', 'models/weights.bin']);
  const inventory = await store.inventory();
  assert.equal(JSON.stringify(inventory).includes(root), false);
  assert.equal(inventory.entries[0].active, true);
  await assert.rejects(store.remove(item.component),
    error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_IN_USE');
  const resolved = await store.resolve({ component: item.component, release: item.release });
  assert.deepEqual(resolved.content, item.content);
  const metadataPath = path.join(path.dirname(resolved.archivePath), 'install.json');
  const metadata = await fs.promises.readFile(metadataPath);
  const changedMetadata = JSON.parse(metadata.toString('utf8'));
  changedMetadata.release.content.fileCount += 1;
  await fs.promises.writeFile(metadataPath, JSON.stringify(changedMetadata));
  await assert.rejects(store.resolve({ component: item.component, release: item.release }),
    error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_IDENTITY_MISMATCH');
  await fs.promises.writeFile(metadataPath, metadata);
  await fs.promises.writeFile(resolved.files[0].absolutePath, '{"layout":false}');
  await assert.rejects(store.resolve({ component: item.component, release: item.release }),
    error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_CONTENT_INVALID');
});

test('component manager routes signed catalog v2 bundles through the bundle store', async t => {
  const api = await import(apiUrl);
  const root = await fs.promises.mkdtemp(path.resolve('.runtime/component-bundle-manager-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const item = await fixture(root), pair = crypto.generateKeyPairSync('ed25519');
  const keyId = 'component-release-2026';
  const catalog = api.signCapabilityComponentCatalog({
    schemaVersion: 'capability-component-catalog-v2', catalogId: 'mooyu-components', sequence: 2,
    generatedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2026-11-05T00:00:00.000Z',
    keyId, releases: [item.release], revokedComponentSha256s: [], signature: 'pending',
  }, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const trustedKeys = [{ keyId, status: 'active',
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    notBefore: '2026-10-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z' }];
  const fileStore = api.createCapabilityComponentStore({ rootDirectory: path.join(root, 'files') });
  const bundleStore = api.createCapabilityComponentBundleStore({
    rootDirectory: path.join(root, 'bundles') });
  let downloads = 0;
  const manager = api.createCapabilityComponentManager({ store: fileStore, bundleStore,
    downloadDirectory: path.join(root, 'downloads'), trustedKeys,
    now: () => new Date('2026-10-29T01:00:00.000Z'),
    fetchImpl: async () => { downloads += 1; return new Response(item.archive, {
      status: 200, headers: { 'content-length': String(item.archive.length), etag: '"bundle-v1"' },
    }); } });
  const request = { catalog, component: item.component,
    engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['zh-Hans'] };
  const installed = await manager.ensure(request);
  assert.equal(installed.downloaded, true);
  assert.equal(installed.content.kind, 'zip-bundle');
  const cached = await manager.ensure(request);
  assert.equal(cached.downloaded, false);
  assert.equal(downloads, 1);
});
