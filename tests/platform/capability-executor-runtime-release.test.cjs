const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-runtime-release-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const keyring = publicKeyPem => [{ keyId: 'mooyu-runtime-release-2026', status: 'active',
  publicKeyPem, notBefore: '2026-01-01T00:00:00.000Z', notAfter: null }];
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${digest(String(value)).slice(0, 12)}`;

async function signedRelease(api, root, version, bytes, privateKeyPem) {
  const source = path.join(root, `source-${version}`), helperDirectory = path.join(source, 'bin');
  await fs.promises.mkdir(helperDirectory, { recursive: true });
  const helperPath = path.join(helperDirectory, 'MooyuCapabilitySandboxHost.exe');
  await fs.promises.writeFile(helperPath, bytes);
  const manifest = api.signWindowsRuntimeManifest({ schemaVersion: 'windows-runtime-release-v1',
    runtimeId: 'mooyu.windows.capability-runtime', runtimeVersion: version,
    platform: 'win32-x64', minimumOsBuild: 19041, keyId: 'mooyu-runtime-release-2026',
    files: [{ path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: digest(bytes),
      sizeBytes: bytes.length, role: 'sandbox-host' }],
    helper: { path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: digest(bytes) }, signature: 'pending' },
  privateKeyPem);
  await fs.promises.writeFile(path.join(source, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { source, manifest };
}

test('Windows runtime release signatures bind platform, version and every helper byte', async () => {
  const api = await import(apiUrl);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const root = await tempRoot('contracts-');
  const release = await signedRelease(api, root, '1.2.0', Buffer.from('trusted-helper-v1'), privateKeyPem);
  const verified = api.verifyWindowsRuntimeManifest({ manifest: release.manifest,
    trustedKeys: keyring(publicKeyPem), platform: 'win32-x64', osBuild: 26100 });
  assert.equal(verified.runtimeVersion, '1.2.0');
  await assert.rejects(async () => api.verifyWindowsRuntimeManifest({
    manifest: { ...release.manifest, runtimeVersion: '1.2.1' },
    trustedKeys: keyring(publicKeyPem), platform: 'win32-x64', osBuild: 26100 }),
  error => error.code === 'CAPABILITY_RUNTIME_RELEASE_SIGNATURE_INVALID');
  await assert.rejects(async () => api.verifyWindowsRuntimeManifest({ manifest: release.manifest,
    trustedKeys: keyring(publicKeyPem), platform: 'win32-x64', osBuild: 17763 }),
  error => error.code === 'CAPABILITY_RUNTIME_RELEASE_OS_UNSUPPORTED');
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('runtime store installs atomically, reclaims an abandoned lock and rolls back', async () => {
  const api = await import(apiUrl), root = await tempRoot('store-');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const release1 = await signedRelease(api, root, '1.2.0', Buffer.from('trusted-helper-v1'), privateKeyPem);
  const release2 = await signedRelease(api, root, '1.2.1', Buffer.from('trusted-helper-v2'), privateKeyPem);
  const storeRoot = path.join(root, 'installed');
  const store = api.createWindowsRuntimeReleaseStore({ rootDirectory: storeRoot,
    trustedKeys: keyring(publicKeyPem), osBuild: 26100, lockStaleAfterMs: 60_000 });
  const first = await store.install({ sourceDirectory: release1.source });
  assert.equal(first.runtimeVersion, '1.2.0');
  const stateDirectory = path.join(storeRoot, 'runtime-state', safeSegment(first.runtimeId));
  await fs.promises.mkdir(stateDirectory, { recursive: true });
  const abandoned = path.join(stateDirectory, 'install.lock');
  await fs.promises.writeFile(abandoned, JSON.stringify({ pid: 2147483647 }));
  const old = new Date(Date.now() - 120_000); await fs.promises.utimes(abandoned, old, old);
  const second = await store.install({ sourceDirectory: release2.source });
  assert.equal(second.runtimeVersion, '1.2.1');
  assert.equal((await store.active(first.runtimeId)).runtimeVersion, '1.2.1');
  assert.equal((await store.rollback(first.runtimeId)).runtimeVersion, '1.2.0');
  assert.equal((await store.active(first.runtimeId)).runtimeVersion, '1.2.0');
  const installedHelper = path.join(first.absoluteDirectory, 'bin', 'MooyuCapabilitySandboxHost.exe');
  await fs.promises.appendFile(installedHelper, 'tampered');
  await assert.rejects(store.active(first.runtimeId),
    error => error.code === 'CAPABILITY_RUNTIME_RELEASE_FILE_HASH_MISMATCH');
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('release builder emits a signed helper-only production directory', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async () => {
  const api = await import(apiUrl), root = await tempRoot('builder-');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyFile = path.join(root, 'private.pem');
  await fs.promises.writeFile(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const output = path.join(root, 'release');
  const build = spawnSync(process.execPath, ['scripts/build-windows-runtime-release.mjs',
    '--output', output, '--private-key', privateKeyFile, '--key-id', 'mooyu-runtime-release-2026',
    '--version', '1.2.0'], { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.deepEqual((await fs.promises.readdir(output)).sort(), ['bin', 'runtime.json']);
  assert.deepEqual(await fs.promises.readdir(path.join(output, 'bin')),
    ['MooyuCapabilitySandboxHost.exe']);
  const manifest = JSON.parse(await fs.promises.readFile(path.join(output, 'runtime.json'), 'utf8'));
  api.verifyWindowsRuntimeManifest({ manifest, trustedKeys: keyring(publicKeyPem),
    platform: 'win32-x64', osBuild: 26100 });
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('bootstrap assembles the real installed helper and completes a sandboxed runner call', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SANDBOX_ACCEPTANCE !== '1',
  timeout: 40_000,
}, async () => {
  const api = await import(apiUrl), root = await tempRoot('bootstrap-');
  const nativeBuild = path.join(root, 'native-build');
  const compile = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'scripts/build-capability-sandbox-host-windows.ps1', '-OutputDirectory', nativeBuild],
  { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const helperBytes = await fs.promises.readFile(path.join(nativeBuild, 'MooyuCapabilitySandboxHost.exe'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const release = await signedRelease(api, root, '1.2.0', helperBytes, privateKeyPem);
  const store = api.createWindowsRuntimeReleaseStore({ rootDirectory: path.join(root, 'runtime'),
    trustedKeys: keyring(publicKeyPem), osBuild: 26100 });
  await store.install({ sourceDirectory: release.source });
  const bootstrap = api.createWindowsExecutorBootstrap({ runtimeStore: store,
    runtimeId: 'mooyu.windows.capability-runtime', dataRoot: path.join(root, 'data'),
    apiClient: { async claim() { return { status: 'idle' }; }, async complete() {} },
    packageStore: { async install() {} },
    credentialVault: { async store() {}, async load() { return null; }, async remove() {} },
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32' });
  const assembled = await bootstrap.assemble();
  assert.equal(assembled.release.runtimeVersion, '1.2.0');
  const installationRoot = path.join(root, 'fixture-install');
  await fs.promises.mkdir(path.join(installationRoot, 'bin'), { recursive: true });
  const fixture = path.join(installationRoot, 'bin', 'fixture.exe');
  await fs.promises.copyFile(path.join(nativeBuild, 'SandboxFixtureCapability.exe'), fixture);
  const fixtureBytes = await fs.promises.readFile(fixture);
  const result = await assembled.runner.run({ installation: { absoluteDirectory: installationRoot,
    packageManifest: { entrypoint: { kind: 'native-executable', path: 'bin/fixture.exe', arguments: [] },
      files: [{ path: 'bin/fixture.exe', sha256: digest(fixtureBytes), sizeBytes: fixtureBytes.length,
        executable: true }] } }, input: { bootstrap: true }, prerequisites: [],
    contract: { key: 'research.bootstrap', version: 1 },
    lease: { id: '11111111-1111-4111-8111-111111111111' },
    executionPolicy: { permissions: { files: 'none', networkDomains: [], devices: [] },
      resources: { cpuCores: 1, memoryMiB: 256, diskMiB: 64, gpuMemoryMiB: 0 },
      dataPolicy: { localOnly: true, upload: 'never' } } });
  const stored = await assembled.artifactStore.resolve(result.sha256);
  const evidence = JSON.parse(await fs.promises.readFile(stored.artifactFile, 'utf8'));
  assert.deepEqual([evidence.appContainer, evidence.integrityRid, evidence.networkConnected],
    [true, 4096, false]);
  await fs.promises.rm(root, { recursive: true, force: true });
});
