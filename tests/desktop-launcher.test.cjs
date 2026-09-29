const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

// Structural bytes only. They have no game or working entrypoint and are NEVER run.
function peFixture({ machine = 0x8664, magic = 0x20b, subsystem = 2, characteristics = 2 } = {}) {
  const bytes = Buffer.alloc(1024);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(machine, 132); bytes.writeUInt16LE(1, 134);
  bytes.writeUInt16LE(magic === 0x10b ? 224 : 240, 148); bytes.writeUInt16LE(characteristics, 150);
  bytes.writeUInt16LE(magic, 152); bytes.writeUInt16LE(subsystem, 220);
  return bytes;
}
const post = { method: 'POST', headers: { 'X-GameHub-Client': '1' } };
const launchOptions = requestId => ({ method: 'POST', headers: { ...post.headers,
  'X-GameHub-Launch': 'independent-window-v1', 'X-GameHub-Request-Id': requestId || randomUUID() } });

async function fixture(t, overrides = {}) {
  const base = path.resolve('.runtime/desktop-launch-tests'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  const calls = [], children = [];
  const spawnProcess = (...args) => {
    calls.push(args); const child = new EventEmitter(); children.push(child);
    child.unref = () => {}; child.kill = () => assert.fail('Independent games must never be killed by sidebar lifecycle');
    queueMicrotask(() => child.emit('spawn')); return child;
  };
  const { createTransferService } = await import('../extensions/harness/src/transfer-service.mjs');
  const options = { root, desktopOptions: { enabled: true, platform: 'win32', spawnProcess,
    environment: { SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'not-for-game', NODE_OPTIONS: '--inspect', Path: 'C:\\secret-tools' }, ...overrides } };
  let service = await createTransferService(options);
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), base); await fs.rm(root, { recursive: true, force: true }); });
  const call = (action, id, init = {}) => {
    const url = new URL('http://dsh.internal/api/gamehub/' + action); if (id) url.searchParams.set('id', id);
    return service.routes.find(route => route.path === url.pathname).fetch(new Request(url, init));
  };
  const upload = async (bytes = peFixture(), name = '测试游戏.exe') => {
    const url = new URL('http://dsh.internal/api/gamehub/upload'); url.searchParams.set('name', name);
    const response = await service.routes.find(route => route.path === url.pathname).fetch(new Request(url, { method: 'POST',
      headers: { ...post.headers, 'Content-Type': 'application/octet-stream', 'X-GameHub-Size': String(bytes.length) }, body: bytes }));
    assert.equal(response.status, 201); return (await response.json()).file;
  };
  return { root, calls, children, call, upload, cache: record => path.join(root, 'desktop-downloads', record.id, 'game.exe'),
    close: () => service.close(), restart: async () => { await service.close(); service = await createTransferService(options); } };
}

test('desktop EXE launch is opt-in and unsupported platforms retain ordinary downloads', async t => {
  for (const options of [{ enabled: false }, { platform: 'linux' }]) {
    const f = await fixture(t, options), record = await f.upload();
    assert.equal((await f.call('desktop-prepare', record.id, post)).status, 404);
    assert.equal((await f.call('desktop-launch', record.id, launchOptions())).status, 404);
    assert.equal((await (await f.call('files')).json()).files[0].desktopLaunch, undefined);
    assert.equal((await f.call('download', record.id)).status, 200); assert.equal(f.calls.length, 0);
  }
});

