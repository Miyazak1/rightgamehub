const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm, access } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('native restart waits for previous process cleanup and revoked sessions cannot forward input', { skip:process.platform!=='win32' }, async () => {
  const { createNativeProbeAdapter } = await import('../extensions/harness/src/native-probe-adapter.mjs');
  const sha='4967f9e183a311193f8b2f0fd33f5a40b8b2a1ff7a575c2d412b2e4640c69912';
  let starts=0, completeStop;
  const stopping=new Promise(resolve=>{completeStop=resolve;});
  const adapter=await createNativeProbeAdapter({project:process.cwd(),loadModule:async()=>({DESKCAT_SHA:sha,startNativeProbe:async()=>{
    starts++; const count=starts;
    return {url:'http://127.0.0.2:1/play/test/',stop:()=>count===1?stopping:Promise.resolve()};
  }})});
  await assert.rejects(adapter.launch({kind:'exe',sha256:'0'.repeat(64)}),/allowlist/);
  const record={kind:'exe',sha256:sha};
  const first=await adapter.launch(record);
  assert.equal(first.url,undefined,'Native transport capability must stay on the host');
  const stop=adapter.stop(first.launchId);
  const restart=adapter.launch(record);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(starts,1,'New EXE must not race with the previous portable launcher');
  const response=await adapter.forward(new Request('http://dsh.internal/api/gamehub/native-input?launchId='+encodeURIComponent(first.launchId),{method:'POST'}),'input');
  assert.equal(response.status,410);
  completeStop(); await stop;
  const second=await restart;
  assert.notEqual(second.launchId,first.launchId);
  assert.equal(starts,2);
  const denied=await adapter.forward(new Request('http://dsh.internal/api/gamehub/native-input?launchId='+encodeURIComponent(second.launchId),{method:'POST'}),'input');
  assert.equal(denied.status,403);
  await adapter.close();
});

test('native EXE launch is disabled unless explicitly enabled and never follows an uploaded path', async () => {
  const { createNativeProbeAdapter } = await import('../extensions/harness/src/native-probe-adapter.mjs');
  const disabled = await createNativeProbeAdapter({ project: '' });
  assert.equal(disabled.enabledFor({kind:'exe', sha256:'4967f9e183a311193f8b2f0fd33f5a40b8b2a1ff7a575c2d412b2e4640c69912'}), false);
  assert.equal(disabled.launch, undefined);
  await disabled.close();
});

test('native probe rejects a modified EXE before spawning any process', { skip: process.platform !== 'win32' }, async () => {
  const { startNativeProbe } = await import('../poc/native/native-probe.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'gamehub-native-invalid-'));
  try {
    const file = path.join(root, 'sample.exe'); await writeFile(file, 'MZ-untrusted-test');
    await assert.rejects(startNativeProbe({ downloadedFile:file, outputDir:path.join(root,'out') }), /Only the authorized/);
    await assert.rejects(access(path.join(root, 'out')));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('unstarted local player requires session capability, correct Origin and explicit input marker', { skip: process.platform !== 'win32' }, async t => {
  const file = path.resolve('.runtime/m0/download-check-1790224988286.exe');
  try { await access(file); } catch { t.skip('Authorized local Deskcat download is not present'); return; }
  const { startNativeProbe } = await import('../poc/native/native-probe.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'gamehub-native-http-'));
  const probe = await startNativeProbe({ downloadedFile:file, outputDir:root, launch:false });
  try {
    const base = probe.url.replace(/\/$/, '');
    assert.equal((await fetch(new URL('/play/not-a-capability/frame', base))).status,404);
    assert.equal((await fetch(base+'/frame',{headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await fetch(base+'/input',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(base+'/input',{method:'POST',headers:{'X-GameHub-Input':'1'},body:JSON.stringify({type:'exec',path:'cmd.exe'})})).status,400);
    assert.equal((await fetch(base+'/frame',{headers:{Origin:'null'}})).status,202);
    const html = await fetch(probe.url);
    assert.match(html.headers.get('content-security-policy'),/sandbox allow-scripts/);
    assert.equal(html.headers.get('set-cookie'),null);
    assert.equal(probe.getState().events.length,0, 'HTTP checks must not start an EXE');
  } finally { await probe.stop(); await rm(root,{recursive:true,force:true}); }
  await assert.rejects(fetch(probe.url));
});
