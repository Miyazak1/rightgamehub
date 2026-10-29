const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const bootstrapUrl = pathToFileURL(path.resolve(__dirname,
  '../../scripts/windows-desktop-bootstrap-cli.mjs')).href;
const zipUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/zip-buffer-writer.mjs')).href;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-desktop-updater-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const keyPair = () => crypto.generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const trusted = (publicKeyPem, keyId) => [{ keyId, status: 'active', publicKeyPem,
  notBefore: '2026-01-01T00:00:00.000Z', notAfter: null }];
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${digest(String(value)).slice(0, 12)}`;

async function listFiles(root, directory = root) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files;
}

async function releaseFixture(api, root, version, keys) {
  const directory = path.join(root, `desktop source ${version}`);
  const content = {
    'bin/node.exe': `node-${version}`,
    'app/scripts/windows-desktop-product-host.mjs': `host-${version}`,
    'app/scripts/windows-desktop-bootstrap-cli.mjs': `bootstrap-${version}`,
    'bin/MooyuCapabilityTray.exe': `tray-${version}`,
    'bin/MooyuCapabilitySandboxHost.exe': `sandbox-${version}`,
    'app/support/readme.txt': `support-${version}`,
  };
  const roles = { 'bin/node.exe': 'node-runtime',
    'app/scripts/windows-desktop-product-host.mjs': 'desktop-shell',
    'bin/MooyuCapabilityTray.exe': 'tray',
    'bin/MooyuCapabilitySandboxHost.exe': 'sandbox-host' };
  const files = [];
  for (const [relative, value] of Object.entries(content)) {
    const absolute = path.join(directory, ...relative.split('/'));
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    const bytes = Buffer.from(value);
    await fs.promises.writeFile(absolute, bytes);
    files.push({ path: relative, sha256: digest(bytes), sizeBytes: bytes.length,
      role: roles[relative] ?? 'runtime-support' });
  }
  const byPath = value => files.find(file => file.path === value);
  const manifest = api.signWindowsDesktopReleaseManifest({
    schemaVersion: 'windows-desktop-release-v1',
    productId: api.WINDOWS_DESKTOP_PRODUCT_ID, productVersion: version,
    platform: 'win32-x64', minimumOsBuild: 19041, keyId: 'desktop-release-test', files,
    entrypoints: {
      nodeRuntime: { path: 'bin/node.exe', sha256: byPath('bin/node.exe').sha256 },
      shell: { path: 'app/scripts/windows-desktop-product-host.mjs',
        sha256: byPath('app/scripts/windows-desktop-product-host.mjs').sha256 },
      tray: { path: 'bin/MooyuCapabilityTray.exe',
        sha256: byPath('bin/MooyuCapabilityTray.exe').sha256 },
      sandboxHost: { path: 'bin/MooyuCapabilitySandboxHost.exe',
        sha256: byPath('bin/MooyuCapabilitySandboxHost.exe').sha256 },
    }, signature: 'pending',
  }, keys.privateKey);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await fs.promises.writeFile(path.join(directory, 'desktop.json'), manifestBytes);
  const { createZipBuffer } = await import(zipUrl);
  const archiveBytes = createZipBuffer(await Promise.all((await listFiles(directory)).map(
    async name => ({ name, data: await fs.promises.readFile(path.join(directory,
      ...name.split('/'))) }))));
  const archive = path.join(root, `desktop-${version}.zip`);
  await fs.promises.writeFile(archive, archiveBytes);
  return { directory, manifest, manifestSha256: digest(manifestBytes), archive, archiveBytes,
    archiveSha256: digest(archiveBytes) };
}

function fakeStartup() {
  const values = new Map();
  return { values,
    async query(valueName) { return values.has(valueName)
      ? { enabled: true, commandLine: values.get(valueName).join(' ') }
      : { enabled: false, commandLine: null }; },
    async enable({ valueName, command }) { values.set(valueName, [...command]);
      return { enabled: true, commandLine: command.join(' ') }; },
    async disable(valueName) { values.delete(valueName);
      return { enabled: false, commandLine: null }; },
  };
}

function productManager(api, root, keys) {
  const installRoot = path.join(root, 'ordinary user programs');
  const dataRoot = path.join(root, 'ordinary user data');
  const productStore = api.createWindowsDesktopReleaseStore({ installRoot,
    trustedKeys: trusted(keys.publicKey, 'desktop-release-test'), osBuild: 26100 });
  const shellManager = api.createDesktopShellManager({ rootDirectory: dataRoot,
    startupRegistry: fakeStartup(),
    stateStore: api.createDesktopNodeStateStore({ rootDirectory: dataRoot }),
    credentialVault: api.createMemoryCredentialVault() });
  const manager = api.createWindowsDesktopProductManager({ productStore, shellManager, dataRoot,
    configurationPath: path.join(dataRoot, 'shell config.json') });
  return { manager, productStore, installRoot, dataRoot };
}

function signedCatalog(api, privateKey, release, sequence, releaseSequence, revoked = []) {
  return api.signWindowsDesktopUpdateCatalog({
    schemaVersion: 'windows-desktop-update-catalog-v1', catalogId: 'mooyu.desktop.stable',
    sequence, generatedAt: '2026-10-28T00:00:00.000Z',
    expiresAt: '2026-10-30T00:00:00.000Z', keyId: 'desktop-catalog-test',
    releases: [{ productId: api.WINDOWS_DESKTOP_PRODUCT_ID,
      productVersion: release.manifest.productVersion, releaseSequence,
      platform: 'win32-x64', minimumOsBuild: 19041,
      manifestSha256: release.manifestSha256,
      archive: { url: `https://updates.mooyu.invalid/${path.basename(release.archive)}`,
        sha256: release.archiveSha256, sizeBytes: release.archiveBytes.length } }],
    revokedManifestSha256s: revoked, signature: 'pending',
  }, privateKey);
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('desktop catalog binds product release, expiry and revocation bytes', async () => {
  const api = await import(apiUrl), keys = keyPair();
  const manifestSha256 = digest('manifest');
  const catalog = api.signWindowsDesktopUpdateCatalog({
    schemaVersion: 'windows-desktop-update-catalog-v1', catalogId: 'mooyu.desktop.stable',
    sequence: 4, generatedAt: '2026-10-28T00:00:00.000Z',
    expiresAt: '2026-10-30T00:00:00.000Z', keyId: 'desktop-catalog-test',
    releases: [{ productId: api.WINDOWS_DESKTOP_PRODUCT_ID, productVersion: '1.2.0',
      releaseSequence: 2, platform: 'win32-x64', minimumOsBuild: 19041,
      manifestSha256, archive: { url: 'https://updates.mooyu.fun/desktop.zip',
        sha256: digest('archive'), sizeBytes: 100 } }],
    revokedManifestSha256s: [], signature: 'pending',
  }, keys.privateKey);
  assert.equal(api.verifyWindowsDesktopUpdateCatalog({ catalog,
    trustedKeys: trusted(keys.publicKey, 'desktop-catalog-test'),
    now: new Date('2026-10-29T00:00:00.000Z') }).sequence, 4);
  assert.throws(() => api.verifyWindowsDesktopUpdateCatalog({
    catalog: { ...catalog, revokedManifestSha256s: [manifestSha256] },
    trustedKeys: trusted(keys.publicKey, 'desktop-catalog-test'),
    now: new Date('2026-10-29T00:00:00.000Z') }), error =>
    error.code === 'CAPABILITY_DESKTOP_UPDATE_CATALOG_SIGNATURE_INVALID');
  assert.throws(() => api.verifyWindowsDesktopUpdateCatalog({ catalog,
    trustedKeys: trusted(keys.publicKey, 'desktop-catalog-test'),
    now: new Date('2026-10-31T00:00:00.000Z') }), error =>
    error.code === 'CAPABILITY_DESKTOP_UPDATE_CATALOG_EXPIRED');
});