test('upload and verified EXE download do not execute; explicit launch uses only the managed copy', async t => {
  const f = await fixture(t), bytes = peFixture(), record = await f.upload(bytes, 'game & 中文.exe');
  assert.equal(f.calls.length, 0);
  assert.equal((await f.call('desktop-launch', record.id, launchOptions())).status, 409);
  const result = await (await f.call('desktop-prepare', record.id, post)).json();
  assert.equal(result.ok, true); assert.equal(result.architecture, 'x64'); assert.equal(result.reused, false);
  assert.deepEqual(await fs.readFile(f.cache(record)), bytes); assert.equal(f.calls.length, 0);
  const launched = await (await f.call('desktop-launch', record.id, launchOptions())).json();
  assert.equal(launched.ok, true); assert.equal(launched.mode, 'independent-window');
  assert.equal(f.calls.length, 1);
  const [executable, args, options] = f.calls[0];
  assert.equal(executable, f.cache(record)); assert.deepEqual(args, []);
  assert.equal(options.cwd, path.dirname(executable)); assert.equal(options.shell, false);
  assert.equal(options.detached, true); assert.equal(options.stdio, 'ignore');
  assert.equal(options.env.OPENAI_API_KEY, undefined); assert.equal(options.env.NODE_OPTIONS, undefined);
  assert.equal((await (await f.call('files')).json()).files[0].desktopLaunch.state, 'started');
});

test('desktop routes reject GET, missing action markers, invalid IDs and caller commands', async t => {
  const f = await fixture(t), record = await f.upload();
  assert.equal((await f.call('desktop-launch', record.id)).status, 405);
  assert.equal((await f.call('desktop-prepare', record.id)).status, 405);
  assert.equal((await f.call('desktop-launch', record.id, post)).status, 403);
  assert.equal((await f.call('desktop-prepare', record.id, { method: 'POST' })).status, 403);
  assert.equal((await f.call('desktop-launch', '../outside.exe', launchOptions())).status, 404);
  assert.equal((await f.call('desktop-launch', record.id, { ...launchOptions(), body: '{"path":"C:/other.exe","args":["/silent"]}' })).status, 400);
  await f.call('desktop-prepare', record.id, post);
  assert.equal((await f.call('desktop-launch', record.id, launchOptions('bad-id'))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('same launch request is idempotent before and after success; new clicks cannot duplicate a running entry', async t => {
  const f = await fixture(t), record = await f.upload(); await f.call('desktop-prepare', record.id, post);
  const requestId = randomUUID(), options = launchOptions(requestId);
  const first = f.call('desktop-launch', record.id, options), second = f.call('desktop-launch', record.id, options);
  const values = await Promise.all([first.then(r => r.json()), second.then(r => r.json())]);
  assert.equal(values[0].ok, true); assert.deepEqual(values[0], values[1]); assert.equal(f.calls.length, 1);
  assert.deepEqual(await (await f.call('desktop-launch', record.id, options)).json(), values[0]);
  assert.equal((await f.call('desktop-launch', record.id, launchOptions())).status, 409);
  assert.equal((await f.call('desktop-prepare', record.id, post)).status, 409);
  f.children[0].emit('exit', 0);
  assert.equal((await (await f.call('files')).json()).files[0].desktopLaunch.state, 'entry-exited');
  assert.equal((await f.call('desktop-launch', record.id, launchOptions())).status, 200);
  assert.equal(f.calls.length, 2);
});

test('closing a service does not terminate independent games and restart never launches automatically', async t => {
  const f = await fixture(t), record = await f.upload(); await f.call('desktop-prepare', record.id, post);
  await f.call('desktop-launch', record.id, launchOptions()); await f.restart();
  assert.equal(f.calls.length, 1);
  const state = (await (await f.call('files')).json()).files[0].desktopLaunch;
  assert.equal(state.prepared, false); assert.equal(state.state, 'idle');
  assert.equal((await f.call('desktop-launch', record.id, launchOptions())).status, 409);
  assert.equal((await (await f.call('desktop-prepare', record.id, post)).json()).reused, true);
  assert.equal(f.calls.length, 1);
});

test('modified EXE copy is blocked before execution; re-download preserves local saves', async t => {
  const f = await fixture(t), bytes = peFixture(), record = await f.upload(bytes); await f.call('desktop-prepare', record.id, post);
  const modified = Buffer.from(bytes); modified[900] = 123; await fs.writeFile(f.cache(record), modified);
  const save = path.join(path.dirname(f.cache(record)), 'save.dat'); await fs.writeFile(save, 'player-save');
  const response = await f.call('desktop-launch', record.id, launchOptions());
  assert.equal(response.status, 409); assert.match((await response.json()).error, /校验失败/); assert.equal(f.calls.length, 0);
  assert.equal((await (await f.call('files')).json()).files[0].desktopLaunch.prepared, false);
  assert.equal((await f.call('desktop-prepare', record.id, post)).status, 200);
  assert.deepEqual(await fs.readFile(f.cache(record)), bytes); assert.equal(await fs.readFile(save, 'utf8'), 'player-save');
});

test('modified source download never commits a runnable EXE', async t => {
  const f = await fixture(t), bytes = peFixture(), record = await f.upload(bytes);
  const changed = Buffer.from(bytes); changed[900] ^= 1; await fs.writeFile(path.join(f.root, record.id + '.bin'), changed);
  const response = await f.call('desktop-prepare', record.id, post);
  assert.equal(response.status, 409); assert.match((await response.json()).error, /下载校验失败/);
  await assert.rejects(fs.stat(f.cache(record)), { code: 'ENOENT' });
  assert.equal((await fs.readdir(path.join(f.root, 'desktop-downloads'))).some(name => name.endsWith('.part')), false);
  assert.equal(f.calls.length, 0);
});

test('non-PE, DLL, driver and console images stay downloadable but cannot prepare for GUI launch', async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1022)]), peFixture({ characteristics: 0x2002 }),
    peFixture({ subsystem: 1 }), peFixture({ subsystem: 3 })]) {
    const record = await f.upload(bytes);
    assert.equal((await f.call('desktop-prepare', record.id, post)).status, 409);
    assert.deepEqual(Buffer.from(await (await f.call('download', record.id)).arrayBuffer()), bytes);
  }
  assert.equal(f.calls.length, 0);
});

