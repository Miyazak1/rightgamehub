const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-desktop-shell-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};

function fakeStartup() {
  const values = new Map(), calls = [];
  return { calls,
    async query(valueName) { return values.has(valueName)
      ? { enabled: true, commandLine: values.get(valueName).join(' ') }
      : { enabled: false, commandLine: null }; },
    async enable({ valueName, command }) { calls.push(['enable', valueName]); values.set(valueName, command);
      return { enabled: true, commandLine: command.join(' ') }; },
    async disable(valueName) { calls.push(['disable', valueName]); values.delete(valueName);
      return { enabled: false, commandLine: null }; },
  };
}

test('installation ledger and tray projection preserve one product lifecycle', async t => {
  const api = await import(apiUrl), root = await tempRoot('ledger-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const vault = api.createMemoryCredentialVault(), startup = fakeStartup();
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  const manager = api.createDesktopShellManager({ rootDirectory: root, startupRegistry: startup,
    stateStore, credentialVault: vault });
  const installed = await manager.install({ installVersion: '0.1.0',
    launchCommand: ['C:\\Program Files\\Mooyu\\node.exe', '--serve'],
    startupValueName: 'MooyuCapabilityNode' });
  assert.equal(installed.state, 'installed');
  assert.equal(installed.startup.enabled, true);
  assert.equal((await manager.snapshot()).view.state, 'stopped');
  await stateStore.writeStatus({ state: 'ready', generation: 1, pid: process.pid, paused: false });
  const snapshot = await manager.snapshot();
  assert.equal(snapshot.view.schemaVersion, 'capability-desktop-shell-view-v2');
  assert.equal(snapshot.view.state, 'ready');
  assert.equal(snapshot.view.fileConsent.notificationCount, 0);
  assert.equal(snapshot.view.actions.pause, true);
  assert.equal(snapshot.startup.enabled, true);
  const repaired = await manager.repair();
  assert.equal(repaired.installationId, installed.installationId);
  assert.equal(startup.calls.filter(([kind]) => kind === 'enable').length, 2);
  const upgraded = await manager.install({ installVersion: '0.2.0',
    launchCommand: ['C:\\Program Files\\Mooyu\\node.exe', '--serve'],
    startupValueName: 'MooyuCapabilityNode' });
  assert.equal(upgraded.installVersion, '0.2.0');
  assert.equal(upgraded.installationId, installed.installationId);
  await assert.rejects(manager.install({ installVersion: '0.1.0',
    launchCommand: ['C:\\Program Files\\Mooyu\\node.exe', '--serve'],
    startupValueName: 'MooyuCapabilityNode' }), error =>
    error.code === 'CAPABILITY_DESKTOP_SHELL_INSTALL_DOWNGRADE_BLOCKED');
});

test('failed startup registration leaves a recoverable ledger instead of claiming success', async t => {
  const api = await import(apiUrl), root = await tempRoot('repair-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  let failOnce = true;
  const startup = fakeStartup(), original = startup.enable;
  startup.enable = async input => {
    if (failOnce) { failOnce = false; throw Object.assign(new Error('failure'), {
      code: 'CAPABILITY_DESKTOP_SHELL_STARTUP_ENABLE_FAILED' }); }
    return original(input);
  };
  const manager = api.createDesktopShellManager({ rootDirectory: root, startupRegistry: startup,
    stateStore: api.createDesktopNodeStateStore({ rootDirectory: root }),
    credentialVault: api.createMemoryCredentialVault() });
  await assert.rejects(manager.install({ installVersion: '0.1.0',
    launchCommand: ['C:\\Mooyu\\node.exe'], startupValueName: 'MooyuCapabilityNode' }));
  assert.equal((await manager.installationStore.read()).state, 'repair-required');
  assert.equal((await manager.recover()).state, 'installed');
});

test('uninstall drains the running node, removes authority and preserves user data', async t => {
  const api = await import(apiUrl), root = await tempRoot('uninstall-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const sentinel = path.join(root, 'user-data.txt');
  await fs.promises.writeFile(sentinel, 'keep me', 'utf8');
  const vault = api.createMemoryCredentialVault(), startup = fakeStartup();
  await vault.store('desktop-shell-control-hmac-v1', crypto.randomBytes(32).toString('base64url'));
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  await stateStore.writeStatus({ state: 'running', generation: 1, pid: process.pid, paused: false });
  let clock = Date.parse('2026-10-28T03:00:00.000Z'), sleeps = 0;
  const manager = api.createDesktopShellManager({ rootDirectory: root, startupRegistry: startup,
    stateStore, credentialVault: vault, now: () => new Date(clock), isProcessAlive: () => true,
    stopTimeoutMs: 1000, stopPollMs: 10, sleep: async milliseconds => {
      clock += milliseconds; sleeps += 1;
      await stateStore.writeStatus({ state: 'stopped', generation: 1, pid: process.pid, paused: false });
    } });
  await manager.install({ installVersion: '0.1.0', launchCommand: ['C:\\Mooyu\\node.exe'],
    startupValueName: 'MooyuCapabilityNode' });
  const result = await manager.uninstall();
  assert.equal(result.state, 'uninstalled');
  assert.equal(result.dataPreserved, true);
  assert.equal(sleeps, 1);
  assert.equal(await vault.load('desktop-shell-control-hmac-v1'), null);
  assert.equal(await fs.promises.readFile(sentinel, 'utf8'), 'keep me');
  assert.equal((await startup.query('MooyuCapabilityNode')).enabled, false);
  assert.equal((await stateStore.consumeControl()).command, 'stop');
});

test('authenticated named-pipe control exposes only bounded status, controls and diagnostics', async t => {
  const api = await import(apiUrl), root = await tempRoot('ipc-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  await stateStore.writeStatus({ state: 'ready', generation: 1, pid: process.pid, paused: false,
    accessToken: 'must-not-leak' });
  const vault = api.createMemoryCredentialVault();
  const pipeName = String.raw`\\.\pipe\mooyu-shell-test-${crypto.randomUUID()}`;
  const server = api.createDesktopShellControlServer({ rootDirectory: root,
    credentialVault: vault, stateStore, pipeName });
  await server.start();
  t.after(() => server.close());
  const duplicate = api.createDesktopShellControlServer({ rootDirectory: root,
    credentialVault: vault, stateStore, pipeName });
  await assert.rejects(duplicate.start(), error =>
    error.code === 'CAPABILITY_DESKTOP_SHELL_IPC_ALREADY_RUNNING');
  const client = api.createDesktopShellControlClient({ rootDirectory: root,
    credentialVault: vault, pipeName });
  const publicStatus = await client.request('status');
  assert.equal(publicStatus.state, 'ready');
  assert.doesNotMatch(JSON.stringify(publicStatus), /must-not-leak|accessToken/u);
  assert.equal((await client.request('pause')).command, 'pause');
  assert.equal((await stateStore.consumeControl()).command, 'pause');
  const diagnostics = await client.request('diagnostics');
  assert.equal(diagnostics.status.state, 'ready');
  assert.doesNotMatch(JSON.stringify(diagnostics), /must-not-leak|accessToken/u);
  const stranger = api.createMemoryCredentialVault();
  await stranger.store('desktop-shell-control-hmac-v1', crypto.randomBytes(32).toString('base64url'));
  const untrusted = api.createDesktopShellControlClient({ rootDirectory: root,
    credentialVault: stranger, pipeName });
  await assert.rejects(untrusted.request('stop'), error =>
    error.code === 'CAPABILITY_DESKTOP_SHELL_CONTROL_AUTH_FAILED');
});

test('a tray disconnect after challenge cannot surface an unhandled EPIPE or poison later clients', async t => {
  const api = await import(apiUrl), root = await tempRoot('ipc-disconnect-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  await stateStore.writeStatus({ state: 'ready', generation: 1, pid: process.pid, paused: false });
  const vault = api.createMemoryCredentialVault();
  const pipeName = String.raw`\\.\pipe\mooyu-shell-disconnect-test-${crypto.randomUUID()}`;
  const server = api.createDesktopShellControlServer({ rootDirectory: root,
    credentialVault: vault, stateStore, pipeName });
  await server.start();
  t.after(() => server.close());
  const abandoned = net.createConnection(pipeName);
  await new Promise((resolve, reject) => {
    abandoned.once('data', () => { abandoned.destroy(); resolve(); });
    abandoned.once('error', reject);
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  const client = api.createDesktopShellControlClient({ rootDirectory: root,
    credentialVault: vault, pipeName });
  assert.equal((await client.request('status')).state, 'ready');
});

test('desktop shell host keeps the authenticated control plane beside one supervisor', async t => {
  const api = await import(apiUrl), root = await tempRoot('host-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  await stateStore.writeStatus({ state: 'ready', generation: 1, pid: process.pid, paused: false });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const supervisor = { stateStore, async run() { await gate; return { status: 'stopped' }; } };
  const vault = api.createMemoryCredentialVault();
  const pipeName = String.raw`\\.\pipe\mooyu-shell-host-test-${crypto.randomUUID()}`;
  const controlServer = api.createDesktopShellControlServer({ rootDirectory: root,
    credentialVault: vault, stateStore, pipeName });
  const host = api.createDesktopShellHost({ rootDirectory: root, supervisor,
    credentialVault: vault, controlServer });
  const active = host.run();
  await new Promise(resolve => setTimeout(resolve, 20));
  const client = api.createDesktopShellControlClient({ rootDirectory: root,
    credentialVault: vault, pipeName });
  assert.equal((await client.request('status')).state, 'ready');
  assert.equal((await client.request('stop')).command, 'stop');
  release();
  assert.deepEqual(await active, { status: 'stopped' });
});

test('authenticated shell consent commands bind system selection to one execution lease', async t => {
  const api = await import(apiUrl), root = await tempRoot('consent-ipc-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'private.txt');
  await fs.promises.writeFile(selected, 'private', 'utf8');
  const vault = api.createMemoryCredentialVault();
  const selections = [];
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: vault, requireTaskBinding: true, consentPollMs: 10,
    selectionAdapter: { async selectFiles(request) { selections.push(request); return [selected]; } } });
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  const pipeName = String.raw`\\.\pipe\mooyu-shell-consent-test-${crypto.randomUUID()}`;
  const server = api.createDesktopShellControlServer({ rootDirectory: root,
    credentialVault: vault, stateStore, fileGrantBroker: broker, pipeName });
  await server.start();
  t.after(() => server.close());
  const leaseId = crypto.randomUUID();
  const resolving = broker.resolve({ fileScope: 'user-selected', leaseId,
    contract: { key: 'documents.text.extract', version: 1 } });
  const client = api.createDesktopShellControlClient({ rootDirectory: root,
    credentialVault: vault, pipeName });
  let requests = [];
  for (let index = 0; index < 100 && requests.length === 0; index += 1) {
    requests = await client.request('file-consent-requests');
    if (requests.length === 0) await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].executionLeaseId, leaseId);
  const center = await client.request('file-consent-center');
  assert.equal(center.schemaVersion, 'capability-desktop-file-consent-center-v1');
  assert.equal(center.notificationCount, 1);
  assert.equal(center.items[0].actionable, true);
  assert.doesNotMatch(JSON.stringify(center), /private\.txt|private/u);
  await client.request('approve-file-consent', { requestId: requests[0].requestId,
    extensions: ['.txt'], maxFiles: 1, ownerWindowHandle: '424242' });
  assert.equal(selections[0].ownerWindowHandle, '424242');
  assert.equal((await resolving)[0].sourcePath, selected);
  assert.equal((await client.request('file-consent-requests'))[0].state, 'approved');
  assert.equal((await client.request('file-consent-center')).notificationCount, 0);
});

test('Windows command rendering preserves spaces, quotes and trailing slashes', async () => {
  const api = await import(apiUrl);
  assert.equal(api.renderWindowsCommandLine(['C:\\Program Files\\Mooyu\\node.exe',
    '--label', 'a "quoted" value', 'C:\\ending\\']),
  '"C:\\Program Files\\Mooyu\\node.exe" --label "a \\"quoted\\" value" C:\\ending\\');
});

test('shell CLI validates exact configuration and stable exit classes', async () => {
  const cli = await import(pathToFileURL(path.resolve('scripts/windows-desktop-shell-cli.mjs')).href);
  const value = cli.normalizeWindowsDesktopShellConfig({
    schemaVersion: 'capability-desktop-shell-config-v1', dataRoot: 'C:\\Mooyu\\Data',
    installVersion: '0.1.0', nodeConfigPath: 'C:\\Mooyu\\Data\\node.json',
    startupValueName: 'MooyuCapabilityNode',
  });
  assert.equal(value.installVersion, '0.1.0');
  assert.throws(() => cli.normalizeWindowsDesktopShellConfig({ ...value, extra: true }));
  assert.equal(cli.windowsDesktopShellExitCode({ code: 'CAPABILITY_DESKTOP_SHELL_IPC_TIMEOUT' }), 30);
  assert.equal(cli.windowsDesktopShellExitCode({ code: 'CAPABILITY_DESKTOP_SHELL_STARTUP_ENABLE_FAILED' }), 60);
});

test('real HKCU startup registry adapter is reversible', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SHELL_ACCEPTANCE !== '1',
}, async t => {
  const api = await import(apiUrl);
  const suffix = crypto.randomBytes(12).toString('hex');
  const registryKey = `HKCU\\Software\\Mooyu\\Acceptance\\${suffix}`;
  const valueName = `MooyuAcceptance${suffix}`;
  t.after(() => spawnSync('reg.exe', ['DELETE', registryKey, '/f'], {
    encoding: 'utf8', windowsHide: true }));
  const registry = api.createWindowsCurrentUserStartupRegistry({ registryKey });
  const command = [process.execPath, 'C:\\Program Files\\Mooyu\\shell cli.mjs', 'serve'];
  assert.equal((await registry.query(valueName)).enabled, false);
  const enabled = await registry.enable({ valueName, command });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.commandLine, api.renderWindowsCommandLine(command));
  assert.equal((await registry.disable(valueName)).enabled, false);
});
