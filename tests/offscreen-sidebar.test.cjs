const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const post = { method: 'POST', headers: { 'X-GameHub-Input': '1', 'Content-Type': 'application/json' } };
async function setup(t, overrides = {}) {
  const { createOffscreenAdapter } = await import('../extensions/harness/src/offscreen-adapter.mjs');
  const { normalizePlayerInput } = await import('../poc/offscreen/runner.mjs');
  const starts = [], inputs = [], stops = [];
  const component = {
    normalizePlayerInput,
    async startOffscreenSample(options) {
      starts.push(options); const index = starts.length;
      return {
        getFrame: () => ({ id: 8, width: 640, height: 360, receivedAt: 1000, jpeg: Buffer.from([255,216,255,217]) }),
        input: async value => { inputs.push(value); return { score: 1, x: 163, y: 180, label: '样本' }; },
        stop: async () => { stops.push(index); },
      };
    },
  };
  const adapter = await createOffscreenAdapter({ project: process.cwd(), checkRuntime: async () => {},
    loadModule: async () => component, now: () => 1020, ...overrides });
  t.after(() => adapter.close());
  const call = (action, options = {}, id, query = {}) => {
    const url = new URL('http://dsh.internal/api/gamehub/offscreen-' + action);
    if (id) url.searchParams.set('launchId', id);
    for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value);
    return adapter.forward(new Request(url, options), action);
  };
  const launch = async () => (await (await call('launch', post)).json()).launchId;
  return { adapter, call, launch, starts, inputs, stops, component };
}

test('offscreen sidebar is disabled by default and missing runtime keeps regular features available', async () => {
  const { createOffscreenAdapter } = await import('../extensions/harness/src/offscreen-adapter.mjs');
  const disabled = await createOffscreenAdapter({ project: '' });
  const request = new Request('http://dsh.internal/api/gamehub/offscreen-status');
  assert.equal((await (await disabled.forward(request, 'status')).json()).enabled, false);
  assert.equal((await disabled.forward(new Request(request, post), 'launch')).status, 404);
  const missing = await createOffscreenAdapter({ project: process.cwd(), checkRuntime: async () => { throw new Error('missing'); } });
  assert.equal(missing.enabled, false); await missing.close();
});

test('offscreen launch is explicit and only returns a lease for the fixed owned sample', { skip: process.platform !== 'win32' }, async t => {
  const f = await setup(t);
  assert.equal((await f.call('launch')).status, 405);
  assert.equal((await f.call('launch', { method: 'POST' })).status, 403);
  assert.equal(f.starts.length, 0);
  const response = await f.call('launch', { ...post, body: '{"exe":"C:/outside.exe"}' });
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['launchId', 'ok']);
  assert.match(result.launchId, /^offscreen:/);
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].runtimeFile, path.join(process.cwd(), '.runtime/electron-v44.4.5-win32-x64/electron.exe'));
  assert.ok(f.starts[0].outputDir.startsWith(path.join(process.cwd(), '.runtime/offscreen-sidebar') + path.sep));
});

test('trusted offscreen player stays on authenticated host routes and never exposes pipe credentials', { skip: process.platform !== 'win32' }, async t => {
  const f = await setup(t), id = await f.launch();
  const player = await f.call('player', {}, id), html = await player.text();
  assert.equal(player.status, 200);
  assert.match(player.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(player.headers.get('content-security-policy'), /sandbox allow-scripts allow-same-origin/);
  assert.doesNotMatch(html, /__NONCE__|__ROUTES__|GAMEHUB_OFFSCREEN_TOKEN|\.runtime/);
  assert.match(html, /offscreen-input\?launchId=offscreen%3A/);
  const frame = await f.call('frame', {}, id);
  assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  assert.equal(frame.headers.get('x-frame-age'), '20');
  assert.equal((await f.call('frame', {}, id, { after: '8' })).status, 204);
});

test('offscreen input validates marker, size and game-only schema before forwarding', { skip: process.platform !== 'win32' }, async t => {
  const f = await setup(t), id = await f.launch();
  assert.equal((await f.call('input', { method: 'POST', body: '{}' }, id)).status, 403);
  for (const value of [ { type:'exec',path:'cmd.exe' }, { type:'key',key:'Alt+Tab',down:true }, { type:'reset',seq:1 },
    { type:'click',x:-1,y:1 }, { type:'text',value:'a'.repeat(41) } ]) {
    assert.equal((await f.call('input', { ...post, body: JSON.stringify(value) }, id)).status, 400);
  }
  assert.equal((await f.call('input', { ...post, body: 'x'.repeat(2049) }, id)).status, 413);
  assert.equal(f.inputs.length, 0);
  const good = await f.call('input', { ...post, body: '{"type":"click","x":320,"y":180}' }, id);
  assert.equal((await good.json()).state.score, 1);
  assert.deepEqual(f.inputs, [{ type:'click', x:320, y:180 }]);
});

test('replaced offscreen leases cannot send input or stop their successor', { skip: process.platform !== 'win32' }, async t => {
  const f = await setup(t), first = await f.launch(), second = await f.launch();
  assert.notEqual(first, second); assert.deepEqual(f.stops, [1]);
  assert.equal((await f.call('input', { ...post, body: '{"type":"reset"}' }, first)).status, 410);
  await f.adapter.stop(first);
  assert.deepEqual(f.stops, [1]);
  assert.equal((await f.call('frame', {}, second)).status, 200);
  await f.call('stop', post, second);
  assert.deepEqual(f.stops, [1,2]);
  assert.equal((await f.call('frame', {}, second)).status, 410);
});

test('restart waits for old process cleanup and service close cancels a pending startup', { skip: process.platform !== 'win32' }, async t => {
  const f = await setup(t); let releaseStop, finishStart, starts = 0, cleaned = 0;
  f.component.startOffscreenSample = async () => {
    starts++;
    if (starts === 1) return { stop: () => new Promise(resolve => { releaseStop = resolve; }) };
    return new Promise(resolve => { finishStart = () => resolve({ stop: async () => { cleaned++; } }); });
  };
  const first = await f.launch();
  const stopping = f.adapter.stop(first), restart = f.call('launch', post);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1);
  assert.equal((await f.call('launch', post)).status, 409);
  releaseStop(); await stopping;
  await new Promise(resolve => setImmediate(resolve)); assert.equal(starts, 2);
  const close = f.adapter.close(); finishStart(); await close;
  assert.equal((await restart).status, 410); assert.equal(cleaned, 1);
  assert.equal((await f.call('launch', post)).status, 410);
});

