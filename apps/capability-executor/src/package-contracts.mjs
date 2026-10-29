import crypto from 'node:crypto';
import { fail } from './errors.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const CAPABILITY_ID = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/u;
const CONTRACT_KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const SAFE_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*[\\])[^\0]+$/u;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const string = (value, min, max, pattern) => typeof value === 'string' && value.trim() === value
  && value.length >= min && value.length <= max && (!pattern || pattern.test(value));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export function packageReleaseStatement(manifest, placementIndex) {
  const placement = manifest?.placements?.[placementIndex], pkg = placement?.package;
  if (!object(manifest) || !integer(placementIndex, 0, 11) || !object(placement)
    || placement.target !== 'desktop' || placement.adapter !== 'native-package' || !object(pkg)
    || !string(manifest.capabilityId, 3, 160, CAPABILITY_ID)
    || !string(manifest.capabilityVersion, 5, 64, SEMVER)
    || !object(manifest.contract) || !string(manifest.contract.key, 3, 120, CONTRACT_KEY)
    || !integer(manifest.contract.version, 1, 2147483647)
    || !Array.isArray(placement.platforms) || placement.platforms.length < 1
    || placement.platforms.some(item => typeof item !== 'string')
    || !string(pkg.url, 8, 2000) || !pkg.url.startsWith('https://')
    || !string(pkg.sha256, 64, 64, SHA256) || !string(pkg.keyId, 3, 120, CONTRACT_KEY)
    || !string(pkg.signature, 32, 4096) || !integer(pkg.sizeBytes, 1, 50 * 1024 ** 3)) {
    fail('CAPABILITY_PACKAGE_RELEASE_INVALID');
  }
  return {
    schemaVersion: 'capability-package-release-v1',
    capabilityId: manifest.capabilityId,
    capabilityVersion: manifest.capabilityVersion,
    contract: { key: manifest.contract.key, version: manifest.contract.version },
    placement: { target: placement.target, adapter: placement.adapter,
      platforms: [...placement.platforms] },
    package: { url: pkg.url, sha256: pkg.sha256, sizeBytes: pkg.sizeBytes, keyId: pkg.keyId },
  };
}

export function verifyPackageRelease({ manifest, placementIndex, trustedKeys, now = new Date() }) {
  const statement = packageReleaseStatement(manifest, placementIndex);
  if (!Array.isArray(trustedKeys) || trustedKeys.length > 64) fail('CAPABILITY_PACKAGE_KEYRING_INVALID');
  const key = trustedKeys.find(item => item?.keyId === statement.package.keyId);
  if (!key || key.status !== 'active' || typeof key.publicKeyPem !== 'string') {
    fail('CAPABILITY_PACKAGE_SIGNING_KEY_UNTRUSTED');
  }
  const timestamp = now.getTime(), notBefore = new Date(key.notBefore).getTime();
  const notAfter = key.notAfter == null ? Number.POSITIVE_INFINITY : new Date(key.notAfter).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(notBefore) || timestamp < notBefore
    || timestamp >= notAfter) fail('CAPABILITY_PACKAGE_SIGNING_KEY_INACTIVE');
  let signature;
  try { signature = Buffer.from(manifest.placements[placementIndex].package.signature, 'base64url'); }
  catch { fail('CAPABILITY_PACKAGE_SIGNATURE_INVALID'); }
  if (signature.length !== 64 || !crypto.verify(null, Buffer.from(stableJson(statement)),
    key.publicKeyPem, signature)) fail('CAPABILITY_PACKAGE_SIGNATURE_INVALID');
  return structuredClone(statement);
}

export function normalizePackageManifest(input) {
  if (!exact(input, ['schemaVersion', 'capabilityId', 'capabilityVersion', 'contract',
    'entrypoint', 'files']) || input.schemaVersion !== 'capability-package-v1'
    || !string(input.capabilityId, 3, 160, CAPABILITY_ID)
    || !string(input.capabilityVersion, 5, 64, SEMVER)
    || !exact(input.contract, ['key', 'version'])
    || !string(input.contract.key, 3, 120, CONTRACT_KEY)
    || !integer(input.contract.version, 1, 2147483647)
    || !exact(input.entrypoint, ['kind', 'path', 'arguments'])
    || input.entrypoint.kind !== 'native-executable'
    || !string(input.entrypoint.path, 1, 500, SAFE_PATH)
    || !Array.isArray(input.entrypoint.arguments) || input.entrypoint.arguments.length > 64
    || input.entrypoint.arguments.some(value => typeof value !== 'string' || value.length > 1000)
    || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 4096) {
    fail('CAPABILITY_PACKAGE_MANIFEST_INVALID');
  }
  const paths = new Set();
  for (const file of input.files) {
    if (!exact(file, ['path', 'sha256', 'sizeBytes', 'executable'])
      || !string(file.path, 1, 500, SAFE_PATH) || file.path === 'capability.json'
      || !string(file.sha256, 64, 64, SHA256) || !integer(file.sizeBytes, 0, 8 * 1024 ** 3)
      || typeof file.executable !== 'boolean' || paths.has(file.path)) {
      fail('CAPABILITY_PACKAGE_FILE_MANIFEST_INVALID');
    }
    paths.add(file.path);
  }
  const entrypoint = input.files.find(file => file.path === input.entrypoint.path);
  if (!entrypoint?.executable) fail('CAPABILITY_PACKAGE_ENTRYPOINT_INVALID');
  return structuredClone(input);
}
