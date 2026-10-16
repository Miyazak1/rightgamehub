const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { Readable } = require('node:stream');
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

test('runtime edge grants blob modules only to a verified structured courseware release', async t => {
  const { createRuntimeEdgeApp } = await import(pathToFileURL(path.join(root, 'apps/api/src/runtime-edge-app.mjs')));
  const bytes = Buffer.from('<!doctype html><title>release</title>');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const release = { asset_prefix:'release/',asset_manifest_sha256:'manifest',asset_count:1,expanded_bytes:bytes.length,entry_path:'index.html' };
  let structured = false;
  const app = createRuntimeEdgeApp({
    runtimeDomain:'gamehub.test',
    repository:{ resolveRelease:async () => release },
    objectStore:{
      loadManifest:async () => ({ fileCount:1,totalBytes:bytes.length,entry:'index.html',approvedCapabilities:[],assets:{'index.html':{size:bytes.length,sha256,mime:'text/html; charset=utf-8'}},...(structured?{courseware:{runtime:{profile:'structured-courseware'}}}:{}) }),
      inspectAsset:async () => ({ size:bytes.length,open:async ({start,end}) => Readable.from(bytes.subarray(start,end+1)) }),
    },
  });
  t.after(() => app.close());
  const host = 'r-11111111111141118111111111111111.gamehub.test';
  const legacy = await app.inject({url:'/',headers:{host}});
  assert.equal(legacy.statusCode,200);
  assert.doesNotMatch(legacy.headers['content-security-policy'],/script-src[^;]*blob:/u);
  structured = true;
  const modular = await app.inject({url:'/',headers:{host}});
  assert.equal(modular.statusCode,200);
  assert.match(modular.headers['content-security-policy'],/script-src[^;]*blob:/u);
});
