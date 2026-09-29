const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { makeZip } = require('../scripts/zip-fixture.cjs');
const { createResourcePolicy } = require('../poc/offscreen/resource-policy.cjs');
const post = { method: 'POST', headers: { 'X-GameHub-Input': '1', 'X-GameHub-Client': '1' } };
const windows = { skip: process.platform !== 'win32' };

async function fixture(t) {
  const base = path.resolve('.runtime/offscreen-package-tests'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  const { buildOwnedPackage } = await import('../scripts/build-offscreen-package.mjs');
  const { bytes, approval } = await buildOwnedPackage();
  const { createTransferService } = await import('../extensions/harness/src/transfer-service.mjs');
  const { normalizePlayerInput } = await import('../poc/offscreen/runner.mjs');
  const starts = [], stops = [];
  const component = { normalizePlayerInput, startOffscreenSample: async options => {
    starts.push(options);
    return { stop: async () => { stops.push(options); }, input: async () => undefined,
      getFrame: () => ({ id: 1, receivedAt: Date.now(), jpeg: Buffer.from([255, 216, 255, 217]) }) };
  } };
  const options = { root, offscreenOptions: { project: process.cwd(), checkRuntime: async () => {}, loadModule: async () => component } };
  let service = await createTransferService(options);
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), base); await fs.rm(root, { recursive: true, force: true }); });
  const call = (name, params = {}, init = {}) => {
    const url = new URL('http://dsh.internal/api/gamehub/' + name);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return service.routes.find(route => route.path === url.pathname).fetch(new Request(url, init));
  };
  const upload = async (data = bytes, name = 'owned-sidebar.zip') => {
    const response = await call('upload', { name }, { method: 'POST', headers: {
      'X-GameHub-Client': '1', 'Content-Type': 'application/octet-stream', 'X-GameHub-Size': String(data.length),
    }, body: data });
    assert.equal(response.status, 201); return (await response.json()).file;
  };
  const record = id => fs.readFile(path.join(root, id + '.json'), 'utf8').then(JSON.parse);
  return { root, bytes, approval, starts, stops, call, upload, record,
    restart: async () => { await service.close(); service = await createTransferService(options); } };
}

test('owned package upload, real download, verified cache and launch handoff preserve exact renderer bytes', windows, async t => {
  const f = await fixture(t), file = await f.upload();
  assert.equal(file.sha256, f.approval.sha256);
  assert.equal(file.web.offscreen.manifest.runtime, 'electron-offscreen-v1');
  assert.equal(file.web.assets, undefined);
  assert.equal(file.published, false);
  assert.deepEqual(Buffer.from(await (await f.call('download', { id: file.id })).arrayBuffer()), f.bytes);
  assert.equal((await f.call('launch', { id: file.id }, post)).status, 409, 'Adapted packages cannot use the normal web-game route');
  assert.equal((await f.call('offscreen-launch', { id: file.id }, post)).status, 409);
  assert.equal((await f.call('offscreen-prepare', { id: file.id })).status, 405);
  assert.equal((await f.call('offscreen-prepare', { id: file.id }, { method: 'POST' })).status, 403);
  const prepared = await (await f.call('offscreen-prepare', { id: file.id }, post)).json();
  assert.equal(prepared.ok, true); assert.equal(prepared.prepared, true); assert.equal(prepared.reused, false);
  assert.equal(f.starts.length, 0, 'Neither upload nor preparation may start a game');
  const listing = await (await f.call('files')).json();
  assert.deepEqual(listing.files[0].offscreenPackage, { approved: true, enabled: true, prepared: true });
  const launched = await (await f.call('offscreen-launch', { id: file.id }, post)).json();
  assert.match(launched.launchId, /^offscreen:/);
  assert.equal(f.starts.length, 1);
  const directory = path.join(f.root, 'offscreen-cache', f.approval.sha256);
  assert.equal(f.starts[0].packageDirectory, directory);
  assert.deepEqual(await fs.readFile(path.join(directory, 'package.zip')), f.bytes);
  const { verifyInstalledPackage } = await import('../extensions/harness/src/offscreen-install.mjs');
  const verified = await verifyInstalledPackage(directory, file.sha256);
  assert.match(await fs.readFile(verified.entry, 'utf8'), /assets\/sdk.js/);
  assert.equal((await f.call('offscreen-prepare', { id: file.id }, post)).status, 409, 'Do not replace files while running');
  await f.call('stop', { launchId: launched.launchId }, post);
  assert.equal(f.stops.length, 1);
});