test('failed Windows spawn returns an error, never retries, and does not elevate', async t => {
  let calls = 0;
  const f = await fixture(t, { spawnProcess: () => {
    calls++; const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => child.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' }))); return child;
  } });
  const record = await f.upload(); await f.call('desktop-prepare', record.id, post);
  const options = launchOptions();
  assert.equal((await f.call('desktop-launch', record.id, options)).status, 503);
  const repeated = await f.call('desktop-launch', record.id, options);
  assert.equal(repeated.status, 503); assert.match((await repeated.json()).error, /不会自动提权/); assert.equal(calls, 1);
});

test('EXE cache quota is bounded separately from uploaded files', async t => {
  const f = await fixture(t, { quotaBytes: 1024, maxFiles: 1 });
  const a = await f.upload(), b = await f.upload();
  assert.equal((await f.call('desktop-prepare', a.id, post)).status, 200);
  assert.equal((await f.call('desktop-prepare', b.id, post)).status, 507);
  assert.equal((await f.call('download', b.id)).status, 200); assert.equal(f.calls.length, 0);
});

test('cancelled desktop preparation cannot execute and a later attempt can retry', async t => {
  const f = await fixture(t), record = await f.upload();
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.call('desktop-prepare', record.id, { ...post, signal: controller.signal })).status, 408);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.call('desktop-prepare', record.id, post)).status, 200);
});

test('desktop environment copies only OS profile paths and normalizes Windows variable casing', async () => {
  const { desktopEnvironment } = await import('../extensions/harness/src/desktop-launcher.mjs');
  const env = desktopEnvironment({ SystemRoot: 'C:\\Windows', windir: 'C:\\Windows', APPDATA: 'C:\\User\\AppData',
    PATH: 'secret-tools', Path: 'other-tools', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1', DSH_API_KEY: 'secret', HTTP_PROXY: 'secret-proxy' });
  assert.deepEqual(Object.keys(env).sort(), ['APPDATA', 'PATH', 'SYSTEMROOT', 'WINDIR']);
  assert.equal(env.PATH, 'C:\\Windows\\System32;C:\\Windows');
});
