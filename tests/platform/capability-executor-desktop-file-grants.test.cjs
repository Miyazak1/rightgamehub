const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-desktop-file-grant-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const waitFor = async (read, predicate, attempts = 100) => {
  for (let index = 0; index < attempts; index += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('condition not reached');
};

test('user-selected authorization is capability-bound, path-redacted and single use', async t => {
  const api = await import(apiUrl), root = await tempRoot('single-use-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, '用户论文.pdf');
  await fs.promises.writeFile(selected, 'local paper bytes', 'utf8');
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createMemoryCredentialVault(),
    selectionAdapter: { async selectFiles() { return [selected]; } } });
  const authorization = await broker.authorize({ capabilityKey: 'research.paper.layout',
    extensions: ['.pdf'], maxFiles: 1 });
  assert.equal(authorization.status, 'authorized');
  assert.deepEqual(authorization.displayNames, ['用户论文.pdf']);
  const ledger = await fs.promises.readFile(broker.indexFile, 'utf8');
  assert.doesNotMatch(ledger, /capability-desktop-file-grant-tests|用户论文\.pdf.*[\\/]/u);
  assert.doesNotMatch(ledger, new RegExp(selected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  await assert.rejects(broker.resolve({ fileScope: 'user-selected',
    contract: { key: 'media.audio.transcribe' } }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_AUTHORIZATION_REQUIRED');
  const grants = await broker.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout' } });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].sourcePath, selected);
  assert.equal(grants[0].access, 'read');
  await assert.rejects(broker.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout' } }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_AUTHORIZATION_REQUIRED');
  assert.equal((await broker.list())[0].state, 'consumed');
});

test('file replacement after consent fails closed and consumes the authorization', async t => {
  const api = await import(apiUrl), root = await tempRoot('changed-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'scan.png');
  await fs.promises.writeFile(selected, 'original', 'utf8');
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createMemoryCredentialVault(),
    selectionAdapter: { async selectFiles() { return [selected]; } } });
  await broker.authorize({ capabilityKey: 'research.paper.layout', extensions: ['.png'] });
  await fs.promises.writeFile(selected, 'replacement bytes', 'utf8');
  await assert.rejects(broker.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout' } }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_GRANT_SOURCE_CHANGED');
  assert.equal((await broker.list())[0].state, 'consumed');
});

test('same-content path replacement is rejected by stable file identity', async t => {
  const api = await import(apiUrl), root = await tempRoot('identity-replacement-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'paper.pdf'), original = path.join(root, 'original.pdf');
  await fs.promises.writeFile(selected, 'identical bytes', 'utf8');
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createMemoryCredentialVault(),
    selectionAdapter: { async selectFiles() { return [selected]; } } });
  const authorization = await broker.authorize({ capabilityKey: 'research.paper.layout',
    extensions: ['.pdf'] });
  await fs.promises.rename(selected, original);
  await fs.promises.writeFile(selected, 'identical bytes', 'utf8');
  await assert.rejects(broker.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout' } }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_GRANT_SOURCE_CHANGED' && error.safeFailure === true);
  assert.equal((await broker.list()).find(item =>
    item.authorizationId === authorization.authorizationId).state, 'consumed');
});

test('expired and revoked authorizations never become native file grants', async t => {
  const api = await import(apiUrl), root = await tempRoot('expiry-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'notes.txt');
  await fs.promises.writeFile(selected, 'notes', 'utf8');
  let clock = Date.parse('2026-10-28T06:00:00.000Z');
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root, now: () => new Date(clock),
    credentialVault: api.createMemoryCredentialVault(),
    selectionAdapter: { async selectFiles() { return [selected]; } } });
  const first = await broker.authorize({ capabilityKey: 'documents.text.extract', ttlMs: 30_000 });
  clock += 30_001;
  assert.equal((await broker.list())[0].state, 'expired');
  const second = await broker.authorize({ capabilityKey: 'documents.text.extract', ttlMs: 30_000 });
  assert.equal((await broker.revoke(second.authorizationId)).state, 'revoked');
  await assert.rejects(broker.resolve({ fileScope: 'user-selected',
    contract: { key: 'documents.text.extract' } }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_AUTHORIZATION_REQUIRED');
  assert.equal(first.authorizationId === second.authorizationId, false);
});

test('selection cancellation and extension mismatch never create an authorization', async t => {
  const api = await import(apiUrl), root = await tempRoot('selection-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const cancelled = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createMemoryCredentialVault(),
    selectionAdapter: { async selectFiles() { return []; } } });
  assert.deepEqual(await cancelled.authorize({ capabilityKey: 'research.paper.layout' }),
    { status: 'cancelled' });
  assert.deepEqual(await cancelled.list(), []);
  const text = path.join(root, 'wrong.txt'); await fs.promises.writeFile(text, 'wrong', 'utf8');
  const mismatch = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createMemoryCredentialVault(),
    selectionAdapter: { async selectFiles() { return [text]; } } });
  await assert.rejects(mismatch.authorize({ capabilityKey: 'research.paper.layout',
    extensions: ['.pdf'] }), error => error.code === 'CAPABILITY_DESKTOP_FILE_SELECTION_TYPE_INVALID');
});

