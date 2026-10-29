import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const extensionPackage = await readJson('extensions/vscode/package.json');
const harnessPackage = await readJson('extensions/harness/package.json');
const installedDirectoryFlag = process.argv.indexOf('--installed-extension-dir');
const installedExtensionsRoot = installedDirectoryFlag >= 0
  ? path.resolve(process.argv[installedDirectoryFlag + 1] || '') : null;
const vsixPath = path.join(root, 'artifacts', `${extensionPackage.name}-${extensionPackage.version}.vsix`);
const harnessPath = path.join(root, 'artifacts', `${harnessPackage.name}-${harnessPackage.version}.tgz`);

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const text = (entries, name) => {
  const value = entries.get(name);
  assert.ok(value, `missing packaged entry: ${name}`);
  return value.toString('utf8');
};

function readStoredZip(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameBytes = bytes.readUInt16LE(offset + 26);
    const extraBytes = bytes.readUInt16LE(offset + 28);
    assert.equal(flags & 0x08, 0, 'VSIX entries must declare their size before content');
    assert.equal(method, 0, 'the repository VSIX packer emits stored entries');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameBytes + extraBytes;
    const dataEnd = dataStart + size;
    assert.ok(dataEnd <= bytes.length, 'VSIX entry exceeds archive bounds');
    const name = bytes.subarray(nameStart, nameStart + nameBytes).toString('utf8');
    assert.equal(entries.has(name), false, `duplicate VSIX entry: ${name}`);
    entries.set(name, bytes.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }
  return entries;
}

const cString = bytes => bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0))
  .toString('utf8');
function readTarGzip(bytes) {
  const tar = gunzipSync(bytes);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = cString(header.subarray(0, 100));
    const prefix = cString(header.subarray(345, 500));
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = cString(header.subarray(124, 136)).trim().replaceAll('\0', '');
    const size = Number.parseInt(sizeText || '0', 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0, `invalid TAR entry size: ${fullName}`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    assert.ok(dataEnd <= tar.length, `TAR entry exceeds archive bounds: ${fullName}`);
    if (header[156] !== 53) entries.set(fullName, tar.subarray(dataStart, dataEnd));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const [vsixBytes, harnessBytes] = await Promise.all([fs.readFile(vsixPath), fs.readFile(harnessPath)]);
const vsix = readStoredZip(vsixBytes);
const harness = readTarGzip(harnessBytes);

const extensionManifest = JSON.parse(text(vsix, 'extension/package.json'));
assert.equal(extensionManifest.name, extensionPackage.name);
assert.equal(extensionManifest.version, extensionPackage.version);
const extensionMain = text(vsix, 'extension/gamehub-extension.cjs');
const extensionArtifactHost = text(vsix, 'extension/capability-artifact-host.cjs');
assert.match(extensionMain, /require\('\.\/capability-artifact-host\.cjs'\)/u);
assert.match(extensionMain, /capabilityArtifacts\.open/u);
assert.match(extensionArtifactHost, /showSaveDialog/u);
assert.match(extensionArtifactHost, /cancelled: true/u);
assert.match(extensionArtifactHost, /createHash\('sha256'\)/u);

const installedHarnessManifest = JSON.parse(text(harness, 'package/package.json'));
assert.equal(installedHarnessManifest.name, harnessPackage.name);
assert.equal(installedHarnessManifest.version, harnessPackage.version);
const harnessService = text(harness, 'package/lib/transfer-service.mjs');
const harnessClient = text(harness, 'package/lib/client.js');
assert.match(harnessService, /\/api\/gamehub\/capability-artifact-open/u);
assert.match(harnessService, /artifactPreviews\.clear\(\)/u);
assert.match(harnessService, /default-src 'none'/u);
assert.match(harnessClient, /capability-artifact-open/u);

let installedEditor = null;
if (installedExtensionsRoot) {
  const installedRoot = path.join(installedExtensionsRoot,
    `${extensionPackage.publisher}.${extensionPackage.name}-${extensionPackage.version}`);
  const [installedManifest, installedMain, installedArtifactHost] = await Promise.all([
    fs.readFile(path.join(installedRoot, 'package.json')),
    fs.readFile(path.join(installedRoot, 'gamehub-extension.cjs')),
    fs.readFile(path.join(installedRoot, 'capability-artifact-host.cjs')),
  ]);
  const installedPackage = JSON.parse(installedManifest.toString('utf8'));
  assert.equal(installedPackage.name, extensionPackage.name);
  assert.equal(installedPackage.version, extensionPackage.version);
  assert.equal(digest(installedMain), digest(vsix.get('extension/gamehub-extension.cjs')),
    'installed extension main differs from the verified VSIX');
  assert.equal(digest(installedArtifactHost), digest(vsix.get('extension/capability-artifact-host.cjs')),
    'installed trusted artifact host differs from the verified VSIX');
  installedEditor = { root: installedRoot, version: installedPackage.version,
    artifactHostSha256: digest(installedArtifactHost), matchesVsix: true };
}

const receipt = {
  schemaVersion: 'capability-host-installed-verification-v1',
  verifiedAt: new Date().toISOString(),
  vscode: { version: extensionPackage.version, bytes: vsixBytes.length, sha256: digest(vsixBytes) },
  harness: { version: harnessPackage.version, bytes: harnessBytes.length, sha256: digest(harnessBytes) },
  installedEditor,
  checks: ['trusted-editor-module-packaged', 'native-save-cancellation-packaged',
    'harness-local-preview-packaged', 'harness-preview-restart-boundary-packaged'],
};
const receiptPath = path.join(root, '.runtime', 'capability-host-installed-verification.json');
await fs.mkdir(path.dirname(receiptPath), { recursive: true });
await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`Verified installed host packages: VS Code ${extensionPackage.version}, Harness ${harnessPackage.version}.`);
if (installedEditor) console.log(`Verified isolated editor installation: ${installedEditor.root}`);
console.log(`Receipt: ${receiptPath}`);
