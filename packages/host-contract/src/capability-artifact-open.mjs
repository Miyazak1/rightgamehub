import { CapabilityHostProtocolError } from './capability-execution.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const MODES = new Set(['host-preview', 'external-app', 'download']);
const fail = code => { throw new CapabilityHostProtocolError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function stableCapabilityArtifactJson(value) {
  const active = new Set();
  const visit = item => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || active.has(item)) fail('CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).some(key => !/^\d+$/u.test(key) || String(Number(key)) !== key
          || Number(key) >= item.length)) fail('CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
        return `[${item.map((entry, index) => {
          if (!Object.hasOwn(item, index)) fail('CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
          return visit(entry);
        }).join(',')}]`;
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
        fail('CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
      }
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${visit(item[key])}`).join(',')}}`;
    } finally { active.delete(item); }
  };
  return visit(value);
}

export async function sha256CapabilityArtifact(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle || typeof TextEncoder !== 'function') fail('CAPABILITY_HOST_CRYPTO_UNAVAILABLE');
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(
    stableCapabilityArtifactJson(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeCapabilityArtifactOpenDirectiveV1(input, artifactId, { now = Date.now() } = {}) {
  const keys = ['schemaVersion', 'artifactId', 'runId', 'name', 'mediaType', 'sizeBytes',
    'sha256', 'openMode', 'locator', 'expiresAt'];
  const expiresAt = Date.parse(input?.expiresAt);
  if (!object(input) || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))
    || input.schemaVersion !== 'capability-artifact-open-v1' || input.artifactId !== artifactId
    || !UUID.test(String(input.artifactId)) || !UUID.test(String(input.runId))
    || typeof input.name !== 'string' || !/^[a-z][a-z0-9.-]{2,119}$/u.test(input.name)
    || input.mediaType !== 'application/json' || !Number.isSafeInteger(input.sizeBytes)
    || input.sizeBytes < 1 || input.sizeBytes > 1048576 || !SHA256.test(String(input.sha256))
    || !MODES.has(input.openMode)
    || input.locator !== `mooyu-artifact://${input.openMode}/${input.artifactId}`
    || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 5 * 60 * 1000 + 5000) {
    fail('CAPABILITY_HOST_OPEN_DIRECTIVE_INVALID');
  }
  return structuredClone(input);
}

export async function verifyCapabilityArtifactOpenPayload(input, { now = Date.now(), cryptoImpl } = {}) {
  if (!object(input) || Object.keys(input).length !== 2
    || !Object.hasOwn(input, 'directive') || !Object.hasOwn(input, 'artifact')) {
    fail('CAPABILITY_HOST_ARTIFACT_PAYLOAD_INVALID');
  }
  const directive = normalizeCapabilityArtifactOpenDirectiveV1(
    input.directive, input.directive?.artifactId, { now });
  const artifact = input.artifact;
  const keys = ['schemaVersion', 'artifactId', 'runId', 'name', 'mediaType', 'sizeBytes', 'sha256', 'content'];
  if (!object(artifact) || Object.keys(artifact).length !== keys.length
    || keys.some(key => !Object.hasOwn(artifact, key))
    || artifact.schemaVersion !== 'capability-artifact-content-v1'
    || ['artifactId', 'runId', 'name', 'mediaType', 'sizeBytes', 'sha256']
      .some(key => artifact[key] !== directive[key]) || !object(artifact.content)) {
    fail('CAPABILITY_HOST_ARTIFACT_PAYLOAD_INVALID');
  }
  if (await sha256CapabilityArtifact(artifact.content, cryptoImpl) !== directive.sha256) {
    fail('CAPABILITY_HOST_ARTIFACT_INTEGRITY');
  }
  return { directive, artifact: structuredClone(artifact) };
}
