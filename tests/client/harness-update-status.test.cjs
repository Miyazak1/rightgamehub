const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('Harness exposes a bounded update status and keeps the restart notice non-blocking', async t => {
  const base = path.resolve('.runtime/harness-update-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'storage-'));
  const updateStateFile = path.join(root, 'updates', 'harness.json');
  await fs.mkdir(path.dirname(updateStateFile), { recursive: true });
  await fs.writeFile(updateStateFile, JSON.stringify({
    host: 'harness', phase: 'ready', version: '9.9.9', percent: 100,
    message: 'ready', updatedAt: '2026-09-30T00:00:00.000Z', restartRequired: true,
    privatePath: 'C:\\secret\\plugin.tgz',
  }));
  const { createTransferService } = await import('../../extensions/harness/src/transfer-service.mjs');
  const service = await createTransferService({ root: path.join(root, 'files'), updateStateFile, desktopOptions: { enabled: false } });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const route = service.routes.find(item => item.path === '/api/gamehub/update-status');
  assert.ok(route);
  assert.equal((await route.fetch(new Request('http://dsh.internal/api/gamehub/update-status'))).status, 403);
  const response = await route.fetch(new Request('http://dsh.internal/api/gamehub/update-status', { headers: { 'X-GameHub-Update': '1' } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result, {
    ok: true, enabled: true, phase: 'ready', currentVersion: '0.1.4', version: '9.9.9',
    percent: 100, message: 'ready', updatedAt: '2026-09-30T00:00:00.000Z', restartRequired: true,
  });

  await fs.writeFile(updateStateFile, JSON.stringify({ host: 'harness', version: '9.9.8', sha256: 'a'.repeat(64), stagedAt: '2026-09-30T00:00:00.000Z', restartRequired: true }));
  const legacy = await route.fetch(new Request('http://dsh.internal/api/gamehub/update-status', { headers: { 'X-GameHub-Update': '1' } }));
  assert.equal((await legacy.json()).phase, 'ready');

  const source = await fs.readFile('extensions/harness/src/platform-client.jsx', 'utf8');
  assert.match(source, /aria-live': 'polite'/);
  assert.match(source, /方便时再重启 Harness/);
  assert.match(source, /'稍后'/);
  assert.doesNotMatch(source, /reloadWindow|restartHarness|立即重启/);
});

test('Harness updater scripts publish lifecycle states for the quiet sidebar notice', async () => {
  const windows = await fs.readFile('apps/web/public/agent-update.ps1', 'utf8');
  const portable = await fs.readFile('apps/web/public/agent-update.mjs', 'utf8');
  const installer = await fs.readFile('apps/web/public/install.ps1', 'utf8');
  for (const source of [windows, portable]) {
    for (const phase of ['checking', 'downloading', 'verifying', 'installing', 'ready', 'failed']) assert.match(source, new RegExp(`['\"]${phase}['\"]`));
  }
  assert.match(installer, /WindowStyle Hidden/);
  assert.match(portable, /--quiet/);
});
