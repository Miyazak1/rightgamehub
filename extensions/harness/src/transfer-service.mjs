import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prepareWebGame } from './prepare-web-game.mjs';
import { createGameRuntime } from './game-runtime.mjs';
import { WEB_POLICY, WEB_LIMITS, validateAssetPath, mimeFor } from './web-policy.mjs';
import { createNativeProbeAdapter } from './native-probe-adapter.mjs';
import { createOffscreenAdapter } from './offscreen-adapter.mjs';
import { OFFSCREEN_MANIFEST, OFFSCREEN_PACKAGE_POLICY, validateOffscreenManifest, approvedPackage } from './offscreen-package.mjs';
import { createDesktopLauncher } from './desktop-launcher.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
class TransferError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new TransferError(status, message); };
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const publicRecord = record => {
  if (!record.web) return record;
  const { assets, ...web } = record.web;
  return { ...record, web };
};

function validName(name) {
  return typeof name === 'string' && name.length <= 180 && name.trim() === name &&
    !/[\x00-\x1f\x7f/\\:<>"|?*]/.test(name) && !/[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) && /\.(zip|exe)$/i.test(name);
}

// Only the trusted plugin UI uses these routes. Harness authenticates the operator,
// Host, Origin and Fetch Metadata before dispatching its connection.fetch handlers.
export async function createTransferService({ root, maxBytes = 500 * 1024 * 1024, quotaBytes = 2 * 1024 ** 3, maxFiles = 50, timeoutMs = 30 * 60 * 1000, offscreenOptions, desktopOptions, credentialStore = null, platformOrigin = process.env.GAMEHUB_API_BASE_URL || 'https://mooyu.fun' }) {
  await mkdir(root, { recursive: true });
  const records = new Map();
  for (const filename of await readdir(root)) {
    if (!filename.endsWith('.json') || !UUID.test(filename.slice(0, -5))) continue;
    const record = JSON.parse(await readFile(path.join(root, filename), 'utf8'));
    if (record.id !== filename.slice(0, -5) || !validName(record.name) || !SHA256.test(record.sha256) ||
      !Number.isSafeInteger(record.size) || record.size < 4 || record.size > maxBytes ||
      (await stat(path.join(root, `${record.id}.bin`))).size !== record.size) {
      throw new Error('GameHub storage metadata is invalid. Preserve the storage folder and check the affected record.');
    }
    if (record.web?.state === 'ready') {
      try {
        if (record.web.policy !== WEB_POLICY || !record.web.assets?.['index.html']) throw new Error('policy');
        for (const [name, asset] of Object.entries(record.web.assets)) {
          validateAssetPath(name);
          if (asset.mime !== mimeFor(name) || !Number.isSafeInteger(asset.size) || asset.size < 0 || !SHA256.test(asset.sha256)) throw new Error('asset');
        }
        if (record.web.assets[OFFSCREEN_MANIFEST]) {
          if (record.web.offscreen?.policy !== OFFSCREEN_PACKAGE_POLICY) throw new Error('offscreen policy');
          validateOffscreenManifest(record.web.offscreen.manifest);
        } else if (record.web.offscreen) throw new Error('offscreen manifest missing');
      } catch { record.web = { state: 'rejected', reason: '网页资源记录需要重新检查，请重新上传 ZIP。' }; }
    }
    records.set(record.id, record);
  }
  let busy = false;
  const lifetime = new AbortController();
  const runtime = createGameRuntime({ root });
  const native = await createNativeProbeAdapter();
  const desktop = createDesktopLauncher({ ...desktopOptions, root: path.join(root, 'desktop-downloads') });
  const offscreen = await createOffscreenAdapter({ ...offscreenOptions, cacheRoot: path.join(root, 'offscreen-cache'),
    packageSource: async (id, request) => {
      const url = new URL(request.url); url.searchParams.set('id', id || '');
      const record = getRecord(url);
      return { record, download: () => download(new Request(url, { signal: request.signal }), url) };
    } });
  const catalogRecord = record => ({ ...publicRecord(record), ...(native.enabledFor(record) ? { nativeProbe: true } : {}),
    ...(desktop.enabled && record.kind === 'exe' ? { desktopLaunch: desktop.status(record) } : {}),
    ...(record.web?.offscreen ? { offscreenPackage: offscreen.packageStatus?.(record) ||
      { approved: !!approvedPackage(record.sha256), enabled: false, prepared: false } } : {}) });
  const usedBytes = () => [...records.values()].reduce((total, record) => total + record.size + (record.web?.state === 'ready' ? record.web.totalBytes : 0), 0);
  const platformBase = new URL(platformOrigin);
  if (!['https:', 'http:'].includes(platformBase.protocol) || platformBase.pathname !== '/' || platformBase.search || platformBase.hash) throw new Error('GAMEHUB_API_BASE_URL must be an HTTP origin.');
  const readPlatformExecutable = async request => {
    if (request.headers.get('x-gamehub-client') !== '1' || request.headers.get('x-gamehub-launch') !== 'independent-window-v1') fail(403, '请从 GameHub 作品页点击“下载并启动”。');
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096) fail(413, '启动请求过大。');
    let body;
    try { body = JSON.parse(text); } catch { fail(400, '启动请求格式无效。'); }
    if (!UUID.test(body?.workId || '') || !UUID.test(body?.releaseId || '') || !SHA256.test(body?.sha256 || '') ||
        !Number.isSafeInteger(body?.sizeBytes) || body.sizeBytes < 64 || body.sizeBytes > maxBytes ||
        typeof body?.fileName !== 'string' || !body.fileName.toLowerCase().endsWith('.exe') || !validName(body.fileName)) fail(400, 'Windows 版本信息无效。');
    const record = { id: body.releaseId, name: body.fileName, size: body.sizeBytes, sha256: body.sha256, kind: 'exe' };
    const downloadUrl = new URL(`/v1/works/${body.workId}/releases/${body.releaseId}/download`, platformBase);
    return { record, downloadUrl };
  };
  const getRecord = url => {
    const id = url.searchParams.get('id');
    if (!UUID.test(id || '') || !records.has(id)) fail(404, '文件不存在。');
    return records.get(id);
  };

  async function readBody(request, expectedSize, onChunk) {
    const reader = request.body?.getReader();
    if (!reader) fail(400, '没有收到文件内容。');
    const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(timeoutMs)]);
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    let size = 0;
    const hash = createHash('sha256');
    try {
      signal.throwIfAborted();
      while (true) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes || size > expectedSize) fail(413, '收到的文件超过大小限制或声明大小。');
        hash.update(value);
        await onChunk?.(value);
      }
      if (size !== expectedSize) fail(400, '文件传输不完整，请重新选择并上传。');
      return { size, sha256: hash.digest('hex') };
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      if (signal.aborted) fail(408, '传输已取消或超时，可重新尝试。');
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }

  async function transfer(request, url, verify) {
    if (request.headers.get('x-gamehub-client') !== '1') fail(403, '请从游戏大厅发起传输。');
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/octet-stream') fail(415, '请以文件二进制格式上传。');
    const sizeHeader = request.headers.get('x-gamehub-size') || '';
    const expectedSize = Number(sizeHeader);
    if (!/^\d+$/.test(sizeHeader) || !Number.isSafeInteger(expectedSize) || expectedSize < 4) fail(400, '文件大小无效。');
    if (expectedSize > maxBytes) fail(413, '单个文件最多 500 MiB。');
    const record = verify ? getRecord(url) : null;
    const name = url.searchParams.get('name');
    if (!verify && !validName(name)) fail(400, '请选择文件名有效的 ZIP 或 EXE 文件。');
    if (busy) fail(409, '已有文件正在传输，请稍后再试。');
    if (!verify && (records.size >= maxFiles || usedBytes() + expectedSize > quotaBytes)) fail(507, '本机试运行存储额度已满（最多 50 个文件、2 GiB）。');
    busy = true;
    let handle;
    let committed = false;
    const id = randomUUID();
    const partial = path.join(root, `${id}.part`);
    const blob = path.join(root, `${id}.bin`);
    const metaPartial = path.join(root, `${id}.json.part`);
    try {
      if (verify) {
        const actual = await readBody(request, expectedSize);
        return json({ ok: true, matches: actual.size === record.size && actual.sha256 === record.sha256, actual, expected: { size: record.size, sha256: record.sha256 } });
      }
      handle = await open(partial, 'wx');
      let signature = Buffer.alloc(0);
      const actual = await readBody(request, expectedSize, async chunk => {
        if (signature.length < 4) signature = Buffer.concat([signature, Buffer.from(chunk.subarray(0, 4 - signature.length))]);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
          if (bytesWritten === 0) throw new Error('File write made no progress');
          offset += bytesWritten;
        }
      });
      const isExe = name.toLowerCase().endsWith('.exe');
      const headerValid = isExe ? signature.subarray(0, 2).toString('ascii') === 'MZ' : ['504b0304', '504b0506', '504b0708'].includes(signature.toString('hex'));
      if (!headerValid) fail(415, '文件头与 ZIP/EXE 扩展名不符；文件未保存。');
      await handle.sync();
      await handle.close();
      handle = null;
      const saved = { id, name, ...actual, createdAt: new Date().toISOString(), kind: isExe ? 'exe' : 'zip', scanStatus: 'not_scanned', published: false };
      await rename(partial, blob);
      if (!isExe) {
        try {
          saved.web = await prepareWebGame({ root, id, archive: blob, totalLimit: Math.min(WEB_LIMITS.totalBytes, quotaBytes - usedBytes() - actual.size), signal: AbortSignal.any([request.signal, lifetime.signal]) });
          saved.web.title = saved.web.offscreen?.manifest.title || name.replace(/\.zip$/i, '').slice(0, 120);
        } catch (error) {
          if (request.signal.aborted || lifetime.signal.aborted) fail(408, '上传或网页包检查已取消，请重新尝试。');
          // A Windows ZIP or invalid web export remains a downloadable private file.
          saved.web = { state: 'rejected', reason: `无法网页运行：${error.message}`.slice(0, 400) };
        }
      }
      const meta = await open(metaPartial, 'wx');
      try { await meta.writeFile(JSON.stringify(saved)); await meta.sync(); } finally { await meta.close(); }
      await rename(metaPartial, path.join(root, `${id}.json`));
      records.set(id, saved);
      committed = true;
      return json({ ok: true, file: publicRecord(saved) }, 201);
    } finally {
      await handle?.close().catch(() => {});
      if (!committed && !verify) await Promise.all([partial, blob, metaPartial].map(file => unlink(file).catch(error => { if (error.code !== 'ENOENT') console.error('GameHub could not clean temporary file:', error.code); })));
      if (!committed && !verify) {
        const gameRoot = path.resolve(root, 'web');
        const gameDir = path.resolve(gameRoot, id);
        if (path.dirname(gameDir) !== gameRoot || !UUID.test(id)) throw new Error('Invalid cleanup path');
        await rm(gameDir, { recursive: true, force: true });
      }
      busy = false;
    }
  }

  async function download(request, url) {
    const record = getRecord(url);
    const headers = {
      'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="gamehub-${record.id}.${record.kind}"; filename*=UTF-8''${encodeURIComponent(record.name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())}`,
      'Accept-Ranges': 'bytes', ETag: `"${record.sha256}"`,
    };
    let start = 0;
    let end = record.size - 1;
    let status = 200;
    const range = request.headers.get('range');
    if (range && (!request.headers.has('if-range') || request.headers.get('if-range') === headers.ETag)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${record.size}` } });
      start = match[1] ? Number(match[1]) : Math.max(0, record.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= record.size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${record.size}` } });
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${record.size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path.join(root, `${record.id}.bin`), { start, end, signal: AbortSignal.any([request.signal, lifetime.signal]) }));
    return new Response(body, { status, headers });
  }

  const handlers = {
    '/api/gamehub/files': { methods: ['GET'], requestBody: 'buffered', run: () => json({ ok: true, files: [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(catalogRecord), maxBytes, quotaBytes, usedBytes: usedBytes() }) },
    '/api/gamehub/credentials': { methods: ['GET', 'PUT', 'DELETE'], requestBody: 'buffered', run: async request => {
      if (request.headers.get('x-gamehub-credentials') !== '1') fail(403, '请从 GameHub 账号面板管理登录凭据。');
      if (!credentialStore?.available) return json({ ok: true, tokens: null, persistence: credentialStore?.persistence ?? { kind: 'memory', description: '系统凭据库不可用，凭据仅保留到 Harness 本次运行结束。' } });
      try {
        if (request.method === 'GET') return json({ ok: true, tokens: await credentialStore.get(), persistence: credentialStore.persistence });
        if (request.method === 'DELETE') { await credentialStore.clear(); return json({ ok: true, tokens: null, persistence: credentialStore.persistence }); }
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') fail(415, '凭据请求必须使用 JSON。');
        const text = await request.text();
        if (Buffer.byteLength(text) > 12288) fail(413, '凭据请求过大。');
        let body;
        try { body = JSON.parse(text); } catch { fail(400, '凭据请求格式无效。'); }
        await credentialStore.set(body?.tokens);
        return json({ ok: true, tokens: null, persistence: credentialStore.persistence });
      } catch (error) {
        if (error instanceof TransferError) throw error;
        throw Object.assign(error, { status: 503, publicMessage: '系统凭据库暂时不可用；本次登录仍保留在当前 Harness 会话。' });
      }
    } },
    '/api/gamehub/upload': { methods: ['POST'], requestBody: 'streaming', run: (request, url) => transfer(request, url, false) },
    '/api/gamehub/verify': { methods: ['POST'], requestBody: 'streaming', run: (request, url) => transfer(request, url, true) },
    '/api/gamehub/download': { methods: ['GET', 'HEAD'], requestBody: 'buffered', run: download },
    '/api/gamehub/platform-desktop-launch': { methods: ['POST'], requestBody: 'buffered', run: async request => {
      const { record, downloadUrl } = await readPlatformExecutable(request);
      await desktop.prepare(record, () => fetch(downloadUrl, { signal: request.signal, cache: 'no-store' }), request.signal);
      return json({ ok: true, ...await desktop.launch(record, randomUUID(), request.signal) });
    } },
    '/api/gamehub/desktop-prepare': { methods: ['POST'], requestBody: 'buffered', run: async (request, url) => {
      if (request.headers.get('x-gamehub-client') !== '1') fail(403, '请从游戏大厅下载文件。');
      if (request.body || [...url.searchParams.keys()].some(key => key !== 'id')) fail(400, '只接受已上传文件的 ID。');
      const record = getRecord(url);
      return json({ ok: true, ...await desktop.prepare(record, () => download(new Request(url, { signal: request.signal }), url), request.signal) });
    } },
    '/api/gamehub/desktop-launch': { methods: ['POST'], requestBody: 'buffered', run: async (request, url) => {
      if (request.headers.get('x-gamehub-client') !== '1' || request.headers.get('x-gamehub-launch') !== 'independent-window-v1') fail(403, '请点击游戏卡片的“启动（独立窗口）”。');
      if (request.body || [...url.searchParams.keys()].some(key => key !== 'id')) fail(400, '启动接口不接受路径、参数或命令。');
      return json({ ok: true, ...await desktop.launch(getRecord(url), request.headers.get('x-gamehub-request-id'), request.signal) });
    } },
    '/api/gamehub/launch': { methods: ['POST'], requestBody: 'buffered', run: async (request, url) => {
      if (request.headers.get('x-gamehub-client') !== '1') fail(403, '请从游戏大厅开始游戏。');
      const record = getRecord(url);
      if (record.web?.state !== 'ready') fail(409, '该文件不是已检查的网页游戏。');
      if (record.web.offscreen) fail(409, '此包需要离屏运行组件，请先下载到运行缓存。');
      return json({ ok: true, ...await runtime.launch(record) });
    } },
    '/api/gamehub/native-launch': { methods: ['POST'], requestBody: 'buffered', run: async (request, url) => {
      if (request.headers.get('x-gamehub-client') !== '1') fail(403, '请从游戏大厅开始实验。');
      const record = getRecord(url);
      if (!native.enabledFor(record)) fail(409, '此 EXE 未启用原生实验。当前只允许已核对的桌猫下载副本。');
      return json({ ok: true, ...await native.launch(record) });
    } },
    '/api/gamehub/stop': { methods: ['POST'], requestBody: 'buffered', run: async (request, url) => {
      if (request.headers.get('x-gamehub-client') !== '1') fail(403, '请从游戏大厅结束游戏。');
      await native.stop?.(url.searchParams.get('launchId'));
      await offscreen.stop(url.searchParams.get('launchId'));
      runtime.stop(url.searchParams.get('launchId')); return json({ ok: true });
    } },
  };
  for(const action of ['player','frame','input','stop']) handlers[`/api/gamehub/native-${action}`] = {
    methods: action==='input'||action==='stop'?['POST']:['GET'], requestBody:action==='input'?'streaming':'buffered',
    run: request => native.forward ? native.forward(request,action) : new Response('Native probe disabled',{status:404}),
  };
  for (const action of ['status', 'prepare', 'launch', 'player', 'frame', 'input', 'stop']) handlers[`/api/gamehub/offscreen-${action}`] = {
    methods: ['prepare', 'launch', 'input', 'stop'].includes(action) ? ['POST'] : ['GET'],
    requestBody: action === 'input' ? 'streaming' : 'buffered', run: request => offscreen.forward(request, action),
  };
  const routes = Object.entries(handlers).map(([routePath, handler]) => ({
    path: routePath, methods: handler.methods, requestBody: handler.requestBody,
    fetch: async request => {
      try {
        if (!handler.methods.includes(request.method)) fail(405, '请求方法不支持。');
        lifetime.signal.throwIfAborted();
        return await handler.run(request, new URL(request.url));
      } catch (error) {
        if (!(error instanceof TransferError)) console.error('GameHub transfer failed:', error.code || error.name);
        return json({ ok: false, error: error instanceof TransferError ? error.message : error.publicMessage || '本机文件服务暂时不可用，请检查磁盘空间或重启 Harness。' }, error.status || 500);
      }
    },
  }));
  return { routes, close: () => { lifetime.abort(); return Promise.all([runtime.close(), native.close(), offscreen.close(), desktop.close()]); } };
}