test('tampered authorization indexes with undeclared fields fail closed', async t => {
  const api = await import(apiUrl), root = await tempRoot('tampered-index-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'paper.pdf'); await fs.promises.writeFile(selected, 'paper', 'utf8');
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createMemoryCredentialVault(),
    selectionAdapter: { async selectFiles() { return [selected]; } } });
  await broker.authorize({ capabilityKey: 'research.paper.layout', extensions: ['.pdf'] });
  const index = JSON.parse(await fs.promises.readFile(broker.indexFile, 'utf8'));
  index.entries[0].sourcePath = selected;
  await fs.promises.writeFile(broker.indexFile, JSON.stringify(index), 'utf8');
  await assert.rejects(broker.list(), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_GRANT_LEDGER_INVALID');
});

test('task-bound consent exposes no task body and approves only the exact lease', async t => {
  const api = await import(apiUrl), root = await tempRoot('task-bound-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'local-notes.txt');
  await fs.promises.writeFile(selected, 'private notes', 'utf8');
  const leaseA = crypto.randomUUID(), leaseB = crypto.randomUUID();
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createMemoryCredentialVault(), requireTaskBinding: true,
    consentPollMs: 10, selectionAdapter: { async selectFiles() { return [selected]; } } });
  const first = broker.resolve({ fileScope: 'user-selected', leaseId: leaseA,
    contract: { key: 'documents.text.extract', version: 1 },
    input: { secretPrompt: 'must not persist' } });
  const second = broker.resolve({ fileScope: 'user-selected', leaseId: leaseB,
    contract: { key: 'documents.text.extract', version: 1 },
    input: { secretPrompt: 'also private' } });
  const requests = await waitFor(() => broker.listConsentRequests(), value => value.length === 2);
  assert.equal(new Set(requests.map(item => item.executionLeaseId)).size, 2);
  assert.deepEqual(requests.map(item => item.capabilityVersion), [1, 1]);
  const plaintext = await fs.promises.readFile(broker.requestFile, 'utf8');
  assert.doesNotMatch(plaintext, /must not persist|also private|local-notes|private notes/u);
  const requestA = requests.find(item => item.executionLeaseId === leaseA);
  const requestB = requests.find(item => item.executionLeaseId === leaseB);
  await broker.approveConsentRequest({ requestId: requestA.requestId,
    extensions: ['.txt'], maxFiles: 1 });
  const grants = await first;
  assert.equal(grants[0].sourcePath, selected);
  assert.equal((await broker.list()).find(item => item.requestId === requestA.requestId).state,
    'consumed');
  await assert.rejects(broker.resolve({ fileScope: 'user-selected', leaseId: leaseA,
    contract: { key: 'documents.text.extract', version: 1 } }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_CONSENT_REPLAYED');
  await assert.rejects(broker.resolve({ fileScope: 'user-selected', leaseId: leaseA,
    contract: { key: 'documents.text.extract', version: 2 } }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_CONSENT_CONTRACT_MISMATCH');
  await broker.rejectConsentRequest(requestB.requestId);
  await assert.rejects(second, error => error.code === 'CAPABILITY_DESKTOP_FILE_CONSENT_REJECTED'
    && error.safeFailure === true);
});

test('task consent cancellation, timeout and stale restart records fail closed', async t => {
  const api = await import(apiUrl), root = await tempRoot('task-failures-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, 'paper.pdf');
  await fs.promises.writeFile(selected, 'paper', 'utf8');
  let clock = Date.parse('2026-10-28T08:00:00.000Z');
  const common = { rootDirectory: root, credentialVault: api.createMemoryCredentialVault(),
    requireTaskBinding: true, consentTimeoutMs: 30_000, consentPollMs: 10,
    now: () => new Date(clock), selectionAdapter: { async selectFiles() { return [selected]; } } };
  const cancelling = api.createDesktopFileGrantBroker(common);
  const controller = new AbortController();
  const cancelled = cancelling.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout', version: 1 }, leaseId: crypto.randomUUID(),
    signal: controller.signal });
  await waitFor(() => cancelling.listConsentRequests(), value => value.length === 1);
  controller.abort();
  await assert.rejects(cancelled, error => error.code === 'CAPABILITY_DESKTOP_FILE_CONSENT_CANCELLED');
  assert.equal((await cancelling.listConsentRequests())[0].state, 'cancelled');

  const timeoutRoot = await tempRoot('task-timeout-');
  t.after(() => fs.promises.rm(timeoutRoot, { recursive: true, force: true }));
  let timeoutClock = clock;
  const timingOut = api.createDesktopFileGrantBroker({ ...common, rootDirectory: timeoutRoot,
    now: () => new Date(timeoutClock), sleep: async () => { timeoutClock += 30_001; } });
  await assert.rejects(timingOut.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout', version: 1 }, leaseId: crypto.randomUUID() }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_CONSENT_TIMEOUT');

  const restartRoot = await tempRoot('task-restart-');
  t.after(() => fs.promises.rm(restartRoot, { recursive: true, force: true }));
  const vault = api.createMemoryCredentialVault();
  const beforeRestart = api.createDesktopFileGrantBroker({ ...common, rootDirectory: restartRoot,
    credentialVault: vault, sleep: async () => new Promise(() => {}) });
  void beforeRestart.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout', version: 1 }, leaseId: crypto.randomUUID() });
  await waitFor(() => beforeRestart.listConsentRequests(), value => value.length === 1);
  await new Promise(resolve => setTimeout(resolve, 25));
  clock += 30_001;
  const afterRestart = api.createDesktopFileGrantBroker({ ...common, rootDirectory: restartRoot,
    credentialVault: vault });
  assert.equal((await afterRestart.listConsentRequests())[0].state, 'expired');
});

test('consent center is path-redacted, state-complete and history-bounded', async t => {
  const api = await import(apiUrl), root = await tempRoot('consent-center-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const now = new Date('2026-10-28T09:00:00.000Z');
  const entries = Array.from({ length: 205 }, (_, index) => ({
    requestId: crypto.randomUUID(), executionLeaseId: crypto.randomUUID(),
    capabilityKey: 'documents.text.extract', capabilityVersion: 1,
    state: index === 0 ? 'waiting' : ['approved', 'rejected', 'cancelled', 'expired'][index % 4],
    createdAt: new Date(now.getTime() + index).toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    resolvedAt: index === 0 ? null : new Date(now.getTime() + index + 1).toISOString(),
  }));
  const requestFile = path.join(root, 'desktop-shell', 'file-consent-requests.json');
  await fs.promises.mkdir(path.dirname(requestFile), { recursive: true });
  await fs.promises.writeFile(requestFile, JSON.stringify({
    schemaVersion: 'capability-desktop-file-consent-index-v2', entries,
  }), 'utf8');
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root, now: () => now,
    credentialVault: api.createMemoryCredentialVault(), requireTaskBinding: true,
    selectionAdapter: { async selectFiles() { return []; } } });
  const center = await broker.getConsentCenter();
  assert.equal(center.schemaVersion, 'capability-desktop-file-consent-center-v1');
  assert.equal(center.items.length, 200);
  assert.equal(center.notificationCount, 1);
  assert.equal(center.activeCount, 1);
  assert.equal(center.items[0].requestId, entries[0].requestId);
  assert.equal(center.items[0].state, 'waiting');
  assert.equal(center.items.some(item => item.requestId === entries[0].requestId), true);
  assert.equal(center.items.find(item => item.requestId === entries[0].requestId).actionable, true);
  assert.equal(Object.values(center.counts).reduce((sum, count) => sum + count, 0), 200);
  const serialized = JSON.stringify(center);
  assert.doesNotMatch(serialized, /sourcePath|prompt|taskBody|identical bytes|\\Users\\/u);
  const persisted = JSON.parse(await fs.promises.readFile(requestFile, 'utf8'));
  assert.equal(persisted.entries.length, 200);
});

test('Windows picker adapter exposes only bounded filters and selected paths', async () => {
  const api = await import(apiUrl), requests = [];
  const adapter = api.createWindowsFileSelectionAdapter({ platform: 'win32',
    run: async request => { requests.push(request); return JSON.stringify(['C:\\资料\\论文.pdf']); } });
  assert.deepEqual(await adapter.selectFiles({ extensions: ['.pdf'], maxFiles: 2,
    ownerWindowHandle: '424242' }),
    ['C:\\资料\\论文.pdf']);
  assert.deepEqual(requests, [{ extensions: ['.pdf'], maxFiles: 2,
    ownerWindowHandle: '424242' }]);
  await assert.rejects(adapter.selectFiles({ extensions: ['pdf'], maxFiles: 1 }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_PICKER_REQUEST_INVALID');
  await assert.rejects(adapter.selectFiles({ extensions: ['.pdf'], maxFiles: 1,
    ownerWindowHandle: '0' }), error =>
    error.code === 'CAPABILITY_DESKTOP_FILE_PICKER_REQUEST_INVALID');
});

test('Windows CurrentUser DPAPI keeps selected paths out of plaintext authorization storage', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  const api = await import(apiUrl), root = await tempRoot('dpapi-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, '本地私有论文.pdf');
  await fs.promises.writeFile(selected, 'private local bytes', 'utf8');
  const vaultDirectory = path.join(root, 'vault');
  const broker = api.createDesktopFileGrantBroker({ rootDirectory: root,
    credentialVault: api.createWindowsDpapiCredentialVault({ directory: vaultDirectory }),
    selectionAdapter: { async selectFiles() { return [selected]; } } });
  await broker.authorize({ capabilityKey: 'research.paper.layout', extensions: ['.pdf'] });
  const protectedFiles = await fs.promises.readdir(vaultDirectory);
  assert.equal(protectedFiles.length, 1);
  const protectedValue = await fs.promises.readFile(path.join(vaultDirectory, protectedFiles[0]), 'utf8');
  assert.doesNotMatch(protectedValue, /本地私有论文|private local bytes|capability-desktop-file-grant-tests/u);
  const grants = await broker.resolve({ fileScope: 'user-selected',
    contract: { key: 'research.paper.layout' } });
  assert.equal(grants[0].sourcePath, selected);
  assert.deepEqual(await fs.promises.readdir(vaultDirectory), []);
});
