import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, unlink } from 'node:fs/promises';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (message, status = 409) => Object.assign(new Error(message), { status, publicMessage: message });
const checkRecord = record => {
  if (record?.kind !== 'exe' || !UUID.test(record.id) || !/^[a-f0-9]{64}$/.test(record.sha256) ||
      !Number.isSafeInteger(record.size) || record.size < 64 || record.size > 500 * 1024 ** 2) throw fail('请选择有效的单文件 Windows EXE；ZIP 暂不支持此启动方式。');
};
async function ordinary(file, directory = false) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw fail('本机下载目录包含链接或特殊文件。');
  return info;
}

// Basic PE image validation, not malware scanning or an execution sandbox.
export async function inspectExecutable(file) {
  const info = await ordinary(file);
  const handle = await open(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    if ((await handle.read(dos, 0, dos.length, 0)).bytesRead !== 64 || dos.toString('ascii', 0, 2) !== 'MZ') throw fail('文件不是可识别的 Windows EXE。');
    const offset = dos.readUInt32LE(60);
    if (offset < 64 || offset > 1024 * 1024 || offset + 96 > info.size) throw fail('EXE 的 PE 文件头无效。');
    const pe = Buffer.alloc(96);
    if ((await handle.read(pe, 0, pe.length, offset)).bytesRead !== 96 || pe.readUInt32LE(0) !== 0x4550) throw fail('EXE 的 PE 签名无效。');
    const machine = pe.readUInt16LE(4), characteristics = pe.readUInt16LE(22), optionalSize = pe.readUInt16LE(20);
    const magic = pe.readUInt16LE(24), subsystem = pe.readUInt16LE(92);
    if (![0x14c, 0x8664, 0xaa64].includes(machine) || !(characteristics & 2) || characteristics & 0x2000 ||
        ![0x10b, 0x20b].includes(magic) || optionalSize < (magic === 0x10b ? 96 : 112) || offset + 24 + optionalSize > info.size ||
        subsystem !== 2) throw fail('当前入口仅支持 Windows 图形界面 EXE，不支持 DLL、驱动或控制台程序。');
    return { architecture: { [0x14c]: 'x86', [0x8664]: 'x64', [0xaa64]: 'arm64' }[machine], subsystem: subsystem === 2 ? 'windows' : 'console' };
  } finally { await handle.close(); }
}

// Native games do not inherit Harness/model credentials, NODE_OPTIONS or tools.
export function desktopEnvironment(source = process.env) {
  const allowed = new Set(['systemroot', 'windir', 'temp', 'tmp', 'userprofile', 'appdata', 'localappdata',
    'programdata', 'homedrive', 'homepath', 'public', 'programfiles', 'programfiles(x86)', 'commonprogramfiles', 'commonprogramfiles(x86)']);
  const env = {};
  for (const [key, value] of Object.entries(source)) if (allowed.has(key.toLowerCase()) && typeof value === 'string') env[key.toUpperCase()] = value;
  const windows = env.SYSTEMROOT || env.WINDIR || 'C:\\Windows';
  env.PATH = [path.win32.join(windows, 'System32'), windows].join(';');
  return env;
}

