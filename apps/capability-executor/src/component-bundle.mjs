import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { extractZipSecurely } from './secure-zip.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,119}$/u;
const ID = /^[a-z][a-z0-9._-]{2,119}$/u;
const ROLES = new Set(['pdf-renderer', 'layout-model', 'ocr-detection-model',
  'ocr-recognition-model', 'table-model', 'formula-model']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500
    || value.includes('\0') || value.includes('\\') || value.startsWith('/')
    || /^[A-Za-z]:/u.test(value) || !/^[A-Za-z0-9._+@/-]+$/u.test(value)
    || value.split('/').some(segment => segment.length < 1 || segment === '.' || segment === '..')) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '.' && normalized !== '..'
    && !normalized.startsWith('../');
}

function normalizeIdentity(value) {
  if (!exact(value, ['componentId', 'role', 'version', 'sha256', 'sizeBytes'])
    || !ID.test(value.componentId) || !ROLES.has(value.role) || !VERSION.test(value.version)
    || !SHA256.test(value.sha256) || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes < 1 || value.sizeBytes > 20 * 1024 ** 3) {
    fail('CAPABILITY_COMPONENT_BUNDLE_IDENTITY_INVALID', { safeFailure: true });
  }
  return structuredClone(value);
}

function normalizeExpectedContent(value) {
  if (!exact(value, ['kind', 'manifestSha256', 'fileCount', 'expandedSizeBytes'])
    || value.kind !== 'zip-bundle' || !SHA256.test(value.manifestSha256)
    || !Number.isSafeInteger(value.fileCount) || value.fileCount < 1 || value.fileCount > 4096
    || !Number.isSafeInteger(value.expandedSizeBytes) || value.expandedSizeBytes < 1
    || value.expandedSizeBytes > 20 * 1024 ** 3) {
    fail('CAPABILITY_COMPONENT_BUNDLE_CONTENT_IDENTITY_INVALID', { safeFailure: true });
  }
  return structuredClone(value);
}

export function normalizeCapabilityComponentBundleManifest(value) {
  if (!exact(value, ['schemaVersion', 'component', 'files'])
    || value.schemaVersion !== 'capability-component-bundle-v1'
    || !exact(value.component, ['componentId', 'role', 'version'])
    || !ID.test(value.component.componentId) || !ROLES.has(value.component.role)
    || !VERSION.test(value.component.version)
    || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 4096) {
    fail('CAPABILITY_COMPONENT_BUNDLE_MANIFEST_INVALID', { safeFailure: true });
  }
  const files = [], paths = new Set();
  let previous = '', expandedSizeBytes = 0;
  for (const file of value.files) {
    if (!exact(file, ['path', 'sha256', 'sizeBytes', 'executable'])
      || !safeRelativePath(file.path) || file.path <= previous || paths.has(file.path)
      || !SHA256.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes)
      || file.sizeBytes < 0 || typeof file.executable !== 'boolean') {
      fail('CAPABILITY_COMPONENT_BUNDLE_MANIFEST_INVALID', { safeFailure: true });
    }
    expandedSizeBytes += file.sizeBytes;
    if (!Number.isSafeInteger(expandedSizeBytes) || expandedSizeBytes > 20 * 1024 ** 3) {
      fail('CAPABILITY_COMPONENT_BUNDLE_LIMIT_EXCEEDED', { safeFailure: true });
    }
    previous = file.path; paths.add(file.path); files.push(structuredClone(file));
  }
  return { schemaVersion: value.schemaVersion, component: structuredClone(value.component), files,
    expandedSizeBytes };
}

async function listPayloadFiles(root) {
  const files = [];
  const visit = async (directory, prefix = '') => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stats = await fs.promises.lstat(absolute);
      if (stats.isSymbolicLink()) fail('CAPABILITY_COMPONENT_BUNDLE_ENTRY_UNSUPPORTED', { safeFailure: true });
      if (stats.isDirectory()) await visit(absolute, relative);
      else if (stats.isFile()) files.push({ path: relative, absolutePath: absolute, stats });
      else fail('CAPABILITY_COMPONENT_BUNDLE_ENTRY_UNSUPPORTED', { safeFailure: true });
    }
  };
  await visit(root);
  return files;
}

async function verifyArchive(archivePath, component) {
  const archiveStats = await fs.promises.lstat(archivePath).catch(() => null);
  if (!archiveStats?.isFile() || archiveStats.isSymbolicLink()
    || archiveStats.size !== component.sizeBytes || await sha256(archivePath) !== component.sha256) {
    fail('CAPABILITY_COMPONENT_BUNDLE_ARCHIVE_TAMPERED', { safeFailure: true });
  }
}

