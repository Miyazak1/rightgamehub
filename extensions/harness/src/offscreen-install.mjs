import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { prepareWebGame } from './prepare-web-game.mjs';
import { containedPath } from './web-policy.mjs';
import { approvedPackage, assertApprovedAssets, OFFSCREEN_MANIFEST, validateOffscreenManifest } from './offscreen-package.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const failure = message => Object.assign(new Error(message), { status: 409 });
async function ordinary(file, directory = false) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw failure('运行缓存包含链接或特殊文件。');
  return info;
}
async function digest(file, expected, signal) {
  const info = await ordinary(file);
  if (info.size !== expected.size) throw failure('运行缓存大小不匹配，请重新下载。');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  if (hash.digest('hex') !== expected.sha256) throw failure('运行缓存摘要不匹配，请重新下载。');
}

// The archive AND every renderer file are pinned in trusted plugin code. The
// writable installation receipt alone can never approve altered renderer code.
export async function verifyInstalledPackage(directory, expectedSha, signal) {
  signal?.throwIfAborted();
  if (!path.isAbsolute(directory)) throw failure('运行缓存必须使用绝对路径。');
  await ordinary(directory, true);
  const receiptPath = path.join(directory, 'install.json');
  if ((await ordinary(receiptPath)).size > 16384) throw failure('运行缓存记录无效。');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const item = approvedPackage(receipt.sha256);
  if (!item || receipt.schemaVersion !== 1 || !UUID.test(receipt.sourceId) || (expectedSha && receipt.sha256 !== expectedSha)) throw failure('运行缓存未经批准。');
  await digest(path.join(directory, 'package.zip'), item, signal);
  const webRoot = path.join(directory, 'web');
  await ordinary(webRoot, true);
  const assetRoot = path.join(webRoot, receipt.sourceId);
  await ordinary(assetRoot, true);
  const found = [];
  async function visit(current, prefix = '') {
    for (const name of await readdir(current)) {
      const relative = prefix + name;
      const file = containedPath(assetRoot, relative);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw failure('运行缓存包含链接。');
      if (info.isDirectory()) {
        if (!Object.keys(item.assets).some(asset => asset.startsWith(relative + '/'))) throw failure('运行缓存包含多余目录。');
        await visit(file, relative + '/');
      } else {
        if (!info.isFile() || !item.assets[relative]) throw failure('运行缓存包含额外文件。');
        await digest(file, item.assets[relative], signal); found.push(relative);
      }
    }
  }
  await visit(assetRoot);
  if (found.sort().join('\n') !== Object.keys(item.assets).sort().join('\n')) throw failure('运行缓存缺少资源。');
  const manifest = validateOffscreenManifest(JSON.parse(await readFile(path.join(assetRoot, OFFSCREEN_MANIFEST), 'utf8')));
  return { directory, sha256: item.sha256, manifest, entry: path.join(assetRoot, manifest.entry),
    allowedFiles: found.map(name => containedPath(assetRoot, name)) };
}

export async function installOffscreenPackage({ root, record, download, signal }) {
  const item = assertApprovedAssets(record.sha256, record.web);
  if (record.kind !== 'zip' || record.size !== item.size || !UUID.test(record.id)) throw failure('适配包记录无效。');
  const parent = path.resolve(root);
  const final = path.resolve(parent, item.sha256);
  if (path.dirname(final) !== parent || !/^[a-f0-9]{64}$/.test(item.sha256)) throw failure('缓存路径无效。');
  await mkdir(parent, { recursive: true }); await ordinary(parent, true);
  try {
    await lstat(final);
    try { return { ...await verifyInstalledPackage(final, record.sha256, signal), reused: true }; }
    catch (cause) {
      signal?.throwIfAborted();
      // An explicit prepare request repairs only this approved package cache.
      await ordinary(final, true);
      await rm(final, { recursive: true, force: true });
    }
  } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  const staging = path.resolve(parent, `.partial-${randomUUID()}`);
  if (path.dirname(staging) !== parent) throw failure('缓存路径无效。');
  await mkdir(staging);
  let reader, handle, committed = false;
  try {
    signal?.throwIfAborted();
    const response = await download();
    reader = response.body?.getReader();
    if (response.status !== 200 || !reader || Number(response.headers.get('content-length')) !== record.size) throw failure('适配包下载响应不完整。');
    const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    let size = 0; const hash = createHash('sha256');
    try {
      handle = await open(path.join(staging, 'package.zip'), 'wx');
      while (true) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > record.size) throw failure('适配包下载超过声明大小。');
        hash.update(value); await handle.writeFile(value);
      }
      if (size !== record.size || hash.digest('hex') !== record.sha256) throw failure('适配包下载校验失败。');
      await handle.sync(); await handle.close(); handle = null;
    } finally { signal?.removeEventListener('abort', abort); }
    const game = await prepareWebGame({ root: staging, id: record.id, archive: path.join(staging, 'package.zip'),
      totalLimit: Object.values(item.assets).reduce((sum, asset) => sum + asset.size, 0), signal });
    assertApprovedAssets(record.sha256, game);
    await writeFile(path.join(staging, 'install.json'), JSON.stringify({ schemaVersion: 1, sourceId: record.id, sha256: record.sha256 }), { flag: 'wx' });
    await verifyInstalledPackage(staging, record.sha256, signal);
    signal?.throwIfAborted();
    await rename(staging, final); committed = true;
    return { ...await verifyInstalledPackage(final, record.sha256, signal), reused: false };
  } finally {
    await reader?.cancel().catch(() => {}); reader?.releaseLock();
    await handle?.close();
    if (!committed) await rm(staging, { recursive: true, force: true });
  }
}
