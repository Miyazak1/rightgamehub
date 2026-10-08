import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import {normalizeCompetition} from '../../../packages/contracts/src/competition.mjs';
import yauzl from 'yauzl';
import { WEB_LIMITS, WEB_POLICY_VERSION, containedPath, mimeFor, validateAssetPath } from './web-package-policy.mjs';

const invalid = (code, message) => Object.assign(new Error(message), { code });
const supportedCapabilities = new Set(['fullscreen', 'multiplayer', 'pointerLock', 'localSave', 'competition']);

async function readPlatformManifest(output, assets) {
  if (!assets['platform.json']) {
    if (assets['index.html']?.size > 0) return { entry: 'index.html', approvedCapabilities: [] };
    const htmlEntries = Object.entries(assets)
      .filter(([, asset]) => asset.size > 0 && /^text\/html/.test(asset.mime))
      .map(([name]) => name)
      .sort();
    if (htmlEntries.length === 1) return { entry: htmlEntries[0], approvedCapabilities: [] };
    throw invalid('ENTRY_MISSING', htmlEntries.length
      ? 'ZIP must contain index.html at its root when it contains multiple HTML files.'
      : 'ZIP must contain a non-empty HTML entry file.');
  }
  if (assets['platform.json'].size > WEB_LIMITS.manifestBytes) throw invalid('MANIFEST_INVALID', 'platform.json exceeds 16 KiB.');
  let value;
  try { value = JSON.parse(await readFile(containedPath(output, 'platform.json'), 'utf8')); } catch { throw invalid('MANIFEST_INVALID', 'platform.json is not valid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw invalid('MANIFEST_INVALID', 'platform.json must be an object.');
  const allowed = new Set(['version', 'entry', 'capabilities', 'competition']);
  if (Object.keys(value).some(key => !allowed.has(key)) || value.version !== 1) throw invalid('MANIFEST_INVALID', 'platform.json has unknown fields or version.');
  const entry = validateAssetPath(value.entry ?? 'index.html');
  const capabilities = value.capabilities ?? [];
  if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length || capabilities.some(item => typeof item !== 'string' || !supportedCapabilities.has(item))) throw invalid('CAPABILITY_UNSUPPORTED', 'platform.json requests unsupported capabilities.');
  if (!assets[entry] || !/^text\/html/.test(assets[entry].mime)) throw invalid('MANIFEST_INVALID', 'The declared entry must be an HTML file in the package.');
  if(capabilities.includes('competition')!==(value.competition!==undefined))throw invalid('MANIFEST_COMPETITION_INVALID','Declare both the competition capability and its board definitions.');
  return { entry, approvedCapabilities: [...capabilities].sort(), ...(value.competition?{competition:normalizeCompetition(value.competition)}:{}) };
}

export async function validateWebZip(input, output, totalLimit = WEB_LIMITS.totalBytes) {
  const archive = await stat(input);
  if (archive.size > WEB_LIMITS.archiveBytes) throw invalid('UPLOAD_TOO_LARGE', 'Web ZIP exceeds 100 MiB.');
  await mkdir(output, { recursive: false });
  const zip = await yauzl.openPromise(input, { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true });
  const assets = Object.create(null);
  const seen = new Map();
  const spelling = new Map();
  let count = 0;
  let totalBytes = 0;
  let declaredTotal = 0;
  try {
    if (zip.entryCount > WEB_LIMITS.files) throw invalid('ZIP_LIMIT_EXCEEDED', 'ZIP contains too many entries.');
    for await (const entry of zip.eachEntry()) {
      if (++count > WEB_LIMITS.files) throw invalid('ZIP_LIMIT_EXCEEDED', 'ZIP contains too many entries.');
      const directory = entry.fileName.endsWith('/');
      const name = validateAssetPath(directory ? entry.fileName.slice(0, -1) : entry.fileName);
      const parts = name.split('/');
      for (let index = 1; index <= parts.length; index += 1) {
        const prefix = parts.slice(0, index).join('/');
        const folded = prefix.toLocaleLowerCase('en-US');
        if (spelling.has(folded) && spelling.get(folded) !== prefix) throw invalid('ZIP_PATH_CONFLICT', 'ZIP paths conflict by letter case.');
        spelling.set(folded, prefix);
      }
      const mode = entry.externalFileAttributes >>> 16;
      const type = mode & 0xf000;
      if ((type && type !== (directory ? 0x4000 : 0x8000)) || (entry.externalFileAttributes & 0x10 && !directory)) throw invalid('ZIP_SPECIAL_FILE', 'ZIP contains a link or special file.');
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) throw invalid('ZIP_COMPRESSION_UNSUPPORTED', 'ZIP encryption or compression method is unsupported.');
      const key = name.toLocaleLowerCase('en-US');
      const prior = seen.get(key);
      if (prior && !(directory && prior === 'implicit')) throw invalid('ZIP_PATH_CONFLICT', 'ZIP contains duplicate or conflicting paths.');
      seen.set(key, directory ? 'directory' : 'file');
      const segments = key.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        const parent = segments.slice(0, index).join('/');
        if (seen.get(parent) === 'file') throw invalid('ZIP_PATH_CONFLICT', 'ZIP file and directory paths conflict.');
        if (!seen.has(parent)) seen.set(parent, 'implicit');
      }
      if (directory) { if (entry.uncompressedSize !== 0) throw invalid('ZIP_INVALID', 'ZIP directory contains data.'); continue; }
      if (name === '.DS_Store' || name.endsWith('/.DS_Store') || name.startsWith('__MACOSX/')) continue;
      const mime = mimeFor(name);
      declaredTotal += entry.uncompressedSize;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > WEB_LIMITS.fileBytes || declaredTotal > totalLimit) throw invalid('ZIP_LIMIT_EXCEEDED', 'Expanded package exceeds its limits.');
      const local = await zip.readLocalFileHeaderPromise(entry, { minimal: false });
      if (!local.fileName.equals(entry.fileNameRaw) || local.compressionMethod !== entry.compressionMethod || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag) throw invalid('ZIP_INTEGRITY_INVALID', 'ZIP local header differs from its central directory.');
      if (!(entry.generalPurposeBitFlag & 8) && (local.crc32 !== entry.crc32 || local.uncompressedSize !== entry.uncompressedSize || local.compressedSize !== entry.compressedSize)) throw invalid('ZIP_INTEGRITY_INVALID', 'ZIP local header size or checksum is invalid.');
      const destination = containedPath(output, name);
      await mkdir(path.dirname(destination), { recursive: true });
      const hash = createHash('sha256');
      let size = 0;
      let crc = 0;
      const limiter = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length; totalBytes += chunk.length;
        if (size > WEB_LIMITS.fileBytes || totalBytes > totalLimit) return callback(invalid('ZIP_LIMIT_EXCEEDED', 'Expanded package exceeds its limits.'));
        crc = crc32(chunk, crc); hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(await zip.openReadStreamPromise(entry), limiter, createWriteStream(destination, { flags: 'wx' }));
      if (size !== entry.uncompressedSize || crc !== entry.crc32) throw invalid('ZIP_INTEGRITY_INVALID', 'ZIP entry length or CRC is invalid.');
      assets[name] = { size, sha256: hash.digest('hex'), mime };
    }
    const platform = await readPlatformManifest(output, assets);
    return { policyVersion: WEB_POLICY_VERSION, ...platform, totalBytes, fileCount: Object.keys(assets).length, assets };
  } finally { zip.close(); }
}
