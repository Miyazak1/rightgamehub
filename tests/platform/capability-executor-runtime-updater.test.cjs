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
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-runtime-updater-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const keyring = (keyId, publicKeyPem) => [{ keyId, status: 'active', publicKeyPem,
  notBefore: '2026-01-01T00:00:00.000Z', notAfter: null }];

async function buildRelease(api, root, version, sequence, helperBytes, privateKeyPem) {
  const source = path.join(root, `release-${version}`);
  await fs.promises.mkdir(path.join(source, 'bin'), { recursive: true });
  await fs.promises.mkdir(path.join(source, 'support'), { recursive: true });
  const helperPath = path.join(source, 'bin', 'MooyuCapabilitySandboxHost.exe');
  const markerPath = path.join(source, 'support', 'version.txt');
  const marker = Buffer.from(`${version}:${sequence}\n`);
  await fs.promises.writeFile(helperPath, helperBytes);
  await fs.promises.writeFile(markerPath, marker);
  const manifest = api.signWindowsRuntimeManifest({ schemaVersion: 'windows-runtime-release-v1',
    runtimeId: 'mooyu.windows.capability-runtime', runtimeVersion: version,
    platform: 'win32-x64', minimumOsBuild: 19041, keyId: 'runtime-release-key',
    files: [{ path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: digest(helperBytes),
      sizeBytes: helperBytes.length, role: 'sandbox-host' },
    { path: 'support/version.txt', sha256: digest(marker), sizeBytes: marker.length,
      role: 'runtime-support' }],
    helper: { path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: digest(helperBytes) },
    signature: 'pending' }, privateKeyPem);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await fs.promises.writeFile(path.join(source, 'runtime.json'), manifestBytes);
  const archive = path.join(root, `runtime-${version}.zip`);
  const packaged = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'scripts/package-windows-runtime-release.ps1', '-ReleaseDirectory', source,
    '-ArchivePath', archive], { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(packaged.status, 0, packaged.stderr || packaged.stdout);
  const archiveBytes = await fs.promises.readFile(archive);
  return { source, manifest, manifestSha256: digest(manifestBytes), archive, archiveBytes,
    archiveSha256: digest(archiveBytes) };
}

function signedCatalog(api, privateKeyPem, release, catalogSequence, releaseSequence, revoked = []) {
  return api.signWindowsRuntimeUpdateCatalog({ schemaVersion: 'windows-runtime-update-catalog-v1',
    catalogId: 'mooyu.windows.stable', sequence: catalogSequence,
    generatedAt: '2026-10-28T00:00:00.000Z', expiresAt: '2026-10-29T00:00:00.000Z',
    keyId: 'update-catalog-key', releases: [{ runtimeId: 'mooyu.windows.capability-runtime',
      runtimeVersion: release.manifest.runtimeVersion, releaseSequence, platform: 'win32-x64',
      minimumOsBuild: 19041, manifestSha256: release.manifestSha256,
      archive: { url: `https://updates.mooyu.invalid/${path.basename(release.archive)}`,
        sha256: release.archiveSha256, sizeBytes: release.archiveBytes.length } }],
    revokedManifestSha256s: revoked, signature: 'pending' }, privateKeyPem);
}

