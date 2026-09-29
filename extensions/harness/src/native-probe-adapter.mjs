import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Opt-in engineering experiment. Never enables arbitrary uploaded executables.
export async function createNativeProbeAdapter({ project = process.env.GAMEHUB_NATIVE_PROBE_PROJECT, loadModule = url => import(url) } = {}) {
  if (!project || process.platform !== 'win32') return { enabledFor: () => false, close: async () => {} };
  if (!path.isAbsolute(project)) throw new Error('Native probe project must be an absolute local path');
  const { startNativeProbe, DESKCAT_SHA } = await loadModule(pathToFileURL(path.join(project, 'poc/native/native-probe.mjs')).href);
  let active, pending, closing = Promise.resolve();
  const enabledFor = record => record.kind === 'exe' && record.sha256 === DESKCAT_SHA;
  return {
    enabledFor,
    async launch(record) {
      if (!enabledFor(record)) throw new Error('This EXE is outside the native experiment allowlist');
      if (pending) throw new Error('Native experiment is starting');
      pending = (async () => {
        await closing;
        await active?.probe.stop(); active = null;
        const launchId = `native:${randomUUID()}`;
        const probe = await startNativeProbe({
          downloadedFile: path.join(project, '.runtime/m0/download-check-1790224988286.exe'),
          outputDir: path.join(project, '.runtime/native-probe', launchId.slice(7)),
        });
        active = { launchId, probe };
        return { launchId };
      })();
      try { return await pending; } finally { pending = null; }
    },
    async stop(id) { if (active?.launchId === id) { const session = active; active = null; closing=Promise.all([closing,session.probe.stop()]); await closing; } },
    async forward(request, action) {
      const id = new URL(request.url).searchParams.get('launchId');
      if (!active || active.launchId !== id) return new Response('Native session expired', {status:410});
      if (request.method === 'POST' && request.headers.get('x-gamehub-input') !== '1') return new Response('Action denied', {status:403});
      if (action === 'stop') { const session=active; active=null; closing=Promise.all([closing,session.probe.stop()]); await closing; return new Response('Stopped'); }
      const base=active.probe.url.replace(/\/$/,'');
      let body;
      if(request.method==='POST') {
        const chunks=[]; let size=0;
        for await(const chunk of request.body || []) { size+=chunk.length; if(size>2048) return new Response('Input too large',{status:413}); chunks.push(Buffer.from(chunk)); }
        body=Buffer.concat(chunks);
      }
      const upstream=await fetch(action==='player'?base:base+'/'+action, {
        method:request.method,
        headers:request.method==='POST'?{'Content-Type':'application/json','X-GameHub-Input':'1'}:undefined,
        body,
        signal:AbortSignal.timeout(5000),
      });
      const headers=new Headers(upstream.headers); headers.delete('content-length');
      headers.delete('access-control-allow-origin'); headers.delete('access-control-expose-headers');
      if(action==='player' && upstream.ok) {
        // This page is trusted plugin code, never an uploaded game's HTML/JS.
        // EXE output is JPEG bytes; the native capability stays on the host.
        const routes=Object.fromEntries(['frame','input','stop'].map(name=>[name,`native-${name}?launchId=${encodeURIComponent(id)}`]));
        const html=(await upstream.text()).replace('const routes = null;',`const routes = ${JSON.stringify(routes)};`);
        headers.set('content-security-policy',(headers.get('content-security-policy')||'').replace(/connect-src [^;]+/,"connect-src 'self'").replace('sandbox allow-scripts','sandbox allow-scripts allow-same-origin'));
        return new Response(html,{status:200,headers});
      }
      return new Response(await upstream.arrayBuffer(),{status:upstream.status,headers});
    },
    async close() { await pending?.catch(() => {}); await closing; await active?.probe.stop(); active = null; },
  };
}
