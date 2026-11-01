const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { UI, ui, allowedRequest, assetResponse } = require('../../apps/desktop/electron/policy.cjs');

test('desktop requests cannot reach production, files or a different local service', () => {
  const fixture = 'http://127.0.0.1:39001';
  assert.equal(allowedRequest({ url: UI + '/assets/worker.js' }, fixture), true);
  assert.equal(allowedRequest({ url: fixture + '/index.html' }, fixture), true);
  for (const url of ['https://mooyu.fun/v1/me', 'https://example.org/', 'http://127.0.0.1:39002/v1/me', 'file:///C:/private.env', UI + '.evil/index.html', 'mooyu-app://user:pass@client/index.html']) {
    assert.equal(allowedRequest({ url }, fixture), false, url);
  }
  assert.equal(ui('mooyu-app://client:123/index.html'), false);
});

test('packaged protocol preserves routes and Worker MIME but rejects missing assets and escapes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mooyu-assets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'index.html'), '<main>Shared app</main>');
  await fs.writeFile(path.join(root, 'assets/worker.mjs'), 'export const ready=true;');
  const request = (pathname, method = 'GET') => ({ url: UI + pathname, method });
  const deep = await assetResponse(request('/tools/pdf-reader?lang=en'), root, UI, true);
  assert.equal(deep.status, 200);
  assert.equal(await deep.text(), '<main>Shared app</main>');
  const worker = await assetResponse(request('/assets/worker.mjs'), root, UI, true);
  assert.match(worker.headers.get('content-type'), /text\/javascript/u);
  assert.match(worker.headers.get('content-security-policy'), /worker-src 'self'/u);
  assert.doesNotMatch(worker.headers.get('content-security-policy'), /'unsafe-eval'|https:\s|\*/u);
  assert.equal((await assetResponse(request('/assets/missing.js'), root, UI, true)).status, 404);
  assert.equal((await assetResponse(request('/assets/missing-worker'), root, UI, true)).status, 404);
  assert.equal((await assetResponse(request('/..%5csecret'), root, UI, true)).status, 403);
  assert.equal((await assetResponse(request('/x%00file'), root, UI, true)).status, 403);
  assert.equal((await assetResponse(request('/account', 'POST'), root, UI, true)).status, 405);
  assert.equal((await assetResponse({ url: 'mooyu-app://evil/account', method: 'GET' }, root, UI, true)).status, 403);
  assert.equal((await assetResponse(request('/v1/me'), root, UI, true)).status, 503);
});
