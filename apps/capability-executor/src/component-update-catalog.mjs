import crypto from 'node:crypto';
import { fail } from './errors.mjs';
import { stableJson } from './package-contracts.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,119}$/u;
const ID = /^[a-z][a-z0-9._-]{2,119}$/u;
const ROLES = new Set(['pdf-renderer', 'layout-model', 'ocr-detection-model',
  'ocr-recognition-model', 'table-model', 'formula-model']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const text = (value, minimum, maximum, pattern = null) => typeof value === 'string'
  && value.trim() === value && value.length >= minimum && value.length <= maximum
  && (!pattern || pattern.test(value));
const integer = (value, minimum, maximum) => Number.isSafeInteger(value)
  && value >= minimum && value <= maximum;

function normalizeComponentContent(value) {
  if (exact(value, ['kind']) && value.kind === 'file') return { kind: 'file' };
  if (!exact(value, ['kind', 'manifestSha256', 'fileCount', 'expandedSizeBytes'])
    || value.kind !== 'zip-bundle' || !text(value.manifestSha256, 64, 64, SHA256)
    || !integer(value.fileCount, 1, 4096)
    || !integer(value.expandedSizeBytes, 1, 20 * 1024 ** 3)) {
    fail('CAPABILITY_COMPONENT_CONTENT_INVALID');
  }
  return structuredClone(value);
}

export function normalizeCapabilityComponentRelease(value,
  schemaVersion = 'capability-component-catalog-v1') {
  const version2 = schemaVersion === 'capability-component-catalog-v2';
  if (!['capability-component-catalog-v1', 'capability-component-catalog-v2'].includes(schemaVersion)
    || !exact(value, ['componentId', 'componentVersion', 'releaseSequence', 'role',
      'engine', 'platform', 'languages', 'download', ...(version2 ? ['content'] : [])])
    || !text(value.componentId, 3, 120, ID)
    || !text(value.componentVersion, 1, 120, VERSION)
    || !integer(value.releaseSequence, 1, Number.MAX_SAFE_INTEGER)
    || !ROLES.has(value.role)
    || !exact(value.engine, ['name', 'version'])
    || !text(value.engine.name, 2, 120) || !text(value.engine.version, 1, 120, VERSION)
    || value.platform !== 'win32-x64'
    || !Array.isArray(value.languages) || value.languages.length > 64
    || new Set(value.languages).size !== value.languages.length
    || value.languages.some(language => !text(language, 2, 35, /^[A-Za-z0-9-]+$/u))
    || !exact(value.download, ['url', 'sha256', 'sizeBytes'])
    || !text(value.download.url, 12, 2048) || !value.download.url.startsWith('https://')
    || !text(value.download.sha256, 64, 64, SHA256)
    || !integer(value.download.sizeBytes, 1, 20 * 1024 ** 3)) {
    fail('CAPABILITY_COMPONENT_RELEASE_INVALID');
  }
  return { ...structuredClone(value), ...(version2 ? { content: normalizeComponentContent(value.content) } : {}) };
}

export function normalizeCapabilityComponentCatalog(input) {
  if (!exact(input, ['schemaVersion', 'catalogId', 'sequence', 'generatedAt', 'expiresAt',
    'keyId', 'releases', 'revokedComponentSha256s', 'signature'])
    || !['capability-component-catalog-v1', 'capability-component-catalog-v2']
      .includes(input.schemaVersion)
    || !text(input.catalogId, 3, 120, ID)
    || !integer(input.sequence, 1, Number.MAX_SAFE_INTEGER)
    || !text(input.generatedAt, 20, 40) || !Number.isFinite(Date.parse(input.generatedAt))
    || !text(input.expiresAt, 20, 40) || !Number.isFinite(Date.parse(input.expiresAt))
    || Date.parse(input.expiresAt) <= Date.parse(input.generatedAt)
    || !text(input.keyId, 3, 120, ID)
    || !Array.isArray(input.releases) || input.releases.length > 4096
    || !Array.isArray(input.revokedComponentSha256s)
    || input.revokedComponentSha256s.length > 8192
    || !text(input.signature, 32, 4096)) fail('CAPABILITY_COMPONENT_CATALOG_INVALID');
  const releases = input.releases.map(value => normalizeCapabilityComponentRelease(value,
    input.schemaVersion)), releaseKeys = new Set();
  for (const release of releases) {
    const key = `${release.componentId}\0${release.releaseSequence}`;
    if (releaseKeys.has(key)) fail('CAPABILITY_COMPONENT_RELEASE_DUPLICATE');
    releaseKeys.add(key);
  }
  const revoked = new Set();
  for (const hash of input.revokedComponentSha256s) {
    if (!text(hash, 64, 64, SHA256) || revoked.has(hash)) {
      fail('CAPABILITY_COMPONENT_REVOCATION_INVALID');
    }
    revoked.add(hash);
  }
  return { ...structuredClone(input), releases };
}

export function capabilityComponentCatalogStatement(input) {
  const catalog = normalizeCapabilityComponentCatalog(input);
  return { schemaVersion: catalog.schemaVersion, catalogId: catalog.catalogId,
    sequence: catalog.sequence, generatedAt: catalog.generatedAt, expiresAt: catalog.expiresAt,
    keyId: catalog.keyId, releases: catalog.releases.map(item => structuredClone(item)),
    revokedComponentSha256s: [...catalog.revokedComponentSha256s] };
}

export function signCapabilityComponentCatalog(input, privateKeyPem) {
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length < 64) {
    fail('CAPABILITY_COMPONENT_PRIVATE_KEY_INVALID');
  }
  const unsigned = { ...structuredClone(input), signature: 'pending-signature-value-00000000' };
  const statement = capabilityComponentCatalogStatement(unsigned);
  try {
    return { ...statement, signature: crypto.sign(null, Buffer.from(stableJson(statement)),
      privateKeyPem).toString('base64url') };
  } catch { fail('CAPABILITY_COMPONENT_PRIVATE_KEY_INVALID'); }
}

