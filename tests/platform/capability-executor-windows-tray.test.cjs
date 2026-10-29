const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const tray = path.resolve('.runtime/capability-tray/MooyuCapabilityTrayAcceptance.exe');
const enabled = process.platform === 'win32'
  && process.env.MOOYU_WINDOWS_TRAY_ACCEPTANCE === '1';
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-tray-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const run = (args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(tray, args, { windowsHide: true, ...options });
  const stdout = [], stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  child.once('error', reject);
  child.once('close', code => resolve({ code,
    stdout: Buffer.concat(stdout).toString('utf8').trim(),
    stderr: Buffer.concat(stderr).toString('utf8').trim() }));
});

test('native tray self-test freezes single-instance, notification, foreground and accessibility contracts', {
  skip: !enabled,
}, async t => {
  const root = await tempRoot('self-test-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const result = spawnSync(tray, ['--root', root, '--self-test'], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(value, {
    schemaVersion: 'capability-desktop-tray-self-test-v1',
    singleInstance: true,
    persistentNotificationDedupe: true,
    foregroundOwner: true,
    keyboardActions: ['enter-approve', 'delete-reject', 'escape-close'],
    accessibleWindowName: '小墨鱼本地文件授权中心',
    pipeIdentity: value.pipeIdentity,
  });
  assert.match(value.pipeIdentity, /^mooyu-capability-node-[a-f0-9]{32}$/u);
  assert.doesNotMatch(result.stdout, /[A-Z]:\\|capability-tray-tests\\|\\Users\\/u);
});

test('native tray reads the redacted consent center through real CurrentUser DPAPI and authenticated pipe', {
  skip: !enabled, timeout: 30_000,
}, async t => {
  const api = await import(apiUrl), root = await tempRoot('live-ipc-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'private-material.txt');
  await fs.promises.writeFile(selected, 'must never reach native tray output', 'utf8');
  const vault = api.createWindowsDpapiCredentialVault({ directory: path.join(root, 'vault') });
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: vault, requireTaskBinding: true, consentPollMs: 10,
    selectionAdapter: { async selectFiles() { return [selected]; } } });
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  const server = api.createDesktopShellControlServer({ rootDirectory: root,
    credentialVault: vault, stateStore, fileGrantBroker: broker });
  await server.start();
  t.after(() => server.close());
  const leaseId = crypto.randomUUID();
  const pending = broker.resolve({ fileScope: 'user-selected', leaseId,
    contract: { key: 'documents.text.extract', version: 1 } });
  pending.catch(() => {});
  let center;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    center = await broker.getConsentCenter();
    if (center.notificationCount === 1) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  t.after(async () => {
    await broker.rejectConsentRequest(center.items[0].requestId).catch(() => {});
    await pending.catch(() => {});
  });
  const result = await run(['--root', root, '--headless-once']);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout);
  assert.equal(value.schemaVersion, 'capability-desktop-tray-headless-v1');
  assert.equal(value.notificationCount, 1);
  assert.equal(value.activeCount, 1);
  assert.deepEqual(value.requestIds, [center.items[0].requestId]);
  assert.doesNotMatch(result.stdout, /private-material|must never|documents\.text\.extract/u);
  const client = api.createDesktopShellControlClient({ rootDirectory: root,
    credentialVault: vault });
  await client.request('reject-file-consent', { requestId: center.items[0].requestId });
  await assert.rejects(pending, error => error.code === 'CAPABILITY_DESKTOP_FILE_CONSENT_REJECTED');
});

test('native tray persists bounded notification dedupe without capability or file details', {
  skip: !enabled,
}, async t => {
  const root = await tempRoot('notifications-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const requestId = crypto.randomUUID();
  const first = spawnSync(tray, ['--root', root, '--notification-probe',
    '--request-id', requestId], { encoding: 'utf8', windowsHide: true });
  const second = spawnSync(tray, ['--root', root, '--notification-probe',
    '--request-id', requestId], { encoding: 'utf8', windowsHide: true });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(first.stdout).unseenCount, 1);
  assert.equal(JSON.parse(second.stdout).unseenCount, 0);
  const ledger = await fs.promises.readFile(path.join(root, 'desktop-shell',
    'tray-notifications.json'), 'utf8');
  assert.match(ledger, new RegExp(requestId, 'u'));
  assert.doesNotMatch(ledger, /acceptance\.synthetic|sourcePath|taskBody|fileContent/u);
});

test('native tray enforces one process per user and data root', {
  skip: !enabled, timeout: 10_000,
}, async t => {
  const root = await tempRoot('single-instance-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const first = spawn(tray, ['--root', root, '--hold-instance-ms', '1500'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (!first.killed) first.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tray instance readiness timeout')), 3000);
    first.once('error', reject);
    first.stdout.once('data', () => { clearTimeout(timer); resolve(); });
  });
  const duplicate = spawnSync(tray, ['--root', root, '--hold-instance-ms', '200'], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(duplicate.status, 20);
  assert.equal(duplicate.stdout, '');
  assert.equal(await new Promise((resolve, reject) => {
    first.once('error', reject); first.once('close', resolve);
  }), 0);
});

test('native tray survives an offline start and recovers when the authenticated control plane appears', {
  skip: !enabled, timeout: 30_000,
}, async t => {
  const api = await import(apiUrl), root = await tempRoot('reconnect-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const vault = api.createWindowsDpapiCredentialVault({ directory: path.join(root, 'vault') });
  await vault.store('desktop-shell-control-hmac-v1', crypto.randomBytes(32).toString('base64url'));
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: vault, requireTaskBinding: true, consentPollMs: 10,
    selectionAdapter: { async selectFiles() { return []; } } });
  const leaseId = crypto.randomUUID();
  const pending = broker.resolve({ fileScope: 'user-selected', leaseId,
    contract: { key: 'research.paper.layout', version: 1 } });
  pending.catch(() => {});
  let center;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    center = await broker.getConsentCenter();
    if (center.notificationCount === 1) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  t.after(async () => {
    await broker.rejectConsentRequest(center.items[0].requestId).catch(() => {});
    await pending.catch(() => {});
  });
  const process = spawn(tray, ['--root', root, '--poll-ms', '500'], {
    windowsHide: true, stdio: 'ignore',
  });
  t.after(() => { if (!process.killed) process.kill(); });
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(process.exitCode, null);
  const server = api.createDesktopShellControlServer({ rootDirectory: root,
    credentialVault: vault, stateStore: api.createDesktopNodeStateStore({ rootDirectory: root }),
    fileGrantBroker: broker });
  await server.start();
  t.after(() => server.close());
  const ledgerFile = path.join(root, 'desktop-shell', 'tray-notifications.json');
  let ledger = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ledger = await fs.promises.readFile(ledgerFile, 'utf8').catch(() => '');
    if (ledger.includes(center.items[0].requestId)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(ledger, new RegExp(center.items[0].requestId, 'u'));
  assert.equal(process.exitCode, null);
  await api.createDesktopShellControlClient({ rootDirectory: root,
    credentialVault: vault }).request('reject-file-consent', {
    requestId: center.items[0].requestId,
  });
  await assert.rejects(pending, error => error.code === 'CAPABILITY_DESKTOP_FILE_CONSENT_REJECTED');
  process.kill();
});
