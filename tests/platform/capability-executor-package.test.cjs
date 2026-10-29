const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const zipUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/zip-buffer-writer.mjs')).href;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${crypto
  .createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
const tempRoot = async prefix => {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};

async function fixture({ version = '1.0.0', executable = Buffer.from('fixture-v1'),
  packageManifestTransform, entriesTransform } = {}) {
  const api = await import(executorUrl);
  const { createZipBuffer } = await import(zipUrl);
  const packageManifest = {
    schemaVersion: 'capability-package-v1', capabilityId: 'research.fixture',
    capabilityVersion: version, contract: { key: 'research.fixture', version: 1 },
    entrypoint: { kind: 'native-executable', path: 'bin/fixture.exe', arguments: [] },
    files: [{ path: 'bin/fixture.exe', sha256: sha256(executable),
      sizeBytes: executable.length, executable: true }],
  };
  packageManifestTransform?.(packageManifest);
  let entries = [{ name: 'capability.json', data: JSON.stringify(packageManifest) },
    { name: 'bin/fixture.exe', data: executable }];
  entries = entriesTransform?.(entries) ?? entries;
  const archive = createZipBuffer(entries);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const manifest = {
    capabilityId: 'research.fixture', capabilityVersion: version,
    contract: { key: 'research.fixture', version: 1 },
    placements: [{ target: 'desktop', adapter: 'native-package',
      platforms: ['windows-x64'], package: {
        url: `https://downloads.mooyu.fun/research-fixture-${version}.zip`,
        sha256: sha256(archive), sizeBytes: archive.length,
        keyId: 'mooyu.release.fixture', signature: 'x'.repeat(64),
      } }],
  };
  const statement = api.packageReleaseStatement(manifest, 0);
  manifest.placements[0].package.signature = crypto.sign(null,
    Buffer.from(api.stableJson(statement)), privateKey).toString('base64url');
  return { api, archive, manifest, trustedKeys: [{ keyId: 'mooyu.release.fixture',
    status: 'active', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    notBefore: '2026-01-01T00:00:00.000Z', notAfter: null }] };
}

async function writeArchive(directory, buffer, name = 'package.zip') {
  const file = path.join(directory, name);
  await fs.promises.writeFile(file, buffer);
  return file;
}

test('signed packages install in isolated versions and roll back atomically', async t => {
  const root = await tempRoot('package-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const v1 = await fixture(), archive1 = await writeArchive(root, v1.archive, 'v1.zip');
  const store = v1.api.createCapabilityPackageStore({ rootDirectory: path.join(root, 'store'),
    trustedKeys: v1.trustedKeys, platform: 'windows-x64' });
  const installed1 = await store.install({ manifest: v1.manifest, placementIndex: 0, archivePath: archive1 });
  assert.equal(installed1.packageManifest.entrypoint.path, 'bin/fixture.exe');
  assert.equal((await store.verifyActive({ manifest: v1.manifest, placementIndex: 0 })).existing, true);

  const v2 = await fixture({ version: '1.1.0', executable: Buffer.from('fixture-v2') });
  v2.trustedKeys = v1.trustedKeys;
  // Re-sign v2 with the key trusted by this store.
  const shared = crypto.generateKeyPairSync('ed25519');
  const publicPem = shared.publicKey.export({ type: 'spki', format: 'pem' });
  const trustedKeys = [{ ...v1.trustedKeys[0], publicKeyPem: publicPem }];
  const resign = item => {
    item.manifest.placements[0].package.signature = crypto.sign(null,
      Buffer.from(item.api.stableJson(item.api.packageReleaseStatement(item.manifest, 0))),
      shared.privateKey).toString('base64url');
  };
  resign(v1); resign(v2);
  const sharedStore = v1.api.createCapabilityPackageStore({ rootDirectory: path.join(root, 'shared-store'),
    trustedKeys, platform: 'windows-x64' });
  const sharedArchive1 = await writeArchive(root, v1.archive, 'shared-v1.zip');
  const archive2 = await writeArchive(root, v2.archive, 'shared-v2.zip');
  await sharedStore.install({ manifest: v1.manifest, placementIndex: 0, archivePath: sharedArchive1 });
  await sharedStore.install({ manifest: v2.manifest, placementIndex: 0, archivePath: archive2 });
  assert.equal((await sharedStore.active('research.fixture')).capabilityVersion, '1.1.0');
  assert.equal((await sharedStore.rollback('research.fixture')).capabilityVersion, '1.0.0');
  assert.equal((await sharedStore.active('research.fixture')).capabilityVersion, '1.0.0');
});

test('package verification rejects tampering before activation', async t => {
  const root = await tempRoot('tamper-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const value = await fixture(), store = value.api.createCapabilityPackageStore({
    rootDirectory: path.join(root, 'store'), trustedKeys: value.trustedKeys, platform: 'windows-x64' });
  const tampered = Buffer.from(value.archive);
  tampered[10] ^= 1;
  const archive = await writeArchive(root, tampered);
  await assert.rejects(store.install({ manifest: value.manifest, placementIndex: 0, archivePath: archive }),
    error => error.code === 'CAPABILITY_PACKAGE_ARCHIVE_HASH_MISMATCH');
  assert.equal(await store.active('research.fixture'), null);
});

