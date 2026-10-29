const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const artifactId = '9a59180c-598e-4d63-9e6c-cfbdb315ab8d';
const runId = 'bf9af255-0b8f-49bb-9884-6a3dbf076a9f';
const content = { z: 1, nested: { b: true, a: 'text' } };
const canonical = '{"nested":{"a":"text","b":true},"z":1}';

test('Harness trusted artifact route verifies digest and serves a one-use scriptless preview', async t => {
  const base = path.resolve('.runtime/harness-artifact-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'storage-'));
  const { createTransferService } = await import('../../extensions/harness/src/transfer-service.mjs');
  const service = await createTransferService({ root, desktopOptions: { enabled: false } });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const open = service.routes.find(route => route.path === '/api/gamehub/capability-artifact-open');
  const preview = service.routes.find(route => route.path === '/api/gamehub/capability-artifact-preview');
  assert.ok(open); assert.ok(preview);
  const sha256 = crypto.createHash('sha256').update(canonical).digest('hex');
  const directive = { schemaVersion: 'capability-artifact-open-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256,
    openMode: 'host-preview', locator: `mooyu-artifact://host-preview/${artifactId}`,
    expiresAt: new Date(Date.now() + 120000).toISOString() };
  const artifact = { schemaVersion: 'capability-artifact-content-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256, content };
  const response = await open.fetch(new Request('http://dsh.internal/api/gamehub/capability-artifact-open', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GameHub-Capability-Artifact': '1' },
    body: JSON.stringify({ directive, artifact }),
  }));
  assert.equal(response.status, 200);
  const opened = await response.json();
  assert.equal(opened.opened, true);
  const page = await preview.fetch(new Request(new URL(opened.previewPath, 'http://dsh.internal')));
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /verified\.result/);
  assert.doesNotMatch(html, /<script/iu);
  assert.equal((await preview.fetch(new Request(new URL(opened.previewPath, 'http://dsh.internal')))).status, 404);

  const altered = await open.fetch(new Request('http://dsh.internal/api/gamehub/capability-artifact-open', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GameHub-Capability-Artifact': '1' },
    body: JSON.stringify({ directive, artifact: { ...artifact, content: { ...content, z: 2 } } }),
  }));
  assert.equal(altered.status, 400);
  const unsafeName = await open.fetch(new Request('http://dsh.internal/api/gamehub/capability-artifact-open', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GameHub-Capability-Artifact': '1' },
    body: JSON.stringify({ directive: { ...directive, name: '../unsafe' },
      artifact: { ...artifact, name: '../unsafe' } }),
  }));
  assert.equal(unsafeName.status, 400);
  const oversized = await open.fetch(new Request('http://dsh.internal/api/gamehub/capability-artifact-open', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GameHub-Capability-Artifact': '1' },
    body: JSON.stringify({ directive: { ...directive, sizeBytes: 1048577 },
      artifact: { ...artifact, sizeBytes: 1048577 } }),
  }));
  assert.equal(oversized.status, 400);
});

test('Harness restart invalidates old preview URLs while the verified artifact can be reopened', async t => {
  const base = path.resolve('.runtime/harness-artifact-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'restart-'));
  const { createTransferService } = await import('../../extensions/harness/src/transfer-service.mjs');
  const sha256 = crypto.createHash('sha256').update(canonical).digest('hex');
  const directive = { schemaVersion: 'capability-artifact-open-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256,
    openMode: 'host-preview', locator: `mooyu-artifact://host-preview/${artifactId}`,
    expiresAt: new Date(Date.now() + 120000).toISOString() };
  const artifact = { schemaVersion: 'capability-artifact-content-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256, content };
  const request = () => new Request('http://dsh.internal/api/gamehub/capability-artifact-open', {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-GameHub-Capability-Artifact': '1' }, body: JSON.stringify({ directive, artifact }),
  });
  let service = await createTransferService({ root, desktopOptions: { enabled: false } });
  const openBefore = service.routes.find(route => route.path === '/api/gamehub/capability-artifact-open');
  const stalePath = (await (await openBefore.fetch(request())).json()).previewPath;
  await service.close();

  service = await createTransferService({ root, desktopOptions: { enabled: false } });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const preview = service.routes.find(route => route.path === '/api/gamehub/capability-artifact-preview');
  assert.equal((await preview.fetch(new Request(new URL(stalePath, 'http://dsh.internal')))).status, 404);
  const openAfter = service.routes.find(route => route.path === '/api/gamehub/capability-artifact-open');
  const freshPath = (await (await openAfter.fetch(request())).json()).previewPath;
  assert.notEqual(freshPath, stalePath);
  assert.equal((await preview.fetch(new Request(new URL(freshPath, 'http://dsh.internal')))).status, 200);
});
