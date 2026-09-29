import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { installOffscreenPackage, verifyInstalledPackage } from './offscreen-install.mjs';
import { approvedPackage, assertApprovedAssets } from './offscreen-package.mjs';

const error = (message, status = 409) => Object.assign(new Error(message), { status });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function createOffscreenAdapter({ project = process.env.GAMEHUB_OFFSCREEN_PROJECT,
  loadModule = url => import(url), checkRuntime = access, idleMs = 20000, tickMs = 1000,
  now = Date.now, packageSource, cacheRoot } = {}) {
  const disabled = reason => ({ enabled: false, status: () => ({ enabled: false, reason }),
    stop: async () => {}, close: async () => {}, forward: async (_request, action) => action === 'status'
      ? json({ ok: true, enabled: false, reason }) : json({ ok: false, error: reason }, 404) });
  if (!project || process.platform !== 'win32') return disabled('离屏样本未启用。');
  if (!path.isAbsolute(project)) return disabled('离屏运行组件配置无效。');
  const runtimeFile = path.join(project, '.runtime/electron-v44.4.5-win32-x64/electron.exe');
  let component, player;
  try {
    await checkRuntime(runtimeFile);
    component = await loadModule(pathToFileURL(path.join(project, 'poc/offscreen/runner.mjs')).href);
    player = await readFile(new URL('./offscreen-player.html', import.meta.url), 'utf8');
  } catch { return disabled('离屏运行组件尚未准备好。'); }
  let active, pending, disposed = false, closing = Promise.resolve();
  const installed = new Map();
  const lifetime = new AbortController();
  async function source(request) {
    if (!packageSource || !cacheRoot) throw error('当前配置未开放适配包。');
    const result = await packageSource(new URL(request.url).searchParams.get('id'), request);
    assertApprovedAssets(result.record.sha256, result.record.web);
    return result;
  }
  async function prepare(request) {
    if (disposed) throw error('离屏服务已结束。', 410);
    if (pending || active) throw error('请先结束正在运行或准备的样本。');
    pending = (async () => {
      const { record, download } = await source(request);
      installed.delete(record.sha256);
      const result = await installOffscreenPackage({ root: cacheRoot, record, download,
        signal: AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(120000)]) });
      if (disposed || request.signal.aborted) throw error('准备已取消。', 410);
      installed.set(record.sha256, result.directory);
      return { prepared: true, sha256: result.sha256, reused: result.reused };
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function stop(id) {
    if (!active || active.id !== id) return;
    const old = active; active = null;
    closing = closing.then(() => old.runner.stop());
    await closing;
  }
  const timer = setInterval(() => {
    if (active && now() - active.touched > idleMs) void stop(active.id).catch(() => {});
  }, tickMs); timer.unref();
  async function launch(request) {
    if (disposed) throw error('离屏服务已结束。', 410);
    if (pending) throw error('离屏样本正在启动，请稍候。');
    pending = (async () => {
      await stop(active?.id); await closing;
      if (disposed || request.signal.aborted) throw error('启动已取消。', 410);
      let packageDirectory;
      if (new URL(request.url).searchParams.has('id') && new URL(request.url).searchParams.get('id') !== 'owned-offscreen-sample') {
        const { record } = await source(request);
        packageDirectory = installed.get(record.sha256);
        if (!packageDirectory) throw error('请先将适配包下载到运行缓存。');
        try { await verifyInstalledPackage(packageDirectory, record.sha256, request.signal); }
        catch (cause) { installed.delete(record.sha256); throw cause; }
      }
      if (disposed || request.signal.aborted) throw error('启动已取消。', 410);
      const id = `offscreen:${randomUUID()}`;
      const runner = await component.startOffscreenSample({ runtimeFile,
        outputDir: path.join(project, '.runtime/offscreen-sidebar', id.slice(10)), ...(packageDirectory ? { packageDirectory } : {}) });
      if (disposed || request.signal.aborted) { await runner.stop(); throw error('启动已取消。', 410); }
      active = { id, runner, touched: now() };
      return { launchId: id };
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function forward(request, action) {
    try {
      const method = ['prepare', 'launch', 'input', 'stop'].includes(action) ? 'POST' : 'GET';
      if (request.method !== method) throw error('请求方法不支持。', 405);
      if (action === 'status') return json({ ok: true, enabled: !disposed, sampleOnly: true, ownedPackages: !!packageSource, audio: false });
      if (request.method === 'POST' && request.headers.get('x-gamehub-input') !== '1') return json({ ok: false, error: '请从游戏大厅操作。' }, 403);
      if (action === 'prepare') return json({ ok: true, ...await prepare(request) });
      if (action === 'launch') return json({ ok: true, ...await launch(request) });
      const id = new URL(request.url).searchParams.get('launchId');
      if (!active || active.id !== id || disposed) throw error('此离屏会话已结束。', 410);
      const session = active;
      session.touched = now();
      if (action === 'stop') { await stop(id); return json({ ok: true }); }
      if (action === 'player') {
        const nonce = randomBytes(18).toString('base64');
        const routes = Object.fromEntries(['frame', 'input', 'stop'].map(name => [name, `offscreen-${name}?launchId=${encodeURIComponent(id)}`]));
        return new Response(player.replaceAll('__NONCE__', nonce).replace('__ROUTES__', JSON.stringify(routes)), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-same-origin` },
        });
      }
      if (action === 'frame') {
        const frame = session.runner.getFrame();
        const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'X-Frame': String(frame.id), 'X-Frame-Age': String(Math.max(0, now() - frame.receivedAt)) };
        if (String(frame.id) === new URL(request.url).searchParams.get('after')) return new Response(null, { status: 204, headers });
        return new Response(frame.jpeg, { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
      }
      if (action === 'input') {
        let size = 0; const chunks = [];
        for await (const chunk of request.body || []) {
          size += chunk.length;
          if (size > 2048) throw error('操作消息过大。', 413);
          chunks.push(Buffer.from(chunk));
        }
        let command;
        try { command = component.normalizePlayerInput(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { throw error('游戏操作无效。', 400); }
        // A slow request from an old player cannot reach its replacement session.
        if (active !== session) throw error('此离屏会话已结束。', 410);
        try { return json({ ok: true, state: await session.runner.input(command) }); }
        catch (cause) { await stop(id); throw cause; }
      }
      throw error('接口不存在。', 404);
    } catch (cause) { return json({ ok: false, error: cause.message || '离屏运行失败。' }, cause.status || 503); }
  }
  return { enabled: true, status: () => ({ enabled: !disposed }), forward, stop,
    packageStatus: record => ({ approved: !!approvedPackage(record.sha256), enabled: !disposed && !!packageSource,
      prepared: installed.has(record.sha256) }),
    async close() { disposed = true; lifetime.abort(); clearInterval(timer); await pending?.catch(() => {}); await stop(active?.id); await closing; } };
}
