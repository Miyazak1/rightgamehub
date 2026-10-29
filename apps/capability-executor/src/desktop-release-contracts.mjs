import crypto from 'node:crypto';
import { fail } from './errors.mjs';
import { stableJson } from './package-contracts.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const ID = /^[a-z][a-z0-9.-]{2,119}$/u;
const SAFE_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*[\\])[^\0]+$/u;
const ROLES = new Set(['node-runtime', 'desktop-shell', 'tray', 'sandbox-host',
  'runtime-support']);
const ENTRYPOINT_ROLES = Object.freeze({ nodeRuntime: 'node-runtime', shell: 'desktop-shell',
  tray: 'tray', sandboxHost: 'sandbox-host' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const string = (value, min, max, pattern) => typeof value === 'string' && value.trim() === value
  && value.length >= min && value.length <= max && (!pattern || pattern.test(value));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function normalizeWindowsDesktopReleaseManifest(input) {
  if (!exact(input, ['schemaVersion', 'productId', 'productVersion', 'platform',
    'minimumOsBuild', 'keyId', 'files', 'entrypoints', 'signature'])
    || input.schemaVersion !== 'windows-desktop-release-v1'
    || !string(input.productId, 3, 120, ID) || !string(input.productVersion, 5, 64, SEMVER)
    || input.platform !== 'win32-x64' || !integer(input.minimumOsBuild, 10240, 999999)
    || !string(input.keyId, 3, 120, ID) || !string(input.signature, 32, 4096)
    || !Array.isArray(input.files) || input.files.length < 4 || input.files.length > 512
    || !exact(input.entrypoints, Object.keys(ENTRYPOINT_ROLES))) {
    fail('CAPABILITY_DESKTOP_RELEASE_INVALID');
  }
  const paths = new Set();
  for (const file of input.files) {
    if (!exact(file, ['path', 'sha256', 'sizeBytes', 'role'])
      || !string(file.path, 1, 500, SAFE_PATH) || paths.has(file.path)
      || !string(file.sha256, 64, 64, SHA256) || !integer(file.sizeBytes, 1, 512 * 1024 ** 2)
      || !ROLES.has(file.role)) fail('CAPABILITY_DESKTOP_RELEASE_FILE_INVALID');
    paths.add(file.path);
  }
  for (const [name, role] of Object.entries(ENTRYPOINT_ROLES)) {
    const entry = input.entrypoints[name];
    if (!exact(entry, ['path', 'sha256']) || !string(entry.path, 1, 500, SAFE_PATH)
      || !string(entry.sha256, 64, 64, SHA256)) {
      fail('CAPABILITY_DESKTOP_RELEASE_ENTRYPOINT_INVALID');
    }
    const file = input.files.find(item => item.path === entry.path);
    if (!file || file.role !== role || file.sha256 !== entry.sha256
      || input.files.filter(item => item.role === role).length !== 1) {
      fail('CAPABILITY_DESKTOP_RELEASE_ENTRYPOINT_INVALID');
    }
  }
  return structuredClone(input);
}

export function windowsDesktopReleaseStatement(input) {
  const manifest = normalizeWindowsDesktopReleaseManifest(input);
  return { schemaVersion: manifest.schemaVersion, productId: manifest.productId,
    productVersion: manifest.productVersion, platform: manifest.platform,
    minimumOsBuild: manifest.minimumOsBuild, keyId: manifest.keyId,
    files: manifest.files.map(file => ({ ...file })),
    entrypoints: Object.fromEntries(Object.entries(manifest.entrypoints)
      .map(([name, entry]) => [name, { ...entry }])) };
}

export function signWindowsDesktopReleaseManifest(input, privateKeyPem) {
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length < 64) {
    fail('CAPABILITY_DESKTOP_RELEASE_PRIVATE_KEY_INVALID');
  }
  const unsigned = { ...structuredClone(input), signature: 'pending-signature-value-00000000' };
  const statement = windowsDesktopReleaseStatement(unsigned);
  let signature;
  try { signature = crypto.sign(null, Buffer.from(stableJson(statement)), privateKeyPem)
    .toString('base64url'); }
  catch { fail('CAPABILITY_DESKTOP_RELEASE_PRIVATE_KEY_INVALID'); }
  return { ...statement, signature };
}

export function verifyWindowsDesktopReleaseManifest({ manifest, trustedKeys,
  now = new Date(), platform = 'win32-x64', osBuild } = {}) {
  const normalized = normalizeWindowsDesktopReleaseManifest(manifest);
  if (normalized.platform !== platform) fail('CAPABILITY_DESKTOP_RELEASE_PLATFORM_MISMATCH');
  if (!integer(osBuild, 10240, 999999) || osBuild < normalized.minimumOsBuild) {
    fail('CAPABILITY_DESKTOP_RELEASE_OS_UNSUPPORTED');
  }
  if (!Array.isArray(trustedKeys) || trustedKeys.length > 64) {
    fail('CAPABILITY_DESKTOP_RELEASE_KEYRING_INVALID');
  }
  const key = trustedKeys.find(item => item?.keyId === normalized.keyId);
  if (!key || key.status !== 'active' || typeof key.publicKeyPem !== 'string') {
    fail('CAPABILITY_DESKTOP_RELEASE_SIGNING_KEY_UNTRUSTED');
  }
  const timestamp = now.getTime(), notBefore = new Date(key.notBefore).getTime();
  const notAfter = key.notAfter == null ? Number.POSITIVE_INFINITY : new Date(key.notAfter).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(notBefore) || timestamp < notBefore
    || key.notAfter != null && !Number.isFinite(notAfter) || timestamp >= notAfter) {
    fail('CAPABILITY_DESKTOP_RELEASE_SIGNING_KEY_INACTIVE');
  }
  let signature;
  try { signature = Buffer.from(normalized.signature, 'base64url'); }
  catch { fail('CAPABILITY_DESKTOP_RELEASE_SIGNATURE_INVALID'); }
  if (signature.length !== 64 || !crypto.verify(null,
    Buffer.from(stableJson(windowsDesktopReleaseStatement(normalized))),
    key.publicKeyPem, signature)) fail('CAPABILITY_DESKTOP_RELEASE_SIGNATURE_INVALID');
  return normalized;
}
