const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function fixture(t, options = {}) {
  const base = path.resolve(__dirname, '../.runtime/transfer-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  const { createTransferService } = await import('../extensions/harness/src/transfer-service.mjs');
  const service = await createTransferService({ root, ...options });
  t.after(async () => {
    await service.close();
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.ok(path.basename(root).startsWith('case-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const call = (action, requestOptions = {}, params = {}) => {
    const url = new URL(`http://dsh.internal/api/gamehub/${action}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return service.routes.find(route => route.path === url.pathname).fetch(new Request(url, requestOptions));
  };
  const upload = (data, name = '测试.exe', overrides = {}) => call('upload', {
    method: 'POST', body: data, duplex: 'half',
    headers: { 'Content-Type': 'application/octet-stream', 'X-GameHub-Client': '1', 'X-GameHub-Size': String(data.length) }, ...overrides,
  }, { name });
  return { root, service, call, upload, createTransferService };
}

test('streamed upload persists exact bytes, private metadata and restart listing', async t => {
  const f = await fixture(t);
  const data = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2 * 1024 * 1024, 123)]);
  let cursor = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (cursor === data.length) { controller.close(); return; }
    const end = Math.min(cursor + 7919, data.length);
    controller.enqueue(data.subarray(cursor, end)); cursor = end;
  } });
  const response = await f.upload(data, '桌猫.exe', { body: stream });
  assert.equal(response.status, 201);
  const { file } = await response.json();
  assert.equal(file.name, '桌猫.exe');
  assert.equal(file.size, data.length);
  assert.equal(file.sha256, createHash('sha256').update(data).digest('hex'));
  assert.equal(file.published, false);
  assert.equal(file.scanStatus, 'not_scanned');
  assert.deepEqual(await fs.readFile(path.join(f.root, `${file.id}.bin`)), data);
  const restarted = await f.createTransferService({ root: f.root });
  t.after(() => restarted.close());
  const list = await restarted.routes[0].fetch(new Request('http://dsh.internal/api/gamehub/files'));
  assert.deepEqual((await list.json()).files, [file]);
  assert.equal((await fs.readdir(f.root)).length, 2);
});

test('credential route requires the trusted client marker and delegates only to the host vault', async t => {
  let tokens = null; let clears = 0;
  const credentialStore = {
    available: true,
    persistence: { kind: 'os-keychain', description: 'OS vault' },
    async get() { return tokens; },
    async set(value) { tokens = { ...value }; },
    async clear() { tokens = null; clears += 1; },
  };
  const f = await fixture(t, { credentialStore });
  assert.equal((await f.call('credentials')).status, 403);
  const headers = { 'X-GameHub-Credentials': '1' };
  const saved = { accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43) };
  assert.equal((await f.call('credentials', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens: saved }) })).status, 200);
  const restored = await (await f.call('credentials', { headers })).json();
  assert.deepEqual(restored.tokens, saved);
  assert.equal(restored.persistence.kind, 'os-keychain');
  assert.equal((await f.call('credentials', { method: 'DELETE', headers })).status, 200);
  assert.equal(clears, 1);
});

test('download supports full bytes, HEAD, bounded ranges and safe attachment filename', async t => {
  const f = await fixture(t);
  const data = Buffer.from('MZabcdefghijklmnop');
  const { file } = await (await f.upload(data, '小猫.exe')).json();
  const response = await f.call('download', {}, { id: file.id });
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('content-disposition'), /attachment;.*filename\*=UTF-8''%/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), data);
  const head = await f.call('download', { method: 'HEAD' }, { id: file.id });
  assert.equal(head.headers.get('content-length'), String(data.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const [range, expected] of [['bytes=2-5', data.subarray(2, 6)], ['bytes=-3', data.subarray(-3)], ['bytes=15-', data.subarray(15)]]) {
    const partial = await f.call('download', { headers: { Range: range } }, { id: file.id });
    assert.equal(partial.status, 206);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected);
  }
  assert.equal((await f.call('download', { headers: { Range: 'bytes=100-200' } }, { id: file.id })).status, 416);
  assert.equal((await f.call('download', {}, { id: '../secret' })).status, 404);
});

test('manual verification detects tampered downloads without saving another copy', async t => {
  const f = await fixture(t);
  const data = Buffer.from('MZabcdefgh');
  const { file } = await (await f.upload(data)).json();
  for (const [body, matches] of [[data, true], [Buffer.from('MZxxxxxxxx'), false]]) {
    const response = await f.call('verify', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', 'X-GameHub-Client': '1', 'X-GameHub-Size': String(body.length) } }, { id: file.id });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).matches, matches);
  }
  assert.equal((await fs.readdir(f.root)).length, 2);
});

test('unsafe names, unsupported formats and missing UI marker are rejected', async t => {
  const f = await fixture(t);
  for (const name of ['../bad.exe', 'C:\\bad.exe', 'bad.exe:stream', 'CON.exe', 'bad.html', 'bad\r\n.exe']) {
    assert.equal((await f.upload(Buffer.from('MZ1234'), name)).status, 400);
  }
  assert.equal((await f.upload(Buffer.from('not an exe'))).status, 415);
  assert.equal((await f.upload(Buffer.from('MZ1234'), 'test.zip')).status, 415);
  assert.equal((await f.upload(Buffer.from('MZ1234'), 'test.exe', { headers: { 'Content-Type': 'application/octet-stream', 'X-GameHub-Size': '6' } })).status, 403);
  assert.deepEqual(await fs.readdir(f.root), []);
  assert.equal((await f.upload(Buffer.from('PK\x05\x06empty-zip'), 'test.zip')).status, 201);
});

test('declared and streamed size limits prevent partial or oversized commits', async t => {
  const f = await fixture(t, { maxBytes: 10 });
  assert.equal((await f.upload(Buffer.from('MZ123456789'))).status, 413);
  for (const [declared, status] of [['4', 413], ['9', 400]]) {
    assert.equal((await f.upload(Buffer.from('MZ1234'), 'test.exe', { headers: { 'Content-Type': 'application/octet-stream', 'X-GameHub-Client': '1', 'X-GameHub-Size': declared } })).status, status);
    assert.deepEqual(await fs.readdir(f.root), []);
  }
});

test('quota blocks additional uploads and leaves first file readable', async t => {
  const f = await fixture(t, { quotaBytes: 10 });
  const first = await (await f.upload(Buffer.from('MZ1234'))).json();
  assert.equal((await f.upload(Buffer.from('MZ5678'))).status, 507);
  const download = await f.call('download', {}, { id: first.file.id });
  assert.equal(await download.text(), 'MZ1234');
});

test('cancel and timeout clean temporary bytes, release slot and allow retry', async t => {
  const f = await fixture(t, { timeoutMs: 100 });
  for (const shouldAbort of [true, false]) {
    const controller = new AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const body = new ReadableStream({ start(c) { c.enqueue(Buffer.from('MZ12')); }, pull() { started(); } });
    const pending = f.upload(Buffer.from('MZ1234'), 'test.exe', { body, signal: controller.signal });
    await ready;
    assert.equal((await f.upload(Buffer.from('MZ1234'))).status, 409);
    const keepAlive = setTimeout(() => {}, 300);
    if (shouldAbort) controller.abort();
    assert.equal((await pending).status, 408);
    clearTimeout(keepAlive);
    assert.deepEqual(await fs.readdir(f.root), []);
  }
  assert.equal((await f.upload(Buffer.from('MZ1234'))).status, 201);
});

test('trusted save-cache RPC persists across service restart and rejects other account/origin',async t=>{
  const id=require('node:crypto').randomUUID,user=id();
  const credentialStore={available:true,get:async()=>({profile:{id:user}})};
  const f=await fixture(t,{credentialStore}),headers={'Content-Type':'application/json','X-GameHub-Save-Cache':'1'};
  const scope={origin:'https://mooyu.fun',owner:'user:'+user,workId:id(),channel:'production',namespace:'default',slot:'autosave'};
  const call=(operation,payload)=>f.call('save-cache',{method:'POST',headers,body:JSON.stringify({operation,payload})});
  assert.equal((await f.call('save-cache',{method:'POST',body:'{}'})).status,403);
  const written=await call('compareAndSwap',{scope,version:0,value:{format:1,proof:'durable'}});assert.equal(written.status,200,await written.text());
  await f.service.close();
  const restarted=await f.createTransferService({root:f.root,credentialStore});t.after(()=>restarted.close());
  const route=restarted.routes.find(r=>r.path==='/api/gamehub/save-cache');
  const request=payload=>route.fetch(new Request('http://dsh.internal/api/gamehub/save-cache',{method:'POST',headers,body:JSON.stringify({operation:'read',payload})}));
  assert.equal((await (await request({scope})).json()).data.value.proof,'durable');
  assert.equal((await (await request({scope:{...scope,owner:'user:'+id()}})).json()).code,'BRIDGE_ACCOUNT_CHANGED');
  assert.equal((await (await request({scope:{...scope,origin:'https://other.invalid'}})).json()).code,'BRIDGE_ACCOUNT_CHANGED');
  await restarted.close();
});
