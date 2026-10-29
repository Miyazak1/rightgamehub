const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const zipUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/zip-buffer-writer.mjs')).href;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const tempRoot = async prefix => {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};

async function bundleFixture(root, overrides = {}) {
  const { createZipBuffer } = await import(zipUrl);
  const payload = overrides.payload ?? [
    { name: 'models/layout/model.json', data: '{"model":"layout"}' },
    { name: 'models/layout/weights.bin', data: Buffer.from([1, 2, 3, 4]) },
  ];
  const files = payload.map(item => ({ path: item.name, sha256: digest(item.data),
    sizeBytes: Buffer.byteLength(item.data), executable: false }));
  const manifest = overrides.manifest ?? { schemaVersion: 'capability-component-bundle-v1',
    component: { componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0' },
    files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const entries = [{ name: 'component.bundle.json', data: manifestBytes },
    ...payload.map(item => ({ name: `payload/${item.name}`, data: item.data })),
    ...(overrides.extraEntries ?? [])];
  const archive = createZipBuffer(entries), archivePath = path.join(root, 'component.zip');
  await fs.promises.writeFile(archivePath, archive);
  return { archivePath, component: { componentId: 'pp-layout-model', role: 'layout-model',
    version: '1.0.0', sha256: digest(archive), sizeBytes: archive.length }, manifest,
    content: { kind: 'zip-bundle', manifestSha256: digest(manifestBytes),
      fileCount: files.length, expandedSizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) } };
}

test('component bundle extracts a deterministic, fully verified multi-file payload', async t => {
  const api = await import(executorUrl), root = await tempRoot('component-bundle-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const fixture = await bundleFixture(root), destination = path.join(root, 'installed');
  const result = await api.extractVerifiedCapabilityComponentBundle({ ...fixture, destination });
  assert.equal(result.schemaVersion, 'capability-component-bundle-install-v1');
  assert.equal(result.component.sha256, fixture.component.sha256);
  assert.deepEqual(result.files.map(item => item.path),
    ['models/layout/model.json', 'models/layout/weights.bin']);
  assert.equal(result.expandedSizeBytes, result.files.reduce((sum, item) => sum + item.sizeBytes, 0));
  assert.equal(await fs.promises.readFile(result.files[0].absolutePath, 'utf8'), '{"model":"layout"}');
  const repeated = await api.verifyInstalledCapabilityComponentBundle({
    archivePath: fixture.archivePath, bundleDirectory: destination,
    component: fixture.component, content: fixture.content,
  });
  assert.deepEqual(repeated.content, fixture.content);

  await fs.promises.writeFile(result.files[0].absolutePath, '{"model":"changed"}');
  await assert.rejects(api.verifyInstalledCapabilityComponentBundle({
    archivePath: fixture.archivePath, bundleDirectory: destination,
    component: fixture.component, content: fixture.content,
  }), error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_CONTENT_INVALID');
});

test('component bundle rejects undeclared, changed and path-traversing content and cleans staging', async t => {
  const api = await import(executorUrl), { createZipBuffer } = await import(zipUrl);
  const root = await tempRoot('component-bundle-invalid-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const extra = await bundleFixture(root, { extraEntries: [{ name: 'payload/undeclared.bin', data: 'x' }] });
  const extraDestination = path.join(root, 'extra');
  await assert.rejects(api.extractVerifiedCapabilityComponentBundle({ ...extra,
    destination: extraDestination }), error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_CONTENT_INVALID');
  assert.equal(await fs.promises.lstat(extraDestination).catch(() => null), null);

  const changedManifest = { schemaVersion: 'capability-component-bundle-v1',
    component: { componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0' },
    files: [{ path: 'model.bin', sha256: digest('expected'), sizeBytes: 7, executable: false }] };
  const changedArchive = createZipBuffer([{ name: 'component.bundle.json',
    data: JSON.stringify(changedManifest) }, { name: 'payload/model.bin', data: 'changed' }]);
  const changedPath = path.join(root, 'changed.zip');
  await fs.promises.writeFile(changedPath, changedArchive);
  await assert.rejects(api.extractVerifiedCapabilityComponentBundle({ archivePath: changedPath,
    destination: path.join(root, 'changed'), component: { componentId: 'pp-layout-model',
      role: 'layout-model', version: '1.0.0', sha256: digest(changedArchive),
      sizeBytes: changedArchive.length } }),
  error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_CONTENT_INVALID');

  const invalidManifest = { schemaVersion: 'capability-component-bundle-v1',
    component: { componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0' },
    files: [{ path: '../escape.bin', sha256: digest('x'), sizeBytes: 1, executable: false }] };
  const traversalArchive = createZipBuffer([{ name: 'component.bundle.json',
    data: JSON.stringify(invalidManifest) }, { name: 'payload/escape.bin', data: 'x' }]);
  const traversalPath = path.join(root, 'traversal.zip');
  await fs.promises.writeFile(traversalPath, traversalArchive);
  await assert.rejects(api.extractVerifiedCapabilityComponentBundle({ archivePath: traversalPath,
    destination: path.join(root, 'traversal'), component: { componentId: 'pp-layout-model',
      role: 'layout-model', version: '1.0.0', sha256: digest(traversalArchive),
      sizeBytes: traversalArchive.length } }),
  error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_MANIFEST_INVALID');
});

test('component bundle verifies the signed outer archive identity before extraction', async t => {
  const api = await import(executorUrl), root = await tempRoot('component-bundle-tamper-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const fixture = await bundleFixture(root);
  fixture.component.sha256 = 'f'.repeat(64);
  await assert.rejects(api.extractVerifiedCapabilityComponentBundle({ ...fixture,
    destination: path.join(root, 'installed') }),
  error => error.code === 'CAPABILITY_COMPONENT_BUNDLE_ARCHIVE_TAMPERED'
    && error.safeFailure === true);
});
