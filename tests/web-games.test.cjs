const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { request } = require('node:http');
const { makeZip } = require('../scripts/zip-fixture.cjs');

async function setup(t, options = {}) {
  const base = path.resolve(__dirname, '../.runtime/web-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  const { createTransferService } = await import('../extensions/harness/src/transfer-service.mjs');
  const service = await createTransferService({ root, ...options });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), base); assert.match(path.basename(root), /^case-/); await fs.rm(root, { recursive: true, force: true }); });
  const call = (action, options = {}, params = {}) => {
    const url = new URL(`http://dsh.internal/api/gamehub/${action}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return service.routes.find(route => route.path === url.pathname).fetch(new Request(url, options));
  };
  const upload = async entries => {
    const data = makeZip(entries);
    const response = await call('upload', { method: 'POST', body: data, headers: { 'Content-Type': 'application/octet-stream', 'X-GameHub-Client': '1', 'X-GameHub-Size': String(data.length) } }, { name: '测试游戏.zip' });
    assert.equal(response.status, 201);
    return (await response.json()).file;
  };
  const launch = async id => (await call('launch', { method: 'POST', headers: { 'X-GameHub-Client': '1' } }, { id })).json();
  return { root, service, call, upload, launch, createTransferService };
}
const html = { name: 'index.html', data: '<!doctype html><script type="module" src="assets/app.js"></script><h1>My game</h1>' };
const script = { name: 'assets/app.js', data: 'console.log("game")' };

test('web ZIP becomes a persistent playable record without exposing asset manifests', async t => {
  const f = await setup(t);
  const file = await f.upload([html, script, { name: 'assets/data.json', data: '{"level":1}' }]);
  assert.equal(file.web.state, 'ready');
  assert.equal(file.web.title, '测试游戏');
  assert.equal(file.web.fileCount, 3);
  assert.equal(file.web.assets, undefined);
  const restored = await f.createTransferService({ root: f.root });
  t.after(() => restored.close());
  const response = await restored.routes[0].fetch(new Request('http://dsh.internal/api/gamehub/files'));
  assert.deepEqual((await response.json()).files, [file]);
  assert.equal(await fs.readFile(path.join(f.root, 'web', file.id, 'assets/app.js'), 'utf8'), script.data);
});

test('runtime serves token-scoped HTML/module/data/WASM with opaque sandbox and exact MIME', async t => {
  const f = await setup(t);
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const file = await f.upload([html, script, { name: 'test.wasm', data: wasm }, { name: 'empty.txt', data: '' }]);
  const launch = await f.launch(file.id);
  assert.equal(launch.ok, true);
  const response = await fetch(launch.url);
  assert.equal(await response.text(), html.data);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts/); assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /worker-src 'none'/); assert.match(csp, /form-action 'none'/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  const js = await fetch(new URL('assets/app.js', launch.url), { headers: { Origin: 'null' } });
  assert.match(js.headers.get('content-type'), /^text\/javascript/); assert.equal(await js.text(), script.data);
  const binary = await fetch(new URL('test.wasm', launch.url));
  assert.equal(binary.headers.get('content-type'), 'application/wasm'); assert.deepEqual(Buffer.from(await binary.arrayBuffer()), wasm);
  const empty = await fetch(new URL('empty.txt', launch.url)); assert.equal(await empty.text(), '');
  const partial = await fetch(new URL('test.wasm', launch.url), { headers: { Range: 'bytes=2-4' } });
  assert.equal(partial.status, 206); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), wasm.subarray(2, 5));
  const head = await fetch(launch.url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(html.data))); assert.equal(await head.text(), '');
});

test('runtime rejects unissued tokens, traversal, workspace access and mutations; stop revokes assets', async t => {
  const f = await setup(t);
  const file = await f.upload([html, script]);
  assert.equal((await f.call('launch', { method: 'POST' }, { id: file.id })).status, 403);
  const launch = await f.launch(file.id);
  const url = new URL(launch.url);
  assert.equal((await fetch(new URL('/api/gamehub/files', url))).status, 404);
  assert.equal((await fetch(launch.url.replace(/\/play\/[^/]+\//, '/play/' + 'a'.repeat(43) + '/'))).status, 404);
  assert.equal((await fetch(launch.url, { method: 'POST' })).status, 405);
  const badHost = await new Promise((resolve, reject) => {
    const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(launch.url, { headers: { Origin: 'https://evil.example' } })).status, 403);
  for (const tail of ['../secret', '%2e%2e/secret', 'assets%2fapp.js', 'assets/%252e%252e/secret']) {
    const status = await new Promise((resolve, reject) => {
      const req = request({ hostname: url.hostname, port: url.port, path: url.pathname.replace('index.html', tail) }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
    });
    assert.ok([400, 404].includes(status), `${tail}: ${status}`);
  }
  await f.call('stop', { method: 'POST', headers: { 'X-GameHub-Client': '1' } }, { launchId: launch.launchId });
  assert.equal((await fetch(launch.url)).status, 404);
});

test('unsafe ZIP paths and collisions stay download-only and leave no partial extraction', async t => {
  const f = await setup(t);
  const cases = [
    [{ name: '../escape.js', data: 'x' }], [{ name: '/root.js', data: 'x' }], [{ name: 'C:/evil.js', data: 'x' }],
    [{ name: 'bad\\file.js', data: 'x' }], [{ name: 'CON.js', data: 'x' }], [{ name: 'bad./file.js', data: 'x' }],
    [{ name: 'bad%20.js', data: 'x' }], [{ name: 'é.js', data: 'x' }, { name: 'e\u0301.js', data: 'x' }],
    [script, script], [{ name: 'A.js', data: 'x' }, { name: 'a.js', data: 'x' }],
    [{ name: 'Dir/a.js', data: 'x' }, { name: 'dir/b.js', data: 'x' }],
    [{ name: 'a.js', data: 'x' }, { name: 'a.js/b.js', data: 'x' }], [{ name: 'link.js', data: 'outside', mode: 0xa1ff }],
  ];
  for (const entries of cases) {
    const file = await f.upload([html, ...entries]);
    assert.equal(file.web.state, 'rejected', JSON.stringify(entries));
    assert.equal((await f.launch(file.id)).ok, false);
    assert.deepEqual(await fs.readdir(path.join(f.root, 'web')), []);
  }
});

test('bad CRC, lying expansion size, encrypted files, native files and nested ZIP cannot play', async t => {
  const f = await setup(t);
  for (const entry of [
    { name: 'bad.js', data: 'hello', crc: 123 }, { name: 'bad.js', data: 'hello', size: 1 },
    { name: 'bad.js', data: 'hello', flags: 0x801 }, { name: 'bad.exe', data: 'MZ123' },
    { name: 'nested.zip', data: 'PK123' }, { name: 'data.gz', data: 'gzip' },
    { name: 'huge.js', data: 'small', size: 101 * 1024 * 1024 },
  ]) {
    const file = await f.upload([html, entry]); assert.equal(file.web.state, 'rejected');
    assert.deepEqual(await fs.readdir(path.join(f.root, 'web')), []);
  }
});

test('missing root index gives a useful reason; extracted bytes count against storage quota', async t => {
  const f = await setup(t, { quotaBytes: 10000 });
  const wrong = await f.upload([{ name: 'build/index.html', data: 'hello' }]);
  assert.equal(wrong.web.state, 'rejected'); assert.match(wrong.web.reason, /根目录.*index.html/);
  const big = await f.upload([html, { name: 'big.txt', data: 'x'.repeat(12000) }]);
  assert.equal(big.web.state, 'rejected');
  const good = await f.upload([html, script]);
  const list = await (await f.call('files')).json();
  assert.equal(list.usedBytes, wrong.size + big.size + good.size + good.web.totalBytes);
});

test('each launch gets a separate capability and expired leases stop serving', async t => {
  const f = await setup(t);
  const file = await f.upload([html]);
  const stored = JSON.parse(await fs.readFile(path.join(f.root, file.id + '.json'), 'utf8'));
  const { createGameRuntime } = await import('../extensions/harness/src/game-runtime.mjs');
  const runtime = createGameRuntime({ root: f.root, leaseMs: 1 }); t.after(() => runtime.close());
  const first = await runtime.launch(stored), second = await runtime.launch(stored);
  assert.notEqual(first.url, second.url);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await fetch(second.url)).status, 404);
});