test('service restart requires manual cache preparation and reuses a still-verified download', windows, async t => {
  const f = await fixture(t), file = await f.upload();
  assert.equal((await f.call('offscreen-prepare', { id: file.id }, post)).status, 200);
  await f.restart();
  assert.equal((await (await f.call('files')).json()).files[0].offscreenPackage.prepared, false);
  assert.equal((await f.call('offscreen-launch', { id: file.id }, post)).status, 409);
  const result = await (await f.call('offscreen-prepare', { id: file.id }, post)).json();
  assert.equal(result.reused, true); assert.equal(f.starts.length, 0);
});

test('altered cache resources are rejected before launch and explicit preparation repairs them', windows, async t => {
  const f = await fixture(t), file = await f.upload();
  await f.call('offscreen-prepare', { id: file.id }, post);
  const directory = path.join(f.root, 'offscreen-cache', file.sha256);
  const altered = path.join(directory, 'web', file.id, 'assets', 'game.js');
  const original = await fs.readFile(altered);
  const modified = Buffer.from(original); modified[0] ^= 1; await fs.writeFile(altered, modified);
  const refused = await (await f.call('offscreen-launch', { id: file.id }, post)).json();
  assert.equal(refused.ok, false); assert.match(refused.error, /摘要不匹配/); assert.equal(f.starts.length, 0);
  assert.equal((await (await f.call('files')).json()).files[0].offscreenPackage.prepared, false);
  const repaired = await (await f.call('offscreen-prepare', { id: file.id }, post)).json();
  assert.equal(repaired.ok, true); assert.equal(repaired.reused, false);
  assert.deepEqual(await fs.readFile(altered), original);
});

test('corrupt source download never commits a runnable cache and retry succeeds', windows, async t => {
  const f = await fixture(t), file = await f.upload();
  const blob = path.join(f.root, file.id + '.bin');
  const corrupt = Buffer.from(f.bytes); corrupt[100] ^= 1; await fs.writeFile(blob, corrupt);
  const response = await (await f.call('offscreen-prepare', { id: file.id }, post)).json();
  assert.equal(response.ok, false); assert.match(response.error, /下载校验失败/);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'offscreen-cache')), []);
  assert.equal(f.starts.length, 0);
  await fs.writeFile(blob, f.bytes);
  assert.equal((await f.call('offscreen-prepare', { id: file.id }, post)).status, 200);
});

test('recognized author packages and EXEs stay download-only until separately approved', windows, async t => {
  const f = await fixture(t);
  const manifest = JSON.parse(await fs.readFile('poc/offscreen-package/gamehub.offscreen.json', 'utf8'));
  const other = makeZip([{ name: 'index.html', data: '<canvas></canvas>' }, { name: 'gamehub.offscreen.json', data: JSON.stringify(manifest) }]);
  const file = await f.upload(other);
  assert.equal(file.web.state, 'ready');
  const listing = await (await f.call('files')).json();
  assert.equal(listing.files[0].offscreenPackage.approved, false);
  assert.equal((await (await f.call('offscreen-prepare', { id: file.id }, post)).json()).ok, false);
  assert.equal((await (await f.call('offscreen-launch', { id: file.id }, post)).json()).ok, false);
  const exe = await f.upload(Buffer.from('MZowned-dummy'), 'example.exe');
  assert.equal((await (await f.call('offscreen-prepare', { id: exe.id }, post)).json()).ok, false);
  assert.equal(f.starts.length, 0);
  assert.deepEqual(Buffer.from(await (await f.call('download', { id: file.id })).arrayBuffer()), other);
});