export function verifyCapabilityComponentCatalog({ catalog, trustedKeys,
  now = new Date() } = {}) {
  const normalized = normalizeCapabilityComponentCatalog(catalog), timestamp = now.getTime();
  if (!Number.isFinite(timestamp) || timestamp < Date.parse(normalized.generatedAt)
    || timestamp >= Date.parse(normalized.expiresAt)) fail('CAPABILITY_COMPONENT_CATALOG_EXPIRED');
  if (!Array.isArray(trustedKeys) || trustedKeys.length > 64) {
    fail('CAPABILITY_COMPONENT_KEYRING_INVALID');
  }
  const key = trustedKeys.find(item => item?.keyId === normalized.keyId);
  if (!key || key.status !== 'active' || typeof key.publicKeyPem !== 'string') {
    fail('CAPABILITY_COMPONENT_SIGNING_KEY_UNTRUSTED');
  }
  const notBefore = Date.parse(key.notBefore);
  const notAfter = key.notAfter == null ? Number.POSITIVE_INFINITY : Date.parse(key.notAfter);
  if (!Number.isFinite(notBefore) || timestamp < notBefore
    || key.notAfter != null && !Number.isFinite(notAfter) || timestamp >= notAfter) {
    fail('CAPABILITY_COMPONENT_SIGNING_KEY_INACTIVE');
  }
  let signature;
  try { signature = Buffer.from(normalized.signature, 'base64url'); }
  catch { fail('CAPABILITY_COMPONENT_CATALOG_SIGNATURE_INVALID'); }
  if (signature.length !== 64 || !crypto.verify(null,
    Buffer.from(stableJson(capabilityComponentCatalogStatement(normalized))),
    key.publicKeyPem, signature)) fail('CAPABILITY_COMPONENT_CATALOG_SIGNATURE_INVALID');
  return normalized;
}

export function selectCapabilityComponentRelease({ catalog, trustedKeys, now = new Date(), component,
  engine, platform = 'win32-x64', languages = [] } = {}) {
  if (!exact(component, ['componentId', 'role', 'version', 'sha256', 'sizeBytes'])
    || !exact(engine, ['name', 'version']) || !Array.isArray(languages)
    || new Set(languages).size !== languages.length
    || languages.some(language => !text(language, 2, 35, /^[A-Za-z0-9-]+$/u))) {
    fail('CAPABILITY_COMPONENT_SELECTION_INVALID');
  }
  const verified = verifyCapabilityComponentCatalog({ catalog, trustedKeys, now });
  const revoked = new Set(verified.revokedComponentSha256s);
  const match = verified.releases.find(release => release.componentId === component.componentId
    && release.componentVersion === component.version && release.role === component.role
    && release.download.sha256 === component.sha256
    && release.download.sizeBytes === component.sizeBytes
    && release.engine.name === engine.name && release.engine.version === engine.version
    && release.platform === platform
    && languages.every(language => release.languages.includes(language))
    && !revoked.has(release.download.sha256));
  if (!match) fail('CAPABILITY_COMPONENT_RELEASE_UNAVAILABLE', { safeFailure: true });
  return structuredClone(match);
}
