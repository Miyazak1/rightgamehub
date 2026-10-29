#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractZipSecurely } from '../apps/capability-executor/src/secure-zip.mjs';
import { normalizeWindowsRuntimeManifest } from '../apps/capability-executor/src/runtime-release-contracts.mjs';
import { signWindowsRuntimeUpdateCatalog } from '../apps/capability-executor/src/runtime-update-catalog.mjs';

const SPEC_KEYS = ['schemaVersion', 'catalogId', 'sequence', 'generatedAt', 'expiresAt',
  'keyId', 'releases', 'revokedManifestSha256s'];
const RELEASE_KEYS = ['releaseDirectory', 'archivePath', 'archiveUrl', 'releaseSequence'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function listFiles(root, directory = root) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }), files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new Error('release entry unsupported');
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--input', '--output', '--private-key'].includes(key) || value == null || values[key]) {
      throw new Error('usage: build-windows-runtime-update-catalog.mjs --input SPEC --output FILE --private-key FILE');
    }
    values[key] = value;
  }
  if (Object.keys(values).length !== 3) throw new Error('missing required argument');
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputFile = path.resolve(args['--input']);
  const outputFile = path.resolve(args['--output']);
  const base = path.dirname(inputFile);
  if (await fs.promises.stat(outputFile).then(() => true).catch(() => false)) throw new Error('output already exists');
  const spec = JSON.parse(await fs.promises.readFile(inputFile, 'utf8'));
  if (!exact(spec, SPEC_KEYS) || spec.schemaVersion !== 'windows-runtime-update-catalog-build-v1'
    || !Array.isArray(spec.releases) || spec.releases.length < 1) throw new Error('invalid build spec');
  const releases = [];
  for (const item of spec.releases) {
    if (!exact(item, RELEASE_KEYS)) throw new Error('invalid release build spec');
    const releaseDirectory = path.resolve(base, item.releaseDirectory);
    const archivePath = path.resolve(base, item.archivePath);
    const manifestFile = path.join(releaseDirectory, 'runtime.json');
    const manifest = normalizeWindowsRuntimeManifest(JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')));
    const manifestSha256 = await sha256(manifestFile);
    const archiveStats = await fs.promises.stat(archivePath);
    if (!archiveStats.isFile() || archiveStats.size < 1) throw new Error('archive missing');
    const extracted = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mooyu-runtime-catalog-'));
    try {
      await extractZipSecurely({ archivePath, destination: extracted, maxFiles: 128,
        maxExpandedBytes: 1024 * 1024 ** 2 });
      if (await sha256(path.join(extracted, 'runtime.json')) !== manifestSha256) {
        throw new Error('archive manifest does not match release directory');
      }
      const actual = (await listFiles(extracted)).sort();
      const expected = ['runtime.json', ...manifest.files.map(file => file.path)].sort();
      if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        throw new Error('archive file set does not match manifest');
      }
      for (const file of manifest.files) {
        const absolute = path.join(extracted, ...file.path.split('/'));
        const stats = await fs.promises.stat(absolute);
        if (!stats.isFile() || stats.size !== file.sizeBytes || await sha256(absolute) !== file.sha256) {
          throw new Error(`archive file does not match manifest: ${file.path}`);
        }
      }
    } finally { await fs.promises.rm(extracted, { recursive: true, force: true }); }
    releases.push({ runtimeId: manifest.runtimeId, runtimeVersion: manifest.runtimeVersion,
      releaseSequence: item.releaseSequence, platform: manifest.platform,
      minimumOsBuild: manifest.minimumOsBuild, manifestSha256,
      archive: { url: item.archiveUrl, sha256: await sha256(archivePath), sizeBytes: archiveStats.size } });
  }
  const privateKeyPem = await fs.promises.readFile(path.resolve(args['--private-key']), 'utf8');
  const catalog = signWindowsRuntimeUpdateCatalog({ schemaVersion: 'windows-runtime-update-catalog-v1',
    catalogId: spec.catalogId, sequence: spec.sequence, generatedAt: spec.generatedAt,
    expiresAt: spec.expiresAt, keyId: spec.keyId, releases,
    revokedManifestSha256s: spec.revokedManifestSha256s, signature: 'pending' }, privateKeyPem);
  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.promises.writeFile(outputFile, `${JSON.stringify(catalog, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ schemaVersion: catalog.schemaVersion,
    outputFile, sequence: catalog.sequence, releases: catalog.releases.length })}\n`);
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
