import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { CapabilityExecutorError, fail } from './errors.mjs';

const normalizedZipError = error => {
  if (error instanceof CapabilityExecutorError) return error;
  if (/invalid relative path|absolute path|invalid characters in fileName/iu.test(String(error?.message ?? ''))) {
    return new CapabilityExecutorError('CAPABILITY_PACKAGE_ARCHIVE_PATH_INVALID', { cause: error });
  }
  return new CapabilityExecutorError('CAPABILITY_PACKAGE_ARCHIVE_INVALID', { cause: error });
};

const openZip = file => new Promise((resolve, reject) => {
  yauzl.open(file, { lazyEntries: true, autoClose: true, decodeStrings: true,
    validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(error) : resolve(zip));
});
const openEntryStream = (zip, entry) => new Promise((resolve, reject) => {
  zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
});

function safeEntryName(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 500 || name.includes('\0')
    || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/u.test(name)) {
    fail('CAPABILITY_PACKAGE_ARCHIVE_PATH_INVALID');
  }
  const normalized = path.posix.normalize(name);
  if (normalized === '..' || normalized.startsWith('../') || normalized !== name.replace(/^\.\//u, '')) {
    fail('CAPABILITY_PACKAGE_ARCHIVE_PATH_INVALID');
  }
  return normalized;
}

function entryKind(entry) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const unixType = unixMode & 0o170000;
  if (unixType === 0o120000) return 'link';
  if (entry.fileName.endsWith('/') || unixType === 0o040000) return 'directory';
  if (unixType === 0 || unixType === 0o100000) return 'file';
  return 'special';
}

export async function extractZipSecurely({ archivePath, destination, maxFiles = 4096,
  maxExpandedBytes = 8 * 1024 ** 3 } = {}) {
  if (!path.isAbsolute(archivePath) || !path.isAbsolute(destination)
    || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 10000
    || !Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes < 1) {
    fail('CAPABILITY_PACKAGE_EXTRACTION_INPUT_INVALID');
  }
  await fs.promises.mkdir(destination, { recursive: true });
  let zip;
  try { zip = await openZip(archivePath); }
  catch (error) { throw normalizedZipError(error); }
  const root = `${path.resolve(destination)}${path.sep}`;
  const seen = new Set();
  let files = 0, expandedBytes = 0, settled = false;
  return new Promise((resolve, reject) => {
    const stop = error => {
      if (settled) return;
      settled = true;
      try { zip.close(); } catch {}
      reject(normalizedZipError(error));
    };
    zip.on('error', stop);
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      resolve({ files, expandedBytes, entries: [...seen].sort() });
    });
    zip.on('entry', entry => {
      void (async () => {
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) fail('CAPABILITY_PACKAGE_ARCHIVE_ENCRYPTED');
        const name = safeEntryName(entry.fileName), kind = entryKind(entry);
        if (kind === 'link' || kind === 'special') fail('CAPABILITY_PACKAGE_ARCHIVE_ENTRY_UNSUPPORTED');
        const key = name.replace(/\/$/u, '');
        if (!key || seen.has(key)) fail('CAPABILITY_PACKAGE_ARCHIVE_DUPLICATE');
        seen.add(key);
        const target = path.resolve(destination, ...key.split('/'));
        if (!target.startsWith(root)) fail('CAPABILITY_PACKAGE_ARCHIVE_PATH_INVALID');
        if (kind === 'directory') {
          await fs.promises.mkdir(target, { recursive: true });
        } else {
          files += 1;
          expandedBytes += entry.uncompressedSize;
          if (files > maxFiles || expandedBytes > maxExpandedBytes) {
            fail('CAPABILITY_PACKAGE_ARCHIVE_LIMIT_EXCEEDED');
          }
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          const input = await openEntryStream(zip, entry);
          const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
          await pipeline(input, output);
          const stats = await fs.promises.stat(target);
          if (stats.size !== entry.uncompressedSize) fail('CAPABILITY_PACKAGE_ARCHIVE_SIZE_MISMATCH');
        }
        zip.readEntry();
      })().catch(stop);
    });
    zip.readEntry();
  });
}