const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${digest(String(value)).slice(0, 12)}`;

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('signed update catalog binds releases, expiry and revocations', async () => {
  const api = await import(apiUrl);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const manifestHash = digest('manifest');
  const catalog = api.signWindowsRuntimeUpdateCatalog({ schemaVersion: 'windows-runtime-update-catalog-v1',
    catalogId: 'mooyu.windows.stable', sequence: 7, generatedAt: '2026-10-28T00:00:00.000Z',
    expiresAt: '2026-10-29T00:00:00.000Z', keyId: 'update-catalog-key',
    releases: [{ runtimeId: 'mooyu.windows.capability-runtime', runtimeVersion: '1.2.0',
      releaseSequence: 4, platform: 'win32-x64', minimumOsBuild: 19041,
      manifestSha256: manifestHash, archive: { url: 'https://updates.mooyu.fun/runtime.zip',
        sha256: digest('archive'), sizeBytes: 1024 } }],
    revokedManifestSha256s: [], signature: 'pending' }, privateKeyPem);
  assert.equal(api.verifyWindowsRuntimeUpdateCatalog({ catalog,
    trustedKeys: keyring('update-catalog-key', publicKeyPem),
    now: new Date('2026-10-28T10:00:00.000Z') }).sequence, 7);
  assert.throws(() => api.verifyWindowsRuntimeUpdateCatalog({
    catalog: { ...catalog, revokedManifestSha256s: [manifestHash] },
    trustedKeys: keyring('update-catalog-key', publicKeyPem),
    now: new Date('2026-10-28T10:00:00.000Z') }),
  error => error.code === 'CAPABILITY_RUNTIME_UPDATE_CATALOG_SIGNATURE_INVALID');
  assert.throws(() => api.verifyWindowsRuntimeUpdateCatalog({ catalog,
    trustedKeys: keyring('update-catalog-key', publicKeyPem),
    now: new Date('2026-10-30T00:00:00.000Z') }),
  error => error.code === 'CAPABILITY_RUNTIME_UPDATE_CATALOG_EXPIRED');
});

test('resumable downloader keeps a partial and continues with an exact Range request', async () => {
  const api = await import(apiUrl), root = await tempRoot('resume-');
  const payload = crypto.randomBytes(512 * 1024), expectedSha256 = digest(payload);
  const controller = new AbortController();
  let requests = 0, observedRange = null;
  const { server, origin } = await listen((request, response) => {
    requests += 1;
    observedRange = request.headers.range ?? observedRange;
    if (requests === 1) {
      response.writeHead(200, { 'content-length': payload.length, etag: '"release-1"' });
      response.flushHeaders();
      response.write(payload.subarray(0, 128 * 1024));
      setTimeout(() => controller.abort(), 50);
      return;
    }
    const offset = Number(String(request.headers.range).match(/^bytes=(\d+)-$/u)?.[1]);
    response.writeHead(206, { 'content-length': payload.length - offset,
      'content-range': `bytes ${offset}-${payload.length - 1}/${payload.length}`, etag: '"release-1"' });
    response.end(payload.subarray(offset));
  });
  try {
    await assert.rejects(api.downloadFileResumable({ url: `${origin}/runtime.zip`,
      destinationDirectory: root, expectedBytes: payload.length, expectedSha256,
      allowInsecureLocalhost: true, signal: controller.signal }));
    const completed = await api.downloadFileResumable({ url: `${origin}/runtime.zip`,
      destinationDirectory: root, expectedBytes: payload.length, expectedSha256,
      allowInsecureLocalhost: true });
    assert.match(observedRange, /^bytes=\d+-$/u);
    assert.deepEqual(await fs.promises.readFile(completed), payload);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('runtime updater applies a real helper, rejects rollback and restores prior version on failed health', {
  skip: process.platform !== 'win32', timeout: 60_000,
}, async () => {
  const api = await import(apiUrl), root = await tempRoot('apply-');
  const nativeBuild = path.join(root, 'native');
  const compile = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'scripts/build-capability-sandbox-host-windows.ps1', '-OutputDirectory', nativeBuild, '-SkipFixture'],
  { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const helperBytes = await fs.promises.readFile(path.join(nativeBuild, 'MooyuCapabilitySandboxHost.exe'));
  const runtimeKeys = crypto.generateKeyPairSync('ed25519');
  const catalogKeys = crypto.generateKeyPairSync('ed25519');
  const runtimePrivate = runtimeKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const catalogPrivate = catalogKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const release1 = await buildRelease(api, root, '1.2.0', 1, helperBytes, runtimePrivate);
  const release2 = await buildRelease(api, root, '1.2.1', 2, helperBytes, runtimePrivate);
  const release3 = await buildRelease(api, root, '1.2.2', 3, helperBytes, runtimePrivate);
  const catalogKeyFile = path.join(root, 'catalog-private.pem');
  const catalogSpecFile = path.join(root, 'catalog-build.json');
  const catalogOutputFile = path.join(root, 'catalog.json');
  await fs.promises.writeFile(catalogKeyFile, catalogPrivate, { mode: 0o600 });
  await fs.promises.writeFile(catalogSpecFile, JSON.stringify({
    schemaVersion: 'windows-runtime-update-catalog-build-v1', catalogId: 'mooyu.windows.stable',
    sequence: 2, generatedAt: '2026-10-28T00:00:00.000Z',
    expiresAt: '2026-10-29T00:00:00.000Z', keyId: 'update-catalog-key',
    releases: [{ releaseDirectory: release2.source, archivePath: release2.archive,
      archiveUrl: `https://updates.mooyu.invalid/${path.basename(release2.archive)}`,
      releaseSequence: 2 }], revokedManifestSha256s: [],
  }));
  const catalogBuild = spawnSync(process.execPath, ['scripts/build-windows-runtime-update-catalog.mjs',
    '--input', catalogSpecFile, '--output', catalogOutputFile, '--private-key', catalogKeyFile],
  { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(catalogBuild.status, 0, catalogBuild.stderr || catalogBuild.stdout);
  let catalog = JSON.parse(await fs.promises.readFile(catalogOutputFile, 'utf8'));
  assert.equal(catalog.releases[0].manifestSha256, release2.manifestSha256);
  const archives = new Map([[path.basename(release2.archive), release2.archiveBytes],
    [path.basename(release3.archive), release3.archiveBytes]]);
  const { server, origin } = await listen((request, response) => {
    if (request.url === '/catalog.json') {
      const body = Buffer.from(JSON.stringify(catalog));
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      response.end(body); return;
    }
    const body = archives.get(path.basename(request.url));
    if (!body) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    response.end(body);
  });
  try {
    const store = api.createWindowsRuntimeReleaseStore({ rootDirectory: path.join(root, 'store'),
      trustedKeys: keyring('runtime-release-key', runtimeKeys.publicKey.export({ type: 'spki', format: 'pem' })),
      osBuild: 26100 });
    await store.install({ sourceDirectory: release1.source });
    const options = { rootDirectory: path.join(root, 'updater'),
      runtimeId: 'mooyu.windows.capability-runtime', runtimeStore: store,
      trustedCatalogKeys: keyring('update-catalog-key', catalogKeys.publicKey.export({ type: 'spki', format: 'pem' })),
      catalogUrl: `${origin}/catalog.json`, osBuild: 26100, allowInsecureLocalhost: true,
      archiveUrlResolver: url => `${origin}/${path.basename(new URL(url).pathname)}`,
      now: () => new Date('2026-10-28T10:00:00.000Z') };
    const updater = api.createWindowsRuntimeUpdater(options);
    const applied = await updater.checkAndApply();
    assert.equal(applied.status, 'updated');
    assert.equal((await store.active('mooyu.windows.capability-runtime')).runtimeVersion, '1.2.1');
    assert.equal((await updater.checkAndApply()).status, 'current');

    catalog = signedCatalog(api, catalogPrivate, release3, 3, 3);
    const failing = api.createWindowsRuntimeUpdater({ ...options,
      healthProbe: async () => { throw Object.assign(new Error('probe failed'), { code: 'PROBE_FAILED' }); } });
    await assert.rejects(failing.checkAndApply(),
      error => error.code === 'CAPABILITY_RUNTIME_UPDATE_HEALTH_FAILED');
    assert.equal((await store.active('mooyu.windows.capability-runtime')).runtimeVersion, '1.2.1');

    catalog = signedCatalog(api, catalogPrivate, release1, 1, 1);
    await assert.rejects(updater.checkAndApply(),
      error => error.code === 'CAPABILITY_RUNTIME_UPDATE_CATALOG_ROLLBACK');

    catalog = signedCatalog(api, catalogPrivate, release3, 4, 3, [release3.manifestSha256]);
    await assert.rejects(updater.checkAndApply(),
      error => error.code === 'CAPABILITY_RUNTIME_UPDATE_RELEASE_UNAVAILABLE');

    await store.install({ sourceDirectory: release3.source });
    const transactionDirectory = path.join(root, 'updater', 'update-state',
      safeSegment('mooyu.windows.capability-runtime'));
    await fs.promises.mkdir(transactionDirectory, { recursive: true });
    await fs.promises.writeFile(path.join(transactionDirectory, 'transaction.json'), JSON.stringify({
      schemaVersion: 'windows-runtime-update-transaction-v1',
      runtimeId: 'mooyu.windows.capability-runtime', phase: 'health-check',
      priorManifestSha256: release2.manifestSha256,
      targetManifestSha256: release3.manifestSha256, releaseSequence: 3,
      createdAt: '2026-10-28T10:00:00.000Z',
    }));
    assert.equal((await updater.recover()).status, 'recovered');
    assert.equal((await store.active('mooyu.windows.capability-runtime')).runtimeVersion, '1.2.1');

    await store.install({ sourceDirectory: release3.source });
    const nextState = { schemaVersion: 'windows-runtime-updater-state-v1',
      runtimeId: 'mooyu.windows.capability-runtime', catalogId: 'mooyu.windows.stable',
      highestCatalogSequence: 3, catalogSha256: digest('catalog-three'), releaseSequence: 3,
      manifestSha256: release3.manifestSha256, updatedAt: '2026-10-28T10:00:00.000Z' };
    await fs.promises.writeFile(path.join(transactionDirectory, 'transaction.json'), JSON.stringify({
      schemaVersion: 'windows-runtime-update-transaction-v1',
      runtimeId: 'mooyu.windows.capability-runtime', phase: 'committing',
      priorManifestSha256: release2.manifestSha256,
      targetManifestSha256: release3.manifestSha256, releaseSequence: 3,
      createdAt: '2026-10-28T10:00:00.000Z', nextState,
    }));
    assert.equal((await updater.recover()).status, 'commit-recovered');
    assert.equal((await store.active('mooyu.windows.capability-runtime')).runtimeVersion, '1.2.2');
    assert.equal((await updater.status()).state.manifestSha256, release3.manifestSha256);
    await fs.promises.writeFile(path.join(transactionDirectory, 'state.json'), '{broken');
    await assert.rejects(updater.status(),
      error => error.code === 'CAPABILITY_RUNTIME_UPDATE_STATE_INVALID');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('updater CLI exposes stable process exit classes', async () => {
  const cli = await import(pathToFileURL(path.resolve('scripts/windows-runtime-update-cli.mjs')).href);
  assert.equal(cli.windowsRuntimeUpdaterExitCode({ code: 'CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID' }), 10);
  assert.equal(cli.windowsRuntimeUpdaterExitCode({ code: 'CAPABILITY_RUNTIME_UPDATE_CATALOG_ROLLBACK' }), 20);
  assert.equal(cli.windowsRuntimeUpdaterExitCode({ code: 'CAPABILITY_RUNTIME_DOWNLOAD_FAILED' }), 30);
  assert.equal(cli.windowsRuntimeUpdaterExitCode({ code: 'CAPABILITY_RUNTIME_INSTALL_MISMATCH' }), 40);
  assert.equal(cli.windowsRuntimeUpdaterExitCode({ code: 'CAPABILITY_RUNTIME_UPDATE_HEALTH_FAILED' }), 50);
  assert.equal(cli.windowsRuntimeUpdaterExitCode({ code: 'CAPABILITY_RUNTIME_UPDATE_BUSY' }), 60);
  assert.equal(cli.windowsRuntimeUpdaterExitCode({ code: 'UNKNOWN' }), 70);
});
