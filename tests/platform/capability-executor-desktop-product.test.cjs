const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const productCliUrl = pathToFileURL(path.resolve(__dirname,
  '../../scripts/windows-desktop-product-cli.mjs')).href;
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-desktop-product-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const keyPair = () => crypto.generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const trusted = (publicKeyPem, keyId = 'desktop-release-test') => [{ keyId, status: 'active',
  publicKeyPem, notBefore: '2026-01-01T00:00:00.000Z', notAfter: null }];

async function releaseFixture(api, root, version, keys, productId = api.WINDOWS_DESKTOP_PRODUCT_ID) {
  const directory = path.join(root, `source release ${version}`);
  const content = {
    'bin/node.exe': `node-${version}`,
    'app/scripts/windows-desktop-product-host.mjs': `host-${version}`,
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
    const file = path.join(directory, ...relative.split('/'));
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, value, 'utf8');
    const bytes = Buffer.from(value);
    files.push({ path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length, role: roles[relative] ?? 'runtime-support' });
  }
  const byPath = value => files.find(file => file.path === value);
  const entrypoints = {
    nodeRuntime: { path: 'bin/node.exe', sha256: byPath('bin/node.exe').sha256 },
    shell: { path: 'app/scripts/windows-desktop-product-host.mjs',
      sha256: byPath('app/scripts/windows-desktop-product-host.mjs').sha256 },
    tray: { path: 'bin/MooyuCapabilityTray.exe',
      sha256: byPath('bin/MooyuCapabilityTray.exe').sha256 },
    sandboxHost: { path: 'bin/MooyuCapabilitySandboxHost.exe',
      sha256: byPath('bin/MooyuCapabilitySandboxHost.exe').sha256 },
  };
  const manifest = api.signWindowsDesktopReleaseManifest({
    schemaVersion: 'windows-desktop-release-v1', productId, productVersion: version,
    platform: 'win32-x64', minimumOsBuild: 19041, keyId: 'desktop-release-test', files,
    entrypoints, signature: 'pending' }, keys.privateKey);
  await fs.promises.writeFile(path.join(directory, 'desktop.json'),
    `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { directory, manifest };
}

function fakeStartup() {
  const values = new Map(), calls = [];
  return { values, calls, failNext: false,
    async query(valueName) { return values.has(valueName)
      ? { enabled: true, commandLine: values.get(valueName).join(' ') }
      : { enabled: false, commandLine: null }; },
    async enable({ valueName, command }) {
      calls.push(['enable', valueName, ...command]);
      if (this.failNext) { this.failNext = false;
        throw Object.assign(new Error('startup failure'),
          { code: 'CAPABILITY_DESKTOP_SHELL_STARTUP_ENABLE_FAILED' }); }
      values.set(valueName, [...command]); return { enabled: true, commandLine: command.join(' ') };
    },
    async disable(valueName) { calls.push(['disable', valueName]); values.delete(valueName);
      return { enabled: false, commandLine: null }; },
  };
}

test('desktop release signature binds every role, entrypoint and byte', async t => {
  const api = await import(apiUrl), root = await tempRoot('contract-'), keys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const fixture = await releaseFixture(api, root, '1.0.0', keys);
  const verified = api.verifyWindowsDesktopReleaseManifest({ manifest: fixture.manifest,
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 });
  assert.equal(verified.entrypoints.tray.path, 'bin/MooyuCapabilityTray.exe');
  assert.throws(() => api.verifyWindowsDesktopReleaseManifest({
    manifest: { ...fixture.manifest, productVersion: '1.0.1' },
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 }), error =>
    error.code === 'CAPABILITY_DESKTOP_RELEASE_SIGNATURE_INVALID');
  assert.throws(() => api.normalizeWindowsDesktopReleaseManifest({ ...fixture.manifest,
    entrypoints: { ...fixture.manifest.entrypoints,
      tray: { ...fixture.manifest.entrypoints.tray, path: '../tray.exe' } } }), error =>
    error.code === 'CAPABILITY_DESKTOP_RELEASE_ENTRYPOINT_INVALID');
});

test('desktop release store activates, rolls back and handles paths with spaces', async t => {
  const api = await import(apiUrl), root = await tempRoot('store space '), keys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'installed programs with spaces');
  const store = api.createWindowsDesktopReleaseStore({ installRoot,
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 });
  const one = await releaseFixture(api, root, '1.0.0', keys);
  const two = await releaseFixture(api, root, '1.1.0', keys);
  const first = await store.install({ sourceDirectory: one.directory });
  assert.equal(first.existing, false);
  assert.equal((await store.install({ sourceDirectory: one.directory })).existing, true);
  const second = await store.install({ sourceDirectory: two.directory });
  assert.equal((await store.active(api.WINDOWS_DESKTOP_PRODUCT_ID)).manifest.productVersion, '1.1.0');
  const rolled = await store.rollback(api.WINDOWS_DESKTOP_PRODUCT_ID,
    { expectedActiveManifestSha256: second.active.manifestSha256 });
  assert.equal(rolled.manifest.productVersion, '1.0.0');
  assert.match(first.active.absoluteDirectory, /installed programs with spaces/u);
});

test('desktop repair restores a tampered active release from the exact signed source', async t => {
  const api = await import(apiUrl), root = await tempRoot('repair-'), keys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = api.createWindowsDesktopReleaseStore({ installRoot: path.join(root, 'programs'),
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 });
  const source = await releaseFixture(api, root, '1.0.0', keys);
  const installed = await store.install({ sourceDirectory: source.directory });
  const tray = path.join(installed.active.absoluteDirectory, 'bin', 'MooyuCapabilityTray.exe');
  await fs.promises.writeFile(tray, 'tampered', 'utf8');
  await assert.rejects(store.active(api.WINDOWS_DESKTOP_PRODUCT_ID), error =>
    error.code === 'CAPABILITY_DESKTOP_RELEASE_FILE_HASH_MISMATCH');
  const repaired = await store.repair(api.WINDOWS_DESKTOP_PRODUCT_ID,
    { sourceDirectory: source.directory });
  assert.equal(repaired.manifest.productVersion, '1.0.0');
  assert.equal(await fs.promises.readFile(tray, 'utf8'), 'tray-1.0.0');
});

test('desktop store rejects a live concurrent installer lock', async t => {
  const api = await import(apiUrl), root = await tempRoot('lock-'), keys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'programs');
  const store = api.createWindowsDesktopReleaseStore({ installRoot,
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 });
  const source = await releaseFixture(api, root, '1.0.0', keys);
  const productId = api.WINDOWS_DESKTOP_PRODUCT_ID;
  const segment = `${productId}-${crypto.createHash('sha256').update(productId).digest('hex').slice(0, 12)}`;
  const lock = path.join(installRoot, 'product-state', segment, 'install.lock');
  await fs.promises.mkdir(path.dirname(lock), { recursive: true });
  await fs.promises.writeFile(lock, JSON.stringify({ pid: process.pid }), 'utf8');
  await assert.rejects(store.install({ sourceDirectory: source.directory }), error =>
    error.code === 'CAPABILITY_DESKTOP_RELEASE_INSTALL_BUSY');
});

test('product manager rolls back a failed upgrade and uninstall preserves user data', async t => {
  const api = await import(apiUrl), root = await tempRoot('manager-'), keys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'program files'), dataRoot = path.join(root, 'user data');
  await fs.promises.mkdir(dataRoot, { recursive: true });
  const sentinel = path.join(dataRoot, 'private-user-state.txt');
  await fs.promises.writeFile(sentinel, 'preserve', 'utf8');
  const productStore = api.createWindowsDesktopReleaseStore({ installRoot,
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 });
  const startup = fakeStartup(), vault = api.createMemoryCredentialVault();
  const shellManager = api.createDesktopShellManager({ rootDirectory: dataRoot,
    startupRegistry: startup, stateStore: api.createDesktopNodeStateStore({ rootDirectory: dataRoot }),
    credentialVault: vault });
  const manager = api.createWindowsDesktopProductManager({ productStore, shellManager, dataRoot,
    configurationPath: path.join(dataRoot, 'shell config.json') });
  const one = await releaseFixture(api, root, '1.0.0', keys);
  const two = await releaseFixture(api, root, '1.1.0', keys);
  const foreign = await releaseFixture(api, root, '9.0.0', keys, 'foreign.windows.desktop');
  await assert.rejects(manager.install({ sourceDirectory: foreign.directory }), error =>
    error.code === 'CAPABILITY_DESKTOP_PRODUCT_ID_MISMATCH');
  assert.equal(await productStore.active(api.WINDOWS_DESKTOP_PRODUCT_ID), null);
  await manager.install({ sourceDirectory: one.directory });
  startup.failNext = true;
  await assert.rejects(manager.install({ sourceDirectory: two.directory }), error =>
    error.code === 'CAPABILITY_DESKTOP_SHELL_STARTUP_ENABLE_FAILED');
  assert.equal((await manager.status()).release.productVersion, '1.0.0');
  assert.equal((await manager.status()).ready, true);
  const removed = await manager.uninstall();
  assert.equal(removed.programsRemoved, true);
  assert.equal(removed.dataPreserved, true);
  assert.equal(await fs.promises.readFile(sentinel, 'utf8'), 'preserve');
  assert.equal(await fs.promises.stat(path.join(installRoot, 'product-versions'))
    .then(() => true).catch(() => false), true);
  assert.equal((await manager.status()).ready, false);
});

test('product recovery reconciles an interrupted shell ledger with the active release', async t => {
  const api = await import(apiUrl), root = await tempRoot('recover-'), keys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'programs'), dataRoot = path.join(root, 'data');
  const productStore = api.createWindowsDesktopReleaseStore({ installRoot,
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 });
  const release = await releaseFixture(api, root, '1.0.0', keys);
  await productStore.install({ sourceDirectory: release.directory });
  const startup = fakeStartup(), shellManager = api.createDesktopShellManager({
    rootDirectory: dataRoot, startupRegistry: startup,
    stateStore: api.createDesktopNodeStateStore({ rootDirectory: dataRoot }),
    credentialVault: api.createMemoryCredentialVault() });
  await shellManager.installationStore.write({ schemaVersion: 'capability-desktop-shell-installation-v1',
    installationId: crypto.randomUUID(), productId: 'mooyu-capability-node', installVersion: '0.0.1',
    state: 'installing', dataRoot, launchCommand: ['C:\\broken.exe'],
    startup: { enabled: true, provider: 'hkcu-run', valueName: 'MooyuCapabilityNode' },
    installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const manager = api.createWindowsDesktopProductManager({ productStore, shellManager, dataRoot,
    configurationPath: path.join(dataRoot, 'shell.json') });
  assert.equal((await manager.recover()).state, 'installed');
  assert.equal((await manager.status()).ready, true);
  assert.match(startup.values.get('MooyuCapabilityNode')[0], /node\.exe$/u);
});

test('product CLI freezes exact config and stable exit classes', async () => {
  const cli = await import(productCliUrl);
  const config = { schemaVersion: 'windows-desktop-product-config-v1',
    installRoot: 'C:\\Users\\Example\\AppData\\Local\\Mooyu',
    dataRoot: 'C:\\Users\\Example\\AppData\\Local\\MooyuData',
    releaseSource: 'C:\\Downloads\\Mooyu Release',
    shellConfigPath: 'C:\\Users\\Example\\AppData\\Local\\MooyuData\\shell.json',
    startupValueName: 'MooyuCapabilityNode', trustedReleaseKeys: trusted('public-key') };
  assert.equal(cli.normalizeWindowsDesktopProductConfig(config).startupValueName,
    'MooyuCapabilityNode');
  assert.throws(() => cli.normalizeWindowsDesktopProductConfig({ ...config, extra: true }));
  assert.equal(cli.windowsDesktopProductExitCode({
    code: 'CAPABILITY_DESKTOP_RELEASE_SIGNATURE_INVALID' }), 40);
  assert.equal(cli.windowsDesktopProductExitCode({
    code: 'CAPABILITY_DESKTOP_RELEASE_INSTALL_BUSY' }), 20);
});

test('real desktop release builder produces a self-contained signed Windows artifact', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_DESKTOP_RELEASE_ACCEPTANCE !== '1',
  timeout: 120_000,
}, async t => {
  const api = await import(apiUrl), root = await tempRoot('real build space '), keys = keyPair();
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const privateKey = path.join(root, 'release-private.pem'), output = path.join(root, 'release output');
  await fs.promises.writeFile(privateKey, keys.privateKey, { encoding: 'utf8', mode: 0o600 });
  const build = spawnSync(process.execPath, [path.resolve('scripts/build-windows-desktop-release.mjs'),
    '--output', output, '--private-key', privateKey, '--key-id', 'desktop-release-test',
    '--version', '1.0.0'], { encoding: 'utf8', windowsHide: true, timeout: 110_000 });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const store = api.createWindowsDesktopReleaseStore({ installRoot: path.join(root, 'installed'),
    trustedKeys: trusted(keys.publicKey), osBuild: 19045 });
  const installed = await store.install({ sourceDirectory: output });
  assert.ok(installed.active.manifest.files.length > 20);
  const packagedNode = path.join(installed.active.absoluteDirectory, 'bin', 'node.exe');
  const shell = path.join(installed.active.absoluteDirectory, 'app', 'scripts',
    'windows-desktop-shell-cli.mjs');
  const desktopArtifactHost = path.join(installed.active.absoluteDirectory, 'app', 'apps',
    'capability-executor', 'src', 'desktop-capability-artifact-host.mjs');
  const sharedArtifactVerifier = path.join(installed.active.absoluteDirectory, 'app', 'packages',
    'host-contract', 'src', 'capability-artifact-open.mjs');
  const paperLayoutContract = path.join(installed.active.absoluteDirectory, 'app', 'packages',
    'agent-capabilities', 'src', 'paper-layout.mjs');
  assert.equal(await fs.promises.stat(desktopArtifactHost).then(item => item.isFile()), true);
  assert.equal(await fs.promises.stat(sharedArtifactVerifier).then(item => item.isFile()), true);
  assert.equal(await fs.promises.stat(paperLayoutContract).then(item => item.isFile()), true);
  const artifactImport = spawnSync(packagedNode, ['--input-type=module', '--eval',
    `await import(${JSON.stringify(pathToFileURL(desktopArtifactHost).href)})`], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(artifactImport.status, 0, artifactImport.stderr || artifactImport.stdout);
  const probe = spawnSync(packagedNode, [shell, 'invalid'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(probe.status, 10, probe.stderr || probe.stdout);
  assert.match(probe.stderr, /CAPABILITY_DESKTOP_SHELL_COMMAND_INVALID/u);

  // Release composition is safe to verify in every isolated build. The real HKCU lifecycle is a
  // separate, explicit machine-level acceptance because some CI/sandbox accounts cannot write it.
  if (process.env.MOOYU_WINDOWS_DESKTOP_REGISTRY_ACCEPTANCE !== '1') return;

  const dataRoot = path.join(root, 'real user data'), lifecycleRoot = path.join(root, 'real programs');
  const shellConfig = path.join(dataRoot, 'shell config.json');
  const productConfig = path.join(root, 'product config.json');
  const startupValueName = `MooyuDesktopAcceptance${crypto.randomBytes(8).toString('hex')}`;
  await fs.promises.mkdir(dataRoot, { recursive: true });
  await fs.promises.writeFile(path.join(dataRoot, 'sentinel.txt'), 'keep-user-data', 'utf8');
  await fs.promises.writeFile(productConfig, `${JSON.stringify({
    schemaVersion: 'windows-desktop-product-config-v1', installRoot: lifecycleRoot, dataRoot,
    releaseSource: output, shellConfigPath: shellConfig, startupValueName,
    trustedReleaseKeys: trusted(keys.publicKey),
  }, null, 2)}\n`, 'utf8');
  t.after(() => spawnSync('reg.exe', ['DELETE',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', startupValueName, '/f'],
  { encoding: 'utf8', windowsHide: true }));
  const productCli = path.resolve('scripts/windows-desktop-product-cli.mjs');
  for (const command of ['install', 'status', 'repair']) {
    const result = spawnSync(process.execPath, [productCli, command, '--config', productConfig],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const registered = spawnSync('reg.exe', ['QUERY',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', startupValueName],
  { encoding: 'utf8', windowsHide: true });
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  assert.match(registered.stdout, /windows-desktop-product-host\.mjs/u);
  const removed = spawnSync(process.execPath, [productCli, 'uninstall', '--config', productConfig],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.equal(JSON.parse(removed.stdout).dataPreserved, true);
  assert.equal(await fs.promises.readFile(path.join(dataRoot, 'sentinel.txt'), 'utf8'),
    'keep-user-data');
  const remainingVersions = await fs.promises.readdir(path.join(lifecycleRoot, 'product-versions'));
  assert.deepEqual(remainingVersions, []);
  assert.notEqual(spawnSync('reg.exe', ['QUERY',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', startupValueName],
  { encoding: 'utf8', windowsHide: true }).status, 0);
});