test('desktop updater resumes Range, rejects poisoned cache and rolls back failed health', {
  timeout: 60_000,
}, async t => {
  const api = await import(apiUrl), root = await tempRoot('lifecycle with spaces ');
  const releaseKeys = keyPair(), catalogKeys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const one = await releaseFixture(api, root, '1.0.0', releaseKeys);
  const two = await releaseFixture(api, root, '1.1.0', releaseKeys);
  const three = await releaseFixture(api, root, '1.2.0', releaseKeys);
  const product = productManager(api, root, releaseKeys);
  await product.manager.install({ sourceDirectory: one.directory });
  let catalog = signedCatalog(api, catalogKeys.privateKey, two, 2, 2);
  const archives = new Map([[path.basename(two.archive), two.archiveBytes],
    [path.basename(three.archive), three.archiveBytes]]);
  let observedRange = null, archiveRequests = 0;
  const { server, origin } = await listen((request, response) => {
    if (request.url === '/catalog.json') {
      const body = Buffer.from(JSON.stringify(catalog));
      response.writeHead(200, { 'content-type': 'application/json',
        'content-length': body.length });
      response.end(body); return;
    }
    const name = path.basename(request.url), body = archives.get(name);
    if (!body) { response.writeHead(404); response.end(); return; }
    archiveRequests += 1;
    const match = String(request.headers.range ?? '').match(/^bytes=(\d+)-$/u);
    const offset = match ? Number(match[1]) : 0;
    if (match) observedRange = request.headers.range;
    response.writeHead(match ? 206 : 200, {
      'content-type': 'application/zip', 'content-length': body.length - offset,
      ...(match ? { 'content-range': `bytes ${offset}-${body.length - 1}/${body.length}` } : {}),
      etag: `"${name}"`,
    });
    response.end(body.subarray(offset));
  });
  try {
    const updaterRoot = path.join(root, 'updater state');
    const options = { rootDirectory: updaterRoot, productId: api.WINDOWS_DESKTOP_PRODUCT_ID,
      productManager: product.manager,
      trustedCatalogKeys: trusted(catalogKeys.publicKey, 'desktop-catalog-test'),
      catalogUrl: `${origin}/catalog.json`, osBuild: 26100, platform: 'win32',
      allowInsecureLocalhost: true,
      archiveUrlResolver: value => `${origin}/${path.basename(new URL(value).pathname)}`,
      now: () => new Date('2026-10-29T00:00:00.000Z') };
    const downloads = path.join(updaterRoot, 'downloads');
    await fs.promises.mkdir(downloads, { recursive: true });
    const base = path.join(downloads, two.archiveSha256), partial = two.archiveBytes.subarray(0, 73);
    await fs.promises.writeFile(`${base}.part`, partial);
    await fs.promises.writeFile(`${base}.part.json`, JSON.stringify({
      schemaVersion: 'runtime-download-part-v1',
      url: `${origin}/${path.basename(two.archive)}`, expectedBytes: two.archiveBytes.length,
      expectedSha256: two.archiveSha256, etag: `"${path.basename(two.archive)}"`,
    }));
    const updater = api.createWindowsDesktopUpdater(options);
    assert.equal((await updater.checkAndApply()).status, 'updated');
    assert.equal(observedRange, `bytes=${partial.length}-`);
    assert.equal((await product.manager.status()).release.productVersion, '1.1.0');
    assert.equal((await updater.checkAndApply()).status, 'current');

    const activeTwo = await product.productStore.active(api.WINDOWS_DESKTOP_PRODUCT_ID);
    const trayTwo = path.join(activeTwo.absoluteDirectory, 'bin', 'MooyuCapabilityTray.exe');
    await fs.promises.writeFile(trayTwo, 'poisoned-installed-byte');
    assert.equal((await updater.checkAndApply()).status, 'updated');
    assert.equal(await fs.promises.readFile(trayTwo, 'utf8'), 'tray-1.1.0');

    catalog = signedCatalog(api, catalogKeys.privateKey, three, 3, 3);
    const poisoned = path.join(downloads, `${three.archiveSha256}.zip`);
    await fs.promises.writeFile(poisoned, Buffer.alloc(three.archiveBytes.length, 7));
    const before = archiveRequests;
    const failing = api.createWindowsDesktopUpdater({ ...options,
      healthProbe: async () => { throw Object.assign(new Error('probe failed'),
        { code: 'PROBE_FAILED' }); } });
    await assert.rejects(failing.checkAndApply(), error =>
      error.code === 'CAPABILITY_DESKTOP_UPDATE_HEALTH_FAILED');
    assert.ok(archiveRequests > before);
    assert.equal((await product.manager.status()).release.productVersion, '1.1.0');
    assert.equal((await failing.status()).recentAudit.at(-1).type, 'health-failed-rolled-back');

    catalog = signedCatalog(api, catalogKeys.privateKey, one, 1, 1);
    await assert.rejects(updater.checkAndApply(), error =>
      error.code === 'CAPABILITY_DESKTOP_UPDATE_CATALOG_ROLLBACK');
    const lock = path.join(updaterRoot, 'update-state',
      safeSegment(api.WINDOWS_DESKTOP_PRODUCT_ID), 'update.lock');
    await fs.promises.mkdir(path.dirname(lock), { recursive: true });
    await fs.promises.writeFile(lock, JSON.stringify({ pid: process.pid }));
    await assert.rejects(updater.checkAndApply(), error =>
      error.code === 'CAPABILITY_DESKTOP_UPDATE_BUSY');
    await fs.promises.rm(lock, { force: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('desktop updater recovers rollback and commit journals after interruption', async t => {
  const api = await import(apiUrl), root = await tempRoot('recover-');
  const releaseKeys = keyPair(), catalogKeys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const one = await releaseFixture(api, root, '2.0.0', releaseKeys);
  const two = await releaseFixture(api, root, '2.1.0', releaseKeys);
  const product = productManager(api, root, releaseKeys);
  await product.manager.install({ sourceDirectory: one.directory });
  const updaterRoot = path.join(root, 'updater');
  const updater = api.createWindowsDesktopUpdater({ rootDirectory: updaterRoot,
    productId: api.WINDOWS_DESKTOP_PRODUCT_ID, productManager: product.manager,
    trustedCatalogKeys: trusted(catalogKeys.publicKey, 'desktop-catalog-test'),
    catalogUrl: 'https://updates.mooyu.invalid/catalog.json', osBuild: 26100,
    platform: 'win32', now: () => new Date('2026-10-29T00:00:00.000Z') });
  const stateDirectory = path.join(updaterRoot, 'update-state',
    safeSegment(api.WINDOWS_DESKTOP_PRODUCT_ID));
  const journal = path.join(stateDirectory, 'transaction.json');
  await product.manager.install({ sourceDirectory: two.directory });
  await fs.promises.mkdir(stateDirectory, { recursive: true });
  await fs.promises.writeFile(journal, JSON.stringify({
    schemaVersion: 'windows-desktop-update-transaction-v1',
    productId: api.WINDOWS_DESKTOP_PRODUCT_ID, phase: 'health-check',
    priorManifestSha256: one.manifestSha256, targetManifestSha256: two.manifestSha256,
    releaseSequence: 2, createdAt: '2026-10-29T00:00:00.000Z',
  }));
  assert.equal((await updater.recover()).status, 'recovered');
  assert.equal((await product.manager.status()).release.productVersion, '2.0.0');

  await product.manager.install({ sourceDirectory: two.directory });
  const nextState = { schemaVersion: 'windows-desktop-updater-state-v1',
    productId: api.WINDOWS_DESKTOP_PRODUCT_ID, catalogId: 'mooyu.desktop.stable',
    highestCatalogSequence: 2, catalogSha256: digest('catalog-two'), releaseSequence: 2,
    manifestSha256: two.manifestSha256, updatedAt: '2026-10-29T00:00:00.000Z' };
  await fs.promises.writeFile(journal, JSON.stringify({
    schemaVersion: 'windows-desktop-update-transaction-v1',
    productId: api.WINDOWS_DESKTOP_PRODUCT_ID, phase: 'committing',
    priorManifestSha256: one.manifestSha256, targetManifestSha256: two.manifestSha256,
    releaseSequence: 2, createdAt: '2026-10-29T00:00:00.000Z', nextState,
  }));
  assert.equal((await updater.recover()).status, 'commit-recovered');
  assert.equal((await updater.status()).state.manifestSha256, two.manifestSha256);
});

test('desktop catalog builder and no-admin bootstrap package verify exact signed bytes', async t => {
  const api = await import(apiUrl), root = await tempRoot('publisher-');
  const releaseKeys = keyPair(), catalogKeys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const release = await releaseFixture(api, root, '3.0.0', releaseKeys);
  const privateKey = path.join(root, 'catalog private.pem');
  const spec = path.join(root, 'catalog build.json'), output = path.join(root, 'catalog.json');
  await fs.promises.writeFile(privateKey, catalogKeys.privateKey, { mode: 0o600 });
  await fs.promises.writeFile(spec, JSON.stringify({
    schemaVersion: 'windows-desktop-update-catalog-build-v1',
    catalogId: 'mooyu.desktop.stable', sequence: 1,
    generatedAt: '2026-10-28T00:00:00.000Z', expiresAt: '2026-10-30T00:00:00.000Z',
    keyId: 'desktop-catalog-test', releases: [{ releaseDirectory: release.directory,
      archivePath: release.archive,
      archiveUrl: 'https://updates.mooyu.fun/desktop-3.0.0.zip', releaseSequence: 1 }],
    revokedManifestSha256s: [],
  }));
  const built = spawnSync(process.execPath,
    ['scripts/build-windows-desktop-update-catalog.mjs', '--input', spec,
      '--output', output, '--private-key', privateKey],
    { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  assert.equal(JSON.parse(await fs.promises.readFile(output, 'utf8'))
    .releases[0].manifestSha256, release.manifestSha256);

  const config = path.join(root, 'bootstrap input.json');
  await fs.promises.writeFile(config, JSON.stringify({
    schemaVersion: 'windows-desktop-bootstrap-config-v1',
    productDirectoryName: 'Mooyu Capability Desktop', dataDirectoryName: 'Mooyu Capability Data',
    bundledReleaseSource: 'ignored-by-builder', shellConfigName: 'shell.json',
    startupValueName: 'MooyuCapabilityNode',
    catalogUrl: 'https://updates.mooyu.fun/desktop/catalog.json',
    allowInsecureLocalhost: false,
    trustedReleaseKeys: trusted(releaseKeys.publicKey, 'desktop-release-test'),
    trustedCatalogKeys: trusted(catalogKeys.publicKey, 'desktop-catalog-test'),
  }));
  const packageDirectory = path.join(root, 'ordinary user package');
  const packaged = spawnSync(process.execPath,
    ['scripts/build-windows-desktop-bootstrap-package.mjs', '--release', release.directory,
      '--output', packageDirectory, '--config', config],
    { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(packaged.status, 0, packaged.stderr || packaged.stdout);
  const installCommand = await fs.promises.readFile(
    path.join(packageDirectory, 'install-user.cmd'), 'utf8');
  assert.match(installCommand, /windows-desktop-bootstrap-cli\.mjs" install/u);
  assert.doesNotMatch(installCommand, /runas|powershell.+verb\s+runas/iu);
  assert.equal(await fs.promises.stat(path.join(packageDirectory, 'release', 'desktop.json'))
    .then(stats => stats.isFile()), true);
});

test('bootstrap config is exact, contained and maps stable error classes', async () => {
  const bootstrap = await import(bootstrapUrl), releaseKeys = keyPair(), catalogKeys = keyPair();
  const config = { schemaVersion: 'windows-desktop-bootstrap-config-v1',
    productDirectoryName: 'Mooyu Programs', dataDirectoryName: 'Mooyu Data',
    bundledReleaseSource: 'release', shellConfigName: 'shell.json',
    startupValueName: 'MooyuCapabilityNode', catalogUrl: 'https://updates.mooyu.fun/catalog.json',
    allowInsecureLocalhost: false,
    trustedReleaseKeys: trusted(releaseKeys.publicKey, 'desktop-release-test'),
    trustedCatalogKeys: trusted(catalogKeys.publicKey, 'desktop-catalog-test') };
  assert.equal(bootstrap.normalizeWindowsDesktopBootstrapConfig(config).bundledReleaseSource,
    'release');
  assert.throws(() => bootstrap.normalizeWindowsDesktopBootstrapConfig({ ...config,
    bundledReleaseSource: '../release' }), error =>
    error.code === 'CAPABILITY_DESKTOP_BOOTSTRAP_CONFIG_INVALID');
  assert.equal(bootstrap.windowsDesktopBootstrapExitCode({
    code: 'CAPABILITY_DESKTOP_UPDATE_CATALOG_ROLLBACK' }), 30);
  assert.equal(bootstrap.windowsDesktopBootstrapExitCode({
    code: 'CAPABILITY_RUNTIME_DOWNLOAD_FAILED' }), 40);
  assert.equal(bootstrap.windowsDesktopBootstrapExitCode({
    code: 'CAPABILITY_DESKTOP_UPDATE_HEALTH_FAILED' }), 60);
});
