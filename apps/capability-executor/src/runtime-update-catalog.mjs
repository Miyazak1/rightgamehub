import crypto from 'node:crypto';
import { fail } from './errors.mjs';
import { stableJson } from './package-contracts.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const ID = /^[a-z][a-z0-9.-]{2,119}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const text = (value, min, max, pattern) => typeof value === 'string' && value.trim() === value
  && value.length >= min && value.length <= max && (!pattern || pattern.test(value));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

function normalizeRelease(release) {
  if (!exact(release, ['runtimeId', 'runtimeVersion', 'releaseSequence', 'platform',
    'minimumOsBuild', 'manifestSha256', 'archive'])
    || !text(release.runtimeId, 3, 120, ID)
    || !text(release.runtimeVersion, 5, 64, SEMVER)
    || !integer(release.releaseSequence, 1, Number.MAX_SAFE_INTEGER)
    || release.platform !== 'win32-x64'
    || !integer(release.minimumOsBuild, 10240, 999999)
    || !text(release.manifestSha256, 64, 64, SHA256)
    || !exact(release.archive, ['url', 'sha256', 'sizeBytes'])
    || !text(release.archive.url, 12, 2048)
    || !release.archive.url.startsWith('https://')
    || !text(release.archive.sha256, 64, 64, SHA256)
    || !integer(release.archive.sizeBytes, 1, 1024 * 1024 ** 2)) {
    fail('CAPABILITY_RUNTIME_UPDATE_RELEASE_INVALID');
  }
  return structuredClone(release);
}

export function normalizeWindowsRuntimeUpdateCatalog(input) {
  if (!exact(input, ['schemaVersion', 'catalogId', 'sequence', 'generatedAt', 'expiresAt',
    'keyId', 'releases', 'revokedManifestSha256s', 'signature'])
    || input.schemaVersion !== 'windows-runtime-update-catalog-v1'
    || !text(input.catalogId, 3, 120, ID)
    || !integer(input.sequence, 1, Number.MAX_SAFE_INTEGER)
    || !text(input.generatedAt, 20, 40) || !Number.isFinite(Date.parse(input.generatedAt))
    || !text(input.expiresAt, 20, 40) || !Number.isFinite(Date.parse(input.expiresAt))
    || Date.parse(input.expiresAt) <= Date.parse(input.generatedAt)
    || !text(input.keyId, 3, 120, ID)
    || !Array.isArray(input.releases) || input.releases.length > 256
    || !Array.isArray(input.revokedManifestSha256s) || input.revokedManifestSha256s.length > 2048
    || !text(input.signature, 32, 4096)) fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_INVALID');
  const releases = input.releases.map(normalizeRelease);
  const releaseKeys = new Set();
  for (const release of releases) {
    const key = `${release.runtimeId}\0${release.releaseSequence}`;
    if (releaseKeys.has(key)) fail('CAPABILITY_RUNTIME_UPDATE_RELEASE_DUPLICATE');
    releaseKeys.add(key);
  }
  const revoked = new Set();
  for (const hash of input.revokedManifestSha256s) {
    if (!text(hash, 64, 64, SHA256) || revoked.has(hash)) {
      fail('CAPABILITY_RUNTIME_UPDATE_REVOCATION_INVALID');
    }
    revoked.add(hash);
  }
  return { ...structuredClone(input), releases };
}

export function windowsRuntimeUpdateCatalogStatement(input) {
  const catalog = normalizeWindowsRuntimeUpdateCatalog(input);
  return { schemaVersion: catalog.schemaVersion, catalogId: catalog.catalogId,
    sequence: catalog.sequence, generatedAt: catalog.generatedAt, expiresAt: catalog.expiresAt,
    keyId: catalog.keyId, releases: catalog.releases.map(item => structuredClone(item)),
    revokedManifestSha256s: [...catalog.revokedManifestSha256s] };
}

export function signWindowsRuntimeUpdateCatalog(input, privateKeyPem) {
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length < 64) {
    fail('CAPABILITY_RUNTIME_UPDATE_PRIVATE_KEY_INVALID');
  }
  const unsigned = { ...structuredClone(input), signature: 'pending-signature-value-00000000' };
  const statement = windowsRuntimeUpdateCatalogStatement(unsigned);
  let signature;
  try { signature = crypto.sign(null, Buffer.from(stableJson(statement)), privateKeyPem).toString('base64url'); }
  catch { fail('CAPABILITY_RUNTIME_UPDATE_PRIVATE_KEY_INVALID'); }
  return { ...statement, signature };
}

export function verifyWindowsRuntimeUpdateCatalog({ catalog, trustedKeys, now = new Date() } = {}) {
  const normalized = normalizeWindowsRuntimeUpdateCatalog(catalog);
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp) || timestamp < Date.parse(normalized.generatedAt)
    || timestamp >= Date.parse(normalized.expiresAt)) fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_EXPIRED');
  if (!Array.isArray(trustedKeys) || trustedKeys.length > 64) {
    fail('CAPABILITY_RUNTIME_UPDATE_KEYRING_INVALID');
  }
  const key = trustedKeys.find(item => item?.keyId === normalized.keyId);
  if (!key || key.status !== 'active' || typeof key.publicKeyPem !== 'string') {
    fail('CAPABILITY_RUNTIME_UPDATE_SIGNING_KEY_UNTRUSTED');
  }
  const notBefore = Date.parse(key.notBefore);
  const notAfter = key.notAfter == null ? Number.POSITIVE_INFINITY : Date.parse(key.notAfter);
  if (!Number.isFinite(notBefore) || timestamp < notBefore
    || key.notAfter != null && !Number.isFinite(notAfter) || timestamp >= notAfter) {
    fail('CAPABILITY_RUNTIME_UPDATE_SIGNING_KEY_INACTIVE');
  }
  let signature;
  try { signature = Buffer.from(normalized.signature, 'base64url'); }
  catch { fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_SIGNATURE_INVALID'); }
  if (signature.length !== 64 || !crypto.verify(null,
    Buffer.from(stableJson(windowsRuntimeUpdateCatalogStatement(normalized))),
    key.publicKeyPem, signature)) fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_SIGNATURE_INVALID');
  return normalized;
}