test('invalid adaptation manifests do not fall back to normal web-game launch', async t => {
  const f = await fixture(t);
  const manifest = JSON.parse(await fs.readFile('poc/offscreen-package/gamehub.offscreen.json', 'utf8'));
  for (const invalid of [ { ...manifest, entry: '../outside.html' }, { ...manifest, main: 'install.exe' },
    { ...manifest, permissions: { network: true, audio: false } }, { ...manifest, viewport: { width: 1920, height: 1080 } } ]) {
    const file = await f.upload(makeZip([{ name: 'index.html', data: '<p>present</p>' }, { name: 'gamehub.offscreen.json', data: JSON.stringify(invalid) }]));
    assert.equal(file.web.state, 'rejected');
    assert.equal((await f.call('launch', { id: file.id }, post)).status, 409);
  }
  assert.equal(f.starts.length, 0);
});

test('aborting a partial package download cancels its stream and removes staging bytes', async t => {
  const f = await fixture(t), file = await f.upload();
  const record = await f.record(file.id);
  const { installOffscreenPackage } = await import('../extensions/harness/src/offscreen-install.mjs');
  const controller = new AbortController(); let cancelled = false, pulling;
  const started = new Promise(resolve => { pulling = resolve; });
  const root = path.join(f.root, 'abort-cache');
  const operation = installOffscreenPackage({ root, record, signal: controller.signal, download: async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(f.bytes.subarray(0, 12)); pulling(); }, cancel() { cancelled = true; },
  }), { headers: { 'Content-Length': String(f.bytes.length) } }) });
  const rejected = assert.rejects(operation, /abort/i);
  await started; controller.abort(); await rejected;
  assert.equal(cancelled, true); assert.deepEqual(await fs.readdir(root), []);
});

test('cache receipt cannot approve modified files, extra scripts, or a different archive', windows, async t => {
  const f = await fixture(t), file = await f.upload();
  await f.call('offscreen-prepare', { id: file.id }, post);
  const directory = path.join(f.root, 'offscreen-cache', file.sha256);
  const { verifyInstalledPackage } = await import('../extensions/harness/src/offscreen-install.mjs');
  const extra = path.join(directory, 'web', file.id, 'extra.js'); await fs.writeFile(extra, 'throw 1;');
  await assert.rejects(verifyInstalledPackage(directory), /额外文件/); await fs.unlink(extra);
  const receipt = path.join(directory, 'install.json');
  await fs.writeFile(receipt, JSON.stringify({ schemaVersion: 1, sourceId: '../outside', sha256: file.sha256 }));
  await assert.rejects(verifyInstalledPackage(directory), /未经批准/);
  await fs.writeFile(receipt, JSON.stringify({ schemaVersion: 1, sourceId: randomUUID(), sha256: '0'.repeat(64) }));
  await assert.rejects(verifyInstalledPackage(directory), /未经批准/);
});

test('package SDK exposes game input acknowledgements without sample-specific state or host capabilities', async () => {
  const reports = []; let callback;
  const sandbox = { window: { gamehubOffscreen: { onInput: fn => { callback = fn; return () => {}; }, report: message => reports.push(message) } } };
  vm.runInNewContext(await fs.readFile('poc/offscreen-package/sdk.js', 'utf8'), sandbox);
  assert.deepEqual(Object.keys(sandbox.window.GameHub).sort(), ['applied', 'onInput', 'ready']);
  let input; sandbox.window.GameHub.onInput(value => { input = value; });
  callback({ type: 'release', seq: 1 }); sandbox.window.GameHub.applied(input.seq); sandbox.window.GameHub.ready();
  assert.equal(JSON.stringify(reports), '[{"type":"applied","seq":1},{"type":"ready"}]');
  assert.throws(() => sandbox.window.GameHub.applied(-1));
});

test('renderer request policy permits only the verified local asset list', () => {
  const file = path.resolve('poc/offscreen-package/index.html');
  const allow = createResourcePolicy([file]);
  const request = { url: pathToFileURL(file).href, method: 'GET', resourceType: 'mainFrame' };
  assert.equal(allow(request), true);
  for (const change of [{ method: 'POST' }, { url: 'https://example.com/' }, { url: 'http://127.0.0.1:3083/' },
    { url: 'file://server/share/index.html' }, { url: pathToFileURL(path.resolve('package.json')).href }, { resourceType: 'subFrame' }, { resourceType: 'object' }]) {
    assert.equal(allow({ ...request, ...change }), false);
  }
});
