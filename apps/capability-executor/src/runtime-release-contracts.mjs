import crypto from 'node:crypto';
import { fail } from './errors.mjs';
import { stableJson } from './package-contracts.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const ID = /^[a-z][a-z0-9.-]{2,119}$/u;
const SAFE_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*[\\])[^\0]+$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const string = (value, min, max, pattern) => typeof value === 'string' && value.trim() === value
  && value.length >= min && value.length <= max && (!pattern || pattern.test(value));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function normalizeWindowsRuntimeManifest(input) {
  if (!exact(input, ['schemaVersion', 'runtimeId', 'runtimeVersion', 'platform', 'minimumOsBuild',
    'keyId', 'files', 'helper', 'signature']) || input.schemaVersion !== 'windows-runtime-release-v1'
    || !string(input.runtimeId, 3, 120, ID) || !string(input.runtimeVersion, 5, 64, SEMVER)
    || input.platform !== 'win32-x64' || !integer(input.minimumOsBuild, 10240, 999999)
    || !string(input.keyId, 3, 120, ID) || !string(input.signature, 32, 4096)
    || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 64
    || !exact(input.helper, ['path', 'sha256'])) fail('CAPABILITY_RUNTIME_RELEASE_INVALID');
  const paths = new Set();
  for (const file of input.files) {
    if (!exact(file, ['path', 'sha256', 'sizeBytes', 'role'])
      || !string(file.path, 1, 500, SAFE_PATH) || paths.has(file.path)
      || !string(file.sha256, 64, 64, SHA256) || !integer(file.sizeBytes, 1, 256 * 1024 ** 2)
      || !['sandbox-host', 'runtime-support'].includes(file.role)) {
      fail('CAPABILITY_RUNTIME_RELEASE_FILE_INVALID');
    }
    paths.add(file.path);
  }
  const helper = input.files.find(file => file.path === input.helper.path);
  if (!helper || helper.role !== 'sandbox-host' || helper.sha256 !== input.helper.sha256
    || input.files.filter(file => file.role === 'sandbox-host').length !== 1) {
    fail('CAPABILITY_RUNTIME_RELEASE_HELPER_INVALID');
  }
  return structuredClone(input);
}

export function windowsRuntimeReleaseStatement(input) {
  const manifest = normalizeWindowsRuntimeManifest(input);
  return { schemaVersion: manifest.schemaVersion, runtimeId: manifest.runtimeId,
    runtimeVersion: manifest.runtimeVersion, platform: manifest.platform,
    minimumOsBuild: manifest.minimumOsBuild, keyId: manifest.keyId,
    files: manifest.files.map(file => ({ ...file })), helper: { ...manifest.helper } };
}

export function signWindowsRuntimeManifest(input, privateKeyPem) {
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length < 64) {
    fail('CAPABILITY_RUNTIME_RELEASE_PRIVATE_KEY_INVALID');
  }
  const unsigned = { ...structuredClone(input), signature: 'pending-signature-value-00000000' };
  const statement = windowsRuntimeReleaseStatement(unsigned);
  let signature;
  try { signature = crypto.sign(null, Buffer.from(stableJson(statement)), privateKeyPem).toString('base64url'); }
  catch { fail('CAPABILITY_RUNTIME_RELEASE_PRIVATE_KEY_INVALID'); }
  return { ...statement, signature };
}

export function verifyWindowsRuntimeManifest({ manifest, trustedKeys, now = new Date(),
  platform = 'win32-x64', osBuild } = {}) {
  const normalized = normalizeWindowsRuntimeManifest(manifest);
  if (normalized.platform !== platform) fail('CAPABILITY_RUNTIME_RELEASE_PLATFORM_MISMATCH');
  if (!integer(osBuild, 10240, 999999) || osBuild < normalized.minimumOsBuild) {
    fail('CAPABILITY_RUNTIME_RELEASE_OS_UNSUPPORTED');
  }
  if (!Array.isArray(trustedKeys) || trustedKeys.length > 64) {
    fail('CAPABILITY_RUNTIME_RELEASE_KEYRING_INVALID');
  }
  const key = trustedKeys.find(item => item?.keyId === normalized.keyId);
  if (!key || key.status !== 'active' || typeof key.publicKeyPem !== 'string') {
    fail('CAPABILITY_RUNTIME_RELEASE_SIGNING_KEY_UNTRUSTED');
  }
  const timestamp = now.getTime(), notBefore = new Date(key.notBefore).getTime();
  const notAfter = key.notAfter == null ? Number.POSITIVE_INFINITY : new Date(key.notAfter).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(notBefore) || timestamp < notBefore
    || key.notAfter != null && !Number.isFinite(notAfter) || timestamp >= notAfter) {
    fail('CAPABILITY_RUNTIME_RELEASE_SIGNING_KEY_INACTIVE');
  }
  let signature;
  try { signature = Buffer.from(normalized.signature, 'base64url'); }
  catch { fail('CAPABILITY_RUNTIME_RELEASE_SIGNATURE_INVALID'); }
  const statement = windowsRuntimeReleaseStatement(normalized);
  if (signature.length !== 64 || !crypto.verify(null, Buffer.from(stableJson(statement)),
    key.publicKeyPem, signature)) fail('CAPABILITY_RUNTIME_RELEASE_SIGNATURE_INVALID');
  return normalized;
}
