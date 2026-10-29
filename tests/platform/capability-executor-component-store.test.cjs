const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-component-store-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const component = (id, role, version, bytes) => ({ componentId: id, role, version,
  sha256: digest(bytes), sizeBytes: bytes.length });
const release = (value, sequence = 1, url = 'https://downloads.mooyu.fun/component.bin') => ({
  componentId: value.componentId, componentVersion: value.version, releaseSequence: sequence,
  role: value.role, engine: { name: 'PP-StructureV3', version: '3.0.0' },
  platform: 'win32-x64', languages: ['zh-Hans', 'en'],
  download: { url, sha256: value.sha256, sizeBytes: value.sizeBytes },
});

test('component store installs content-addressed files and exposes a redacted inventory', async () => {
  const api = await import(apiUrl), root = await tempRoot('install-');
  try {
    const bytes = Buffer.from('recognition-model-v1'), sourceFile = path.join(root, 'source.bin');
    await fs.promises.writeFile(sourceFile, bytes);
    const identity = component('pp-ocr-rec-model', 'ocr-recognition-model', '3.0.0', bytes);
    const store = api.createCapabilityComponentStore({ rootDirectory: path.join(root, 'store'),
      quotaBytes: 1024 });
    const installed = await store.install({ release: release(identity), sourceFile });
    assert.equal(installed.existing, false);
    assert.deepEqual(await fs.promises.readFile(installed.absolutePath), bytes);
    const second = await store.install({ release: release(identity), sourceFile });
    assert.equal(second.existing, true);
    const resolved = await store.resolve(identity);
    assert.equal(resolved.component.sha256, identity.sha256);
    const inventory = await store.inventory();
    assert.equal(inventory.usedBytes, bytes.length);
    assert.equal(inventory.entries[0].active, true);
    assert.equal(JSON.stringify(inventory).includes(root), false);
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test('component store fails closed on source and installed-content tampering', async () => {
  const api = await import(apiUrl), root = await tempRoot('tamper-');
  try {
    const bytes = Buffer.from('layout-model-v1'), sourceFile = path.join(root, 'source.bin');
    await fs.promises.writeFile(sourceFile, Buffer.from('wrong-source'));
    const identity = component('pp-layout-model', 'layout-model', '3.0.0', bytes);
    const store = api.createCapabilityComponentStore({ rootDirectory: path.join(root, 'store'),
      quotaBytes: 1024 });
    await assert.rejects(store.install({ release: release(identity), sourceFile }),
      error => error.code === 'CAPABILITY_COMPONENT_SOURCE_INVALID');
    await fs.promises.writeFile(sourceFile, bytes);
    const installed = await store.install({ release: release(identity), sourceFile });
    await fs.promises.writeFile(installed.absolutePath, Buffer.from('tampered-model'));
    await assert.rejects(store.resolve(identity),
      error => error.code === 'CAPABILITY_COMPONENT_INSTALLATION_INVALID');
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test('component store enforces quota and protects active and rollback references during cleanup', async () => {
  const api = await import(apiUrl), root = await tempRoot('quota-');
  try {
    const store = api.createCapabilityComponentStore({ rootDirectory: path.join(root, 'store'),
      quotaBytes: 24 });
    const versions = [Buffer.from('model-v1'), Buffer.from('model-v2'), Buffer.from('model-v3')];
    const identities = versions.map((bytes, index) => component('pp-table-model', 'table-model',
      `3.0.${index}`, bytes));
    for (let index = 0; index < 2; index += 1) {
      const sourceFile = path.join(root, `source-${index}.bin`);
      await fs.promises.writeFile(sourceFile, versions[index]);
      await store.install({ release: release(identities[index], index + 1), sourceFile });
    }
    const overQuota = Buffer.from('this-model-is-too-large');
    const overIdentity = component('pp-formula-model', 'formula-model', '3.0.0', overQuota);
    const overSource = path.join(root, 'over.bin');
    await fs.promises.writeFile(overSource, overQuota);
    await assert.rejects(store.install({ release: release(overIdentity), sourceFile: overSource }),
      error => error.code === 'CAPABILITY_COMPONENT_QUOTA_EXCEEDED');
    await assert.rejects(store.remove(identities[1]),
      error => error.code === 'CAPABILITY_COMPONENT_IN_USE');
    const thirdSource = path.join(root, 'source-2.bin');
    await fs.promises.writeFile(thirdSource, versions[2]);
    await store.install({ release: release(identities[2], 3), sourceFile: thirdSource });
    const pruned = await store.pruneUnused();
    assert.deepEqual(pruned.removed.map(item => item.sha256), [identities[0].sha256]);
    assert.equal((await store.inventory()).entries.length, 2);
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test('component manager verifies the signed catalog before a resumable local install', async () => {
  const api = await import(apiUrl), root = await tempRoot('manager-');
  const bytes = crypto.randomBytes(384 * 1024);
  const identity = component('pp-ocr-det-model', 'ocr-detection-model', '3.0.0', bytes);
  const pair = crypto.generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const trustedKeys = [{ keyId: 'component-release-2026', status: 'active', publicKeyPem: publicKey,
    notBefore: '2026-10-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z' }];
  const catalog = api.signCapabilityComponentCatalog({ schemaVersion: 'capability-component-catalog-v1',
    catalogId: 'mooyu-components', sequence: 1, generatedAt: '2026-10-29T00:00:00.000Z',
    expiresAt: '2026-11-05T00:00:00.000Z', keyId: 'component-release-2026',
    releases: [release(identity)], revokedComponentSha256s: [], signature: 'pending' }, privateKey);
  const controller = new AbortController();
  let requests = 0, observedRange = null;
  const server = http.createServer((request, response) => {
    requests += 1;
    observedRange = request.headers.range ?? observedRange;
    if (requests === 1) {
      response.writeHead(200, { 'content-length': bytes.length, etag: '"component-v1"' });
      response.flushHeaders();
      response.write(bytes.subarray(0, 128 * 1024), () => {
        setTimeout(() => controller.abort(), 75);
      });
      return;
    }
    const offset = Number(String(request.headers.range).match(/^bytes=(\d+)-$/u)?.[1]);
    response.writeHead(206, { 'content-length': bytes.length - offset,
      'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}`,
      etag: '"component-v1"' });
    response.end(bytes.subarray(offset));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const localUrl = `http://127.0.0.1:${server.address().port}/component.bin`;
    const store = api.createCapabilityComponentStore({ rootDirectory: path.join(root, 'store'),
      quotaBytes: bytes.length * 2 });
    const manager = api.createCapabilityComponentManager({ store,
      downloadDirectory: path.join(root, 'downloads'), trustedKeys,
      now: () => new Date('2026-10-29T04:00:00.000Z'), allowInsecureLocalhost: true,
      resolveDownloadUrl: () => localUrl });
    const request = { catalog, component: identity,
      engine: { name: 'PP-StructureV3', version: '3.0.0' }, languages: ['zh-Hans'] };
    await assert.rejects(manager.ensure({ ...request, signal: controller.signal }));
    const installed = await manager.ensure(request);
    assert.equal(installed.downloaded, true);
    assert.match(observedRange, /^bytes=\d+-$/u);
    assert.deepEqual(await fs.promises.readFile(installed.absolutePath), bytes);
    const cached = await manager.ensure(request);
    assert.equal(cached.downloaded, false);
    assert.equal(requests, 2);
    const tampered = structuredClone(catalog);
    tampered.releases[0].download.url = 'https://evil.example/component.bin';
    await assert.rejects(manager.ensure({ ...request, catalog: tampered }),
      error => error.code === 'CAPABILITY_COMPONENT_CATALOG_SIGNATURE_INVALID');
    assert.equal(requests, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