export function createDesktopLauncher({ root, enabled = process.env.GAMEHUB_DESKTOP_LAUNCH === '1',
  platform = process.platform, spawnProcess = spawn, environment = process.env,
  quotaBytes = 2 * 1024 ** 3, maxFiles = 50, timeoutMs = 30 * 60 * 1000 } = {}) {
  enabled = enabled && platform === 'win32';
  const parent = path.resolve(root);
  const prepared = new Map(), running = new Map(), attempts = new Map(), downloads = new Map();
  const lifetime = new AbortController();
  let pending, disposed = false;
  const cache = record => {
    checkRecord(record);
    const directory = path.resolve(parent, record.id);
    if (path.dirname(directory) !== parent) throw fail('下载路径无效。');
    return { directory, executable: path.join(directory, 'game.exe') };
  };
  function assertEnabled() { if (!enabled || disposed) throw fail('本机 EXE 启动未启用，请使用独立窗口测试启动文件。', 404); }
  async function verify(record, signal) {
    const { directory, executable } = cache(record);
    await ordinary(parent, true); await ordinary(directory, true);
    if ((await ordinary(executable)).size !== record.size) throw fail('下载副本大小已改变，请重新下载。');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(executable, { signal })) hash.update(chunk);
    if (hash.digest('hex') !== record.sha256) throw fail('下载副本校验失败，请重新下载。');
    const format = await inspectExecutable(executable);
    return { directory, executable, ...format };
  }
  async function checkQuota(record) {
    let bytes = 0, files = 0;
    for (const name of await readdir(parent)) {
      if (!UUID.test(name) || name === record.id) continue;
      const directory = path.join(parent, name);
      await ordinary(directory, true);
      try { bytes += (await ordinary(path.join(directory, 'game.exe'))).size; files++; }
      catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    }
    if (files >= maxFiles || bytes + record.size > quotaBytes) throw fail('本机 EXE 下载额度已满（最多 50 个文件、2 GiB）。', 507);
  }
  async function prepare(record, download, requestSignal) {
    assertEnabled(); checkRecord(record);
    if (pending) throw fail('已有文件正在下载或启动，请稍候。');
    if (running.get(record.id)?.state === 'started') throw fail('此程序的启动进程仍在运行，请先在游戏窗口退出。');
    pending = (async () => {
      const signal = AbortSignal.any([lifetime.signal, requestSignal || new AbortController().signal, AbortSignal.timeout(timeoutMs)]);
      signal.throwIfAborted(); prepared.delete(record.id); downloads.set(record.id, { state: 'checking', receivedBytes: 0, totalBytes: record.size, percent: 0, error: null });
      await mkdir(parent, { recursive: true }); await ordinary(parent, true);
      const { directory, executable } = cache(record);
      try {
        const existing = await verify(record, signal);
        signal.throwIfAborted(); prepared.set(record.id, existing);
        downloads.set(record.id, { state: 'ready', receivedBytes: record.size, totalBytes: record.size, percent: 100, error: null });
        return { prepared: true, reused: true, sha256: record.sha256, architecture: existing.architecture, progress: downloads.get(record.id) };
      } catch (cause) {
        signal.throwIfAborted();
        if (cause.code !== 'ENOENT' && cause.status !== 409) throw cause;
      }
      downloads.set(record.id, { state: 'downloading', receivedBytes: 0, totalBytes: record.size, percent: 0, error: null });
      await checkQuota(record);
      // A replacement only changes game.exe, preserving any local game saves.
      await mkdir(directory, { recursive: true }); await ordinary(directory, true);
      try { await ordinary(executable); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
      const partial = path.resolve(parent, `${record.id}.${randomUUID()}.part`);
      if (path.dirname(partial) !== parent) throw fail('下载临时路径无效。');
      let reader, handle;
      try {
        const response = await download(); reader = response.body?.getReader();
        if (response.status !== 200 || !reader || Number(response.headers.get('content-length')) !== record.size) throw fail('EXE 下载响应不完整。');
        const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
          handle = await open(partial, 'wx'); let size = 0; const hash = createHash('sha256');
          while (true) {
            signal.throwIfAborted(); const { value, done } = await reader.read(); signal.throwIfAborted();
            if (done) break;
            size += value.byteLength; if (size > record.size) throw fail('EXE 下载超过声明大小。');
            downloads.set(record.id, { state: 'downloading', receivedBytes: size, totalBytes: record.size, percent: Math.min(99, Math.floor(size * 100 / record.size)), error: null });
            hash.update(value); await handle.writeFile(value);
          }
          if (size !== record.size || hash.digest('hex') !== record.sha256) throw fail('EXE 下载校验失败。');
          await handle.sync(); await handle.close(); handle = null;
          downloads.set(record.id, { state: 'verifying', receivedBytes: record.size, totalBytes: record.size, percent: 99, error: null });
          await inspectExecutable(partial); signal.throwIfAborted();
          await rename(partial, executable);
          const verified = await verify(record, signal);
          signal.throwIfAborted(); prepared.set(record.id, verified);
          downloads.set(record.id, { state: 'ready', receivedBytes: record.size, totalBytes: record.size, percent: 100, error: null });
          return { prepared: true, reused: false, sha256: record.sha256, architecture: verified.architecture, progress: downloads.get(record.id) };
        } finally { signal.removeEventListener('abort', abort); }
      } finally {
        await reader?.cancel().catch(() => {}); reader?.releaseLock(); await handle?.close();
        await unlink(partial).catch(cause => { if (cause.code !== 'ENOENT') throw cause; });
      }
    })();
    try { return await pending; }
    catch (cause) {
      const message = requestSignal?.aborted || lifetime.signal.aborted || cause.name === 'TimeoutError' ? '下载已取消或超时，没有启动游戏。' : (cause.publicMessage || cause.message || '下载失败。');
      downloads.set(record.id, { state: 'failed', receivedBytes: downloads.get(record.id)?.receivedBytes || 0, totalBytes: record.size, percent: downloads.get(record.id)?.percent || 0, error: message });
      if (requestSignal?.aborted || lifetime.signal.aborted || cause.name === 'TimeoutError') throw fail(message, 408);
      throw cause;
    } finally { pending = null; }
  }
  async function launch(record, requestId, requestSignal) {
    assertEnabled(); checkRecord(record);
    if (!UUID.test(requestId || '')) throw fail('启动请求标识无效。', 400);
    if (attempts.has(requestId)) {
      const attempt = attempts.get(requestId);
      if (attempt.recordId !== record.id || attempt.sha256 !== record.sha256) throw fail('启动请求不匹配。');
      return attempt.promise;
    }
    if (attempts.size >= 1000) throw fail('本轮启动请求过多，请重启本机服务。', 429);
    if (pending) throw fail('已有文件正在下载或启动，请稍候。');
    if (!prepared.has(record.id)) throw fail('请先点击“下载到本机”。');
    if (running.get(record.id)?.state === 'started') throw fail('此程序的启动进程仍在运行，请先查看游戏窗口。');
    const signal = AbortSignal.any([lifetime.signal, requestSignal || new AbortController().signal]);
    const promise = (async () => {
      let verified;
      try { signal.throwIfAborted(); verified = await verify(record, signal); }
      catch (cause) { prepared.delete(record.id); throw cause; }
      signal.throwIfAborted();
      // No shell, caller-selected path, arguments, UAC elevation or input injection.
      const child = spawnProcess(verified.executable, [], { cwd: verified.directory, shell: false,
        detached: true, stdio: 'ignore', windowsHide: true, env: desktopEnvironment(environment) });
      return new Promise((resolve, reject) => {
        const state = { state: 'starting', requestId, startedAt: null, exitCode: null };
        child.once('spawn', () => {
          state.state = 'started'; state.startedAt = new Date().toISOString();
          running.set(record.id, state); child.unref();
          resolve({ launched: true, requestId, mode: 'independent-window', startedAt: state.startedAt });
        });
        child.on('error', cause => {
          state.state = 'failed'; running.set(record.id, state); child.unref();
          reject(fail(`Windows 未能启动此 EXE（${cause.code || 'spawn-error'}）。请检查程序依赖和所需权限；平台不会自动提权。`, 503));
        });
        child.once('exit', code => { state.state = 'entry-exited'; state.exitCode = code; });
      });
    })();
    attempts.set(requestId, { recordId: record.id, sha256: record.sha256, promise });
    pending = promise;
    try { return await promise; } finally { if (pending === promise) pending = null; }
  }
  return { enabled,
    status: record => ({ enabled: enabled && !disposed, prepared: prepared.has(record.id),
      state: running.get(record.id)?.state || 'idle', startedAt: running.get(record.id)?.startedAt || null,
      download: downloads.get(record.id) || { state: prepared.has(record.id) ? 'ready' : 'idle', receivedBytes: prepared.has(record.id) ? record.size : 0, totalBytes: record.size, percent: prepared.has(record.id) ? 100 : 0, error: null } }),
    prepare, launch,
    // These are independent desktop programs: closing the tab/service never kills them.
    async close() { disposed = true; lifetime.abort(); await pending?.catch(() => {}); prepared.clear(); downloads.clear(); } };
}