async function verifyBundleDirectory({ bundleDirectory, component, expectedContent = null,
  maxFiles, maxExpandedBytes }) {
  const rootStats = await fs.promises.lstat(bundleDirectory).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    fail('CAPABILITY_COMPONENT_BUNDLE_LAYOUT_INVALID', { safeFailure: true });
  }
  const rootEntries = await fs.promises.readdir(bundleDirectory, { withFileTypes: true });
  if (rootEntries.length !== 2
    || !rootEntries.some(entry => entry.name === 'component.bundle.json' && entry.isFile())
    || !rootEntries.some(entry => entry.name === 'payload' && entry.isDirectory())) {
    fail('CAPABILITY_COMPONENT_BUNDLE_LAYOUT_INVALID', { safeFailure: true });
  }
  const manifestPath = path.join(bundleDirectory, 'component.bundle.json');
  const manifestStats = await fs.promises.lstat(manifestPath);
  if (manifestStats.isSymbolicLink() || manifestStats.size > 1024 * 1024) {
    fail('CAPABILITY_COMPONENT_BUNDLE_MANIFEST_INVALID', { safeFailure: true });
  }
  const manifestBytes = await fs.promises.readFile(manifestPath);
  let manifestValue;
  try { manifestValue = JSON.parse(manifestBytes.toString('utf8')); }
  catch { fail('CAPABILITY_COMPONENT_BUNDLE_MANIFEST_INVALID', { safeFailure: true }); }
  const manifest = normalizeCapabilityComponentBundleManifest(manifestValue);
  const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  if (manifest.component.componentId !== component.componentId
    || manifest.component.role !== component.role || manifest.component.version !== component.version
    || manifest.files.length > maxFiles || manifest.expandedSizeBytes > maxExpandedBytes
    || expectedContent && (manifestSha256 !== expectedContent.manifestSha256
      || manifest.files.length !== expectedContent.fileCount
      || manifest.expandedSizeBytes !== expectedContent.expandedSizeBytes)) {
    fail('CAPABILITY_COMPONENT_BUNDLE_IDENTITY_MISMATCH', { safeFailure: true });
  }
  const payloadRoot = path.join(bundleDirectory, 'payload');
  const actual = await listPayloadFiles(payloadRoot);
  if (actual.length !== manifest.files.length) {
    fail('CAPABILITY_COMPONENT_BUNDLE_CONTENT_INVALID', { safeFailure: true });
  }
  const verifiedFiles = [];
  for (let index = 0; index < manifest.files.length; index += 1) {
    const declared = manifest.files[index], found = actual[index];
    if (found.path !== declared.path || found.stats.size !== declared.sizeBytes
      || await sha256(found.absolutePath) !== declared.sha256) {
      fail('CAPABILITY_COMPONENT_BUNDLE_CONTENT_INVALID', { safeFailure: true });
    }
    verifiedFiles.push({ ...declared, absolutePath: found.absolutePath });
  }
  return { schemaVersion: 'capability-component-bundle-install-v1', component,
    content: { kind: 'zip-bundle', manifestSha256, fileCount: manifest.files.length,
      expandedSizeBytes: manifest.expandedSizeBytes }, rootDirectory: payloadRoot,
    expandedSizeBytes: manifest.expandedSizeBytes, files: verifiedFiles };
}

export async function verifyInstalledCapabilityComponentBundle({ archivePath, bundleDirectory,
  component: componentValue, content: contentValue, maxFiles = 4096,
  maxExpandedBytes = 20 * 1024 ** 3 } = {}) {
  const component = normalizeIdentity(componentValue), content = normalizeExpectedContent(contentValue);
  if (!path.isAbsolute(archivePath ?? '') || !path.isAbsolute(bundleDirectory ?? '')
    || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 4096
    || !Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes < 1
    || maxExpandedBytes > 20 * 1024 ** 3) {
    fail('CAPABILITY_COMPONENT_BUNDLE_INPUT_INVALID', { safeFailure: true });
  }
  await verifyArchive(archivePath, component);
  return verifyBundleDirectory({ bundleDirectory, component, expectedContent: content,
    maxFiles, maxExpandedBytes });
}

export async function extractVerifiedCapabilityComponentBundle({ archivePath, destination,
  component: componentValue, content: contentValue = null, maxFiles = 4096,
  maxExpandedBytes = 20 * 1024 ** 3 } = {}) {
  const component = normalizeIdentity(componentValue);
  const content = contentValue == null ? null : normalizeExpectedContent(contentValue);
  if (!path.isAbsolute(archivePath ?? '') || !path.isAbsolute(destination ?? '')
    || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 4096
    || !Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes < 1
    || maxExpandedBytes > 20 * 1024 ** 3) {
    fail('CAPABILITY_COMPONENT_BUNDLE_INPUT_INVALID', { safeFailure: true });
  }
  await verifyArchive(archivePath, component);
  if (await fs.promises.lstat(destination).then(() => true).catch(error => {
    if (error?.code === 'ENOENT') return false;
    throw error;
  })) fail('CAPABILITY_COMPONENT_BUNDLE_DESTINATION_EXISTS', { safeFailure: true });

  try {
    await extractZipSecurely({ archivePath, destination, maxFiles: maxFiles + 1,
      maxExpandedBytes: maxExpandedBytes + 1024 * 1024 });
    return await verifyBundleDirectory({ bundleDirectory: destination, component,
      expectedContent: content, maxFiles, maxExpandedBytes });
  } catch (error) {
    await fs.promises.rm(destination, { recursive: true, force: true }).catch(() => {});
    if (error?.code?.startsWith('CAPABILITY_COMPONENT_BUNDLE_')) throw error;
    fail('CAPABILITY_COMPONENT_BUNDLE_ARCHIVE_INVALID', { safeFailure: true, cause: error });
  }
}