test('aborted startup and unattended sidebar sessions are reclaimed', { skip: process.platform !== 'win32' }, async t => {
  let clock = 0;
  const f = await setup(t, { now: () => clock, idleMs: 100, tickMs: 5 });
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.call('launch', { ...post, signal: controller.signal })).status, 410);
  assert.equal(f.starts.length, 0);
  const id = await f.launch(); clock = 200;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(f.stops, [1]);
  assert.equal((await f.call('frame', {}, id)).status, 410);
});

test('failed game input revokes and stops its session instead of leaving held controls active', { skip: process.platform !== 'win32' }, async t => {
  const f = await setup(t); let stopped = false;
  f.component.startOffscreenSample = async () => ({ input: async () => { throw new Error('IPC lost'); }, stop: async () => { stopped = true; } });
  const id = await f.launch();
  assert.equal((await f.call('input', { ...post, body: '{"type":"release"}' }, id)).status, 503);
  assert.equal(stopped, true);
  assert.equal((await f.call('frame', {}, id)).status, 410);
});

test('Harness offscreen routes keep method guards and generic stop closes the matching lease', { skip: process.platform !== 'win32' }, async t => {
  const base = path.resolve('.runtime/offscreen-route-tests'); await fs.mkdir(base, { recursive:true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  const f = await setup(t);
  const { createTransferService } = await import('../extensions/harness/src/transfer-service.mjs');
  const service = await createTransferService({ root, offscreenOptions: { project:process.cwd(), checkRuntime:async()=>{}, loadModule:async()=>f.component } });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root),base); await fs.rm(root,{recursive:true,force:true}); });
  const call = (action, options = {}, id) => service.routes.find(r => r.path === '/api/gamehub/'+action)
    .fetch(new Request('http://dsh.internal/api/gamehub/'+action+(id?'?launchId='+encodeURIComponent(id):''),options));
  assert.equal((await call('offscreen-launch')).status,405);
  const id = (await (await call('offscreen-launch',post)).json()).launchId;
  assert.equal((await call('stop',{method:'POST'},id)).status,403);
  assert.equal((await call('stop',{method:'POST',headers:{'X-GameHub-Client':'1'}},id)).status,200);
  assert.deepEqual(f.stops,[1]);
  assert.equal((await call('offscreen-frame',{},id)).status,410);
});

test('sidebar runtime refuses a modified executable before creating a profile or starting a process', async t => {
  const base = path.resolve('.runtime/offscreen-route-tests'); await fs.mkdir(base,{recursive:true});
  const root = await fs.mkdtemp(path.join(base,'digest-'));
  t.after(async()=>{assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const runtimeFile = path.join(root,'electron.exe'); await fs.writeFile(runtimeFile,'MZnot-the-runtime');
  const { startOffscreenSample } = await import('../poc/offscreen/runner.mjs');
  await assert.rejects(startOffscreenSample({runtimeFile,outputDir:path.join(root,'output')}),/digest|Windows/);
  await assert.rejects(fs.access(path.join(root,'output')));
});

test('player sends keys only from its game surface, releases on blur and stops on page exit', async () => {
  const source = await fs.readFile('extensions/harness/src/offscreen-player.html','utf8');
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1].replace('__ROUTES__',JSON.stringify({frame:'frame',input:'input',stop:'stop'}));
  function element() { return { listeners:{}, addEventListener(name,fn){this.listeners[name]=fn;}, focus(){},
    getBoundingClientRect(){return {left:0,top:0,width:320,height:180};},getContext(){return {drawImage(){},clearRect(){}};} }; }
  const elements = Object.fromEntries(['surface','status','name','rename','release','reset','stop'].map(id=>[id,element()]));
  const window = element(), document = { ...element(), getElementById:id=>elements[id], querySelectorAll:()=>Object.values(elements), visibilityState:'visible' };
  const sent = [];
  vm.runInNewContext(script,{document,window,location:{href:'http://host/player'},URL,performance,AbortController,AbortSignal,
    setTimeout:()=>0,clearTimeout(){},createImageBitmap:async()=>({close(){}}),
    fetch:async(url,options={})=>{ if(url.endsWith('/input'))sent.push(JSON.parse(options.body));else if(url.endsWith('/stop'))sent.push({type:'stop'});
      return new Response(url.endsWith('/frame')?Buffer.from('image'):JSON.stringify({ok:true}),{headers:{'X-Frame':'1','X-Frame-Age':'0'}}); }});
  assert.equal(window.listeners.keydown,undefined);
  const key = {key:'ArrowRight',preventDefault(){}};
  elements.surface.listeners.keydown(key);elements.surface.listeners.keydown(key);
  elements.surface.listeners.blur();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(sent,[{type:'key',key:'ArrowRight',down:true},{type:'release'}]);
  window.listeners.pagehide();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.at(-1).type,'stop');
  elements.surface.listeners.keydown(key);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.at(-1).type,'stop');
});
