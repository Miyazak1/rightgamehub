import { createWriteStream } from 'node:fs';
import { mkdir, stat, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import yauzl from '../vendor/zip-reader.cjs';
import { WEB_POLICY, WEB_LIMITS, containedPath, validateAssetPath, mimeFor } from './web-policy.mjs';
import { OFFSCREEN_MANIFEST, OFFSCREEN_PACKAGE_POLICY, validateOffscreenManifest } from './offscreen-package.mjs';

// This process parses data only. It never imports or executes files from a ZIP.
export async function extractWebZip(input, output, totalLimit = WEB_LIMITS.totalBytes) {
  const archive = await stat(input);
  if (archive.size > WEB_LIMITS.archiveBytes) throw new Error('网页游戏 ZIP 最多 100 MiB；该文件仍可下载。');
  const zip = await yauzl.openPromise(input, { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true });
  const assets = Object.create(null);
  const seen = new Map();
  const spelling = new Map();
  let count = 0;
  let totalBytes = 0;
  let declaredTotal = 0;
  try {
    if (zip.entryCount > WEB_LIMITS.files) throw new Error('ZIP 条目数超过 5000。');
    for await (const entry of zip.eachEntry()) {
      if (++count > WEB_LIMITS.files) throw new Error('ZIP 条目数超过 5000。');
      const directory = entry.fileName.endsWith('/');
      const name = validateAssetPath(directory ? entry.fileName.slice(0, -1) : entry.fileName);
      const originalParts = name.split('/');
      for (let i = 1; i <= originalParts.length; i++) {
        const prefix = originalParts.slice(0, i).join('/');
        const folded = prefix.toLocaleLowerCase('en-US');
        if (spelling.has(folded) && spelling.get(folded) !== prefix) throw new Error('ZIP 文件或父目录存在大小写冲突。');
        spelling.set(folded, prefix);
      }
      const mode = entry.externalFileAttributes >>> 16;
      const type = mode & 0xf000;
      if ((type && type !== (directory ? 0x4000 : 0x8000)) || (entry.externalFileAttributes & 0x10 && !directory)) throw new Error('ZIP 不允许符号链接或特殊文件。');
      if (entry.generalPurposeBitFlag & 0x41 || ![0, 8].includes(entry.compressionMethod)) throw new Error('不支持加密包或该压缩方式。');
      const key = name.toLocaleLowerCase('en-US');
      const prior = seen.get(key);
      if (prior && !(directory && prior === 'implicit')) throw new Error('ZIP 路径重复、大小写冲突或文件目录冲突。');
      seen.set(key, directory ? 'directory' : 'file');
      const segments = key.split('/');
      for (let i = 1; i < segments.length; i++) {
        const parent = segments.slice(0, i).join('/');
        if (seen.get(parent) === 'file') throw new Error('ZIP 文件与目录路径冲突。');
        if (!seen.has(parent)) seen.set(parent, 'implicit');
      }
      if (directory) { if (entry.uncompressedSize !== 0) throw new Error('ZIP 目录条目包含数据。'); continue; }
      // Desktop metadata may accompany a valid export; it is never served.
      if (name === '.DS_Store' || name.endsWith('/.DS_Store') || name.startsWith('__MACOSX/')) continue;
      const mime = mimeFor(name);
      declaredTotal += entry.uncompressedSize;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > WEB_LIMITS.fileBytes || declaredTotal > totalLimit) throw new Error('展开后的单文件或总大小超出限额。');
      const local = await zip.readLocalFileHeaderPromise(entry, { minimal: false });
      if (!local.fileName.equals(entry.fileNameRaw) || local.compressionMethod !== entry.compressionMethod || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag) throw new Error('ZIP 本地文件头与目录不一致。');
      if (!(entry.generalPurposeBitFlag & 8) && (local.crc32 !== entry.crc32 || local.uncompressedSize !== entry.uncompressedSize || local.compressedSize !== entry.compressedSize)) throw new Error('ZIP 本地文件大小或校验信息不一致。');
      const destination = containedPath(output, name);
      await mkdir(path.dirname(destination), { recursive: true });
      const hash = createHash('sha256');
      let size = 0;
      let crc = 0;
      const limiter = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length; totalBytes += chunk.length;
        if (size > WEB_LIMITS.fileBytes || totalBytes > totalLimit) { callback(new Error('ZIP 实际展开数据超过限额。')); return; }
        crc = crc32(chunk, crc); hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(await zip.openReadStreamPromise(entry), limiter, createWriteStream(destination, { flags: 'wx' }));
      if (size !== entry.uncompressedSize || crc !== entry.crc32) throw new Error('ZIP 文件长度或 CRC 校验失败。');
      assets[name] = { size, sha256: hash.digest('hex'), mime };
    }
    if (!assets['index.html']) throw new Error('ZIP 根目录必须有 index.html。请压缩构建目录内的文件，不要多包一层文件夹。');
    if (assets['index.html'].size === 0) throw new Error('index.html 不能为空。');
    let offscreen;
    if (assets[OFFSCREEN_MANIFEST]) {
      if (assets[OFFSCREEN_MANIFEST].size > 4096) throw new Error('侧栏适配清单最多 4 KiB。');
      offscreen = { policy: OFFSCREEN_PACKAGE_POLICY,
        manifest: validateOffscreenManifest(JSON.parse(await readFile(containedPath(output, OFFSCREEN_MANIFEST), 'utf8'))) };
    }
    return { state: 'ready', policy: WEB_POLICY, entry: 'index.html', totalBytes, fileCount: Object.keys(assets).length, assets, ...(offscreen ? { offscreen } : {}) };
  } finally { zip.close(); }
}

if (process.argv[2]) {
  try { process.stdout.write(JSON.stringify({ ok: true, game: await extractWebZip(process.argv[2], process.argv[3], Number(process.argv[4])) })); }
  catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}