test('secure extraction rejects zip traversal and internal file hash mismatch', async t => {
  const root = await tempRoot('zip-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const traversal = await fixture({ entriesTransform: entries => [...entries,
    { name: '../escape.txt', data: 'escape' }] });
  const traversalArchive = await writeArchive(root, traversal.archive, 'traversal.zip');
  const traversalStore = traversal.api.createCapabilityPackageStore({ rootDirectory: path.join(root, 'traversal'),
    trustedKeys: traversal.trustedKeys, platform: 'windows-x64' });
  await assert.rejects(traversalStore.install({ manifest: traversal.manifest, placementIndex: 0,
    archivePath: traversalArchive }), error => error.code === 'CAPABILITY_PACKAGE_ARCHIVE_PATH_INVALID');
  assert.equal(await fs.promises.stat(path.join(root, 'escape.txt')).catch(() => null), null);

  const mismatch = await fixture({ executable: Buffer.from('actual'),
    packageManifestTransform: manifest => { manifest.files[0].sha256 = sha256(Buffer.from('declared')); } });
  const mismatchArchive = await writeArchive(root, mismatch.archive, 'mismatch.zip');
  const mismatchStore = mismatch.api.createCapabilityPackageStore({ rootDirectory: path.join(root, 'mismatch'),
    trustedKeys: mismatch.trustedKeys, platform: 'windows-x64' });
  await assert.rejects(mismatchStore.install({ manifest: mismatch.manifest, placementIndex: 0,
    archivePath: mismatchArchive }), error => error.code === 'CAPABILITY_PACKAGE_FILE_HASH_MISMATCH');
});

test('an abandoned installer lock is reclaimed only after its owner is gone and stale', async t => {
  const root = await tempRoot('stale-lock-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const value = await fixture(), storeRoot = path.join(root, 'store');
  const archive = await writeArchive(root, value.archive);
  const lock = path.join(storeRoot, 'state', safeSegment('research.fixture'), 'install.lock');
  await fs.promises.mkdir(path.dirname(lock), { recursive: true });
  await fs.promises.writeFile(lock, JSON.stringify({ pid: 2147483647,
    createdAt: '2020-01-01T00:00:00.000Z' }));
  const old = new Date(Date.now() - 120_000);
  await fs.promises.utimes(lock, old, old);
  const store = value.api.createCapabilityPackageStore({ rootDirectory: storeRoot,
    trustedKeys: value.trustedKeys, platform: 'windows-x64', lockStaleAfterMs: 60_000 });
  assert.equal((await store.install({ manifest: value.manifest, placementIndex: 0,
    archivePath: archive })).capabilityVersion, '1.0.0');
  assert.equal(await fs.promises.stat(lock).catch(() => null), null);
});
