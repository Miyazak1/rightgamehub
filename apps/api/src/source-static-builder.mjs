import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import { MIME, validateAssetPath } from './web-package-policy.mjs';
import { SOURCE_BUILD_LIMITS, normalizeStaticBuildPlan } from './source-build-policy.mjs';
import { createZipBuffer } from './zip-buffer-writer.mjs';

const invalid = (code, message) => Object.assign(new Error(message), { code });
const ignoredRootFile = /^(?:readme(?:\.[^/]*)?|licen[cs]e(?:\.[^/]*)?|copying(?:\.[^/]*)?|notice(?:\.[^/]*)?|\.gitignore|\.gitattributes)$/iu;
const buildDescriptor = /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|vite\.config\.[^/]+)$/iu;

const safeArchiveParts = value => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || Buffer.byteLength(value) > 1024) {
    throw invalid('SOURCE_ARCHIVE_PATH_INVALID', 'Source archive contains an unsafe path.');
  }
  const directory = value.endsWith('/');
  const trimmed = directory ? value.slice(0, -1) : value;
  const parts = trimmed.split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) {
    throw invalid('SOURCE_ARCHIVE_PATH_INVALID', 'Source archive contains an unsafe path.');
  }
  return { parts, directory };
};

const readEntry = async (zip, entry, onBytes) => {
  const chunks = [];
  let size = 0;
  let checksum = 0;
  for await (const chunk of await zip.openReadStreamPromise(entry)) {
    size += chunk.length;
    onBytes(chunk.length);
    if (size > SOURCE_BUILD_LIMITS.fileBytes) throw invalid('SOURCE_BUILD_LIMIT_EXCEEDED', 'Source file exceeds the build limit.');
    checksum = crc32(chunk, checksum);
    chunks.push(chunk);
  }
  if (size !== entry.uncompressedSize || checksum !== entry.crc32) {
    throw invalid('SOURCE_ARCHIVE_INTEGRITY_INVALID', 'Source archive entry failed its integrity check.');
  }
  return Buffer.concat(chunks, size);
};

export async function buildStaticSourceArchive({ inputPath, outputPath, plan: rawPlan }) {
  const plan = normalizeStaticBuildPlan(rawPlan);
  const archive = await fsp.stat(inputPath);
  if (!archive.isFile() || archive.size < 22 || archive.size > SOURCE_BUILD_LIMITS.archiveBytes) {
    throw invalid('SOURCE_ARCHIVE_TOO_LARGE', 'Source archive size is invalid.');
  }

  const zip = await yauzl.openPromise(inputPath, { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true });
  const entries = [];
  const seen = new Map();
  let archiveRoot = null;
  let count = 0;
  let expandedBytes = 0;
  let selectedBytes = 0;
  const selectedPrefix = plan.subdirectory ? plan.subdirectory.split('/') : [];

  try {
    if (zip.entryCount > SOURCE_BUILD_LIMITS.files + 1000) throw invalid('SOURCE_BUILD_LIMIT_EXCEEDED', 'Source archive contains too many entries.');
    for await (const entry of zip.eachEntry()) {
      if (++count > SOURCE_BUILD_LIMITS.files + 1000) throw invalid('SOURCE_BUILD_LIMIT_EXCEEDED', 'Source archive contains too many entries.');
      const { parts, directory } = safeArchiveParts(entry.fileName);
      archiveRoot ??= parts[0];

      // GitHub archives include an explicit top-level directory before the files.
      // Accept that directory but still reject root-level files and multiple roots.
      if (parts[0] !== archiveRoot || (!directory && parts.length < 2)) {
        throw invalid('SOURCE_ARCHIVE_LAYOUT_INVALID', 'Source archive must contain one repository root directory.');
      }

      const mode = entry.externalFileAttributes >>> 16;
      const type = mode & 0xf000;
      if ((type && type !== (directory ? 0x4000 : 0x8000)) || entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) {
        throw invalid('SOURCE_ARCHIVE_UNSUPPORTED', 'Source archive contains a link, special file, encryption, or unsupported compression.');
      }
      if (directory) continue;

      expandedBytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > SOURCE_BUILD_LIMITS.fileBytes || expandedBytes > SOURCE_BUILD_LIMITS.expandedBytes) {
        throw invalid('SOURCE_BUILD_LIMIT_EXCEEDED', 'Expanded source exceeds the build limit.');
      }

      const repositoryParts = parts.slice(1);
      if (selectedPrefix.some((part, index) => repositoryParts[index] !== part) || repositoryParts.length <= selectedPrefix.length) continue;
      const relative = repositoryParts.slice(selectedPrefix.length).join('/');
      if (relative.startsWith('.github/') || relative.startsWith('.git/')) continue;
      if (!relative.includes('/') && ignoredRootFile.test(relative)) continue;
      if (!relative.includes('/') && buildDescriptor.test(relative)) {
        throw invalid('BUILD_PLAN_MISMATCH', 'The static template cannot execute a repository build descriptor.');
      }

      validateAssetPath(relative);
      const extension = path.posix.extname(relative).toLowerCase();
      if (!Object.hasOwn(MIME, extension)) {
        throw invalid('BUILD_OUTPUT_TYPE_UNSUPPORTED', `Static source contains an unsupported runtime file: ${relative}`);
      }
      const folded = relative.toLocaleLowerCase('en-US');
      if (seen.has(folded)) throw invalid('BUILD_OUTPUT_PATH_CONFLICT', 'Static source contains duplicate or case-conflicting paths.');
      seen.set(folded, relative);
      const data = await readEntry(zip, entry, bytes => {
        selectedBytes += bytes;
        if (selectedBytes > SOURCE_BUILD_LIMITS.expandedBytes) throw invalid('SOURCE_BUILD_LIMIT_EXCEEDED', 'Selected static files exceed the build limit.');
      });
      entries.push({ name: relative, data });
    }
  } finally {
    zip.close();
  }

  if (!entries.some(entry => entry.name === 'index.html' && entry.data.length > 0)) {
    throw invalid('ENTRY_MISSING', 'The selected static directory must contain a non-empty root index.html.');
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const output = createZipBuffer(entries);
  if (output.length > SOURCE_BUILD_LIMITS.outputBytes) throw invalid('BUILD_OUTPUT_TOO_LARGE', 'Built Web ZIP exceeds 100 MiB.');
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.partial`;
  await fsp.writeFile(temporary, output, { flag: 'wx', mode: 0o600 });
  await fsp.rename(temporary, outputPath);
  return Object.freeze({
    policyVersion: plan.policyVersion,
    templateKey: plan.templateKey,
    templateVersion: plan.templateVersion,
    configSha256: plan.configSha256,
    fileCount: entries.length,
    expandedBytes: selectedBytes,
    artifactBytes: output.length,
    artifactSha256: crypto.createHash('sha256').update(output).digest('hex'),
    entry: 'index.html',
  });
}
