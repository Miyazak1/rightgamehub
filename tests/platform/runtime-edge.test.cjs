const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('runtime edge fails closed when authoritative release state is unavailable', async t => {
  const { createRuntimeEdgeApp } = await import(pathToFileURL(path.join(root, 'apps/api/src/runtime-edge-app.mjs')));
  const app = createRuntimeEdgeApp({
    runtimeDomain: 'gamehub.test',
    repository: { resolveRelease: async () => { throw new Error('database unavailable'); } },
    objectStore: { loadManifest: async () => { throw new Error('must not read storage'); } },
  });
  t.after(() => app.close());
  const host = 'r-11111111111141118111111111111111.gamehub.test';
  const response = await app.inject({ url: '/', headers: { host } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.json().error.code, 'RUNTIME_UNAVAILABLE');
  assert.equal(response.json().error.retryable, true);
});
