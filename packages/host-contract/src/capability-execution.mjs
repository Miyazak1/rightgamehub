const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const CAPABILITY_ID = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/u;
const HOSTS = new Set(['codex', 'mcp-app', 'harness', 'cursor', 'vscode', 'desktop-app']);
const SURFACES = new Set(['mcp-app', 'sidebar', 'desktop-window']);
const CONNECTIONS = new Set(['control-plane', 'local-pipe']);
const RUN_STATES = new Set(['awaiting-consent', 'queued', 'installing', 'running',
  'succeeded', 'failed', 'cancelled']);
const ACTIVE_STATES = new Set(['awaiting-consent', 'queued', 'installing', 'running']);
const UNITS = new Set(['items', 'pages', 'bytes', 'percent', 'unknown']);
const OPERATIONS = Object.freeze({
  snapshot: 'capability.host.snapshot',
  submit: 'capability.runs.submit',
  get: 'capability.runs.get',
  cancel: 'capability.runs.cancel',
  artifacts: 'capability.runs.artifacts',
  openArtifact: 'capability.artifacts.open',
});

export const CAPABILITY_HOST_PROTOCOL_VERSION = 1;
export const CAPABILITY_HOST_OPERATIONS = OPERATIONS;

export class CapabilityHostProtocolError extends Error {
  constructor(code) {
    super(code); this.name = 'CapabilityHostProtocolError'; this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new CapabilityHostProtocolError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && keys.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => keys.includes(key));
const string = (value, min, max) => typeof value === 'string'
  && value.length >= min && value.length <= max;
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const clone = value => structuredClone(value);

function features(value) {
  const keys = ['submit', 'cancel', 'resume', 'artifacts', 'fileConsent', 'background'];
  if (!exact(value, keys) || keys.some(key => typeof value[key] !== 'boolean')) {
    fail('CAPABILITY_HOST_PROFILE_INVALID');
  }
  return clone(value);
}

export function normalizeCapabilityHostProfileV1(input) {
  const keys = ['schemaVersion', 'host', 'hostVersion', 'surface', 'connection', 'features'];
  if (!exact(input, keys) || input.schemaVersion !== 'capability-host-profile-v1'
    || !HOSTS.has(input.host) || !string(input.hostVersion, 1, 80)
    || !SURFACES.has(input.surface) || !CONNECTIONS.has(input.connection)) {
    fail('CAPABILITY_HOST_PROFILE_INVALID');
  }
  const normalized = { ...clone(input), features: features(input.features) };
  if (normalized.connection === 'local-pipe' && normalized.host === 'mcp-app') {
    fail('CAPABILITY_HOST_CONNECTION_INVALID');
  }
  return normalized;
}

function progress(value) {
  const keys = ['phase', 'completed', 'total', 'unit'];
  if (!exact(value, keys) || !string(value.phase, 1, 120)
    || !Number.isSafeInteger(value.completed) || value.completed < 0
    || value.total !== null && (!Number.isSafeInteger(value.total) || value.total < 0)
    || value.total !== null && value.completed > value.total || !UNITS.has(value.unit)) {
    fail('CAPABILITY_HOST_RUN_INVALID');
  }
  return clone(value);
}

export function normalizeCapabilityHostRunV1(input) {
  const keys = ['schemaVersion', 'runId', 'capabilityId', 'capabilityVersion', 'contractKey',
    'state', 'progress', 'artifactCount', 'resumable', 'createdAt', 'updatedAt', 'errorCode'];
  if (!exact(input, keys) || input.schemaVersion !== 'capability-host-run-v1'
    || !UUID.test(input.runId) || !string(input.capabilityId, 1, 160)
    || !CAPABILITY_ID.test(input.capabilityId) || !SEMVER.test(input.capabilityVersion)
    || !string(input.contractKey, 1, 160) || !RUN_STATES.has(input.state)
    || !Number.isSafeInteger(input.artifactCount) || input.artifactCount < 0
    || typeof input.resumable !== 'boolean' || !iso(input.createdAt) || !iso(input.updatedAt)
    || input.errorCode !== null && !string(input.errorCode, 1, 160)) {
    fail('CAPABILITY_HOST_RUN_INVALID');
  }
  if (ACTIVE_STATES.has(input.state) && input.errorCode !== null
    || input.state === 'failed' && input.errorCode === null
    || input.state !== 'succeeded' && input.artifactCount > 0) {
    fail('CAPABILITY_HOST_RUN_INVALID');
  }
  return { ...clone(input), progress: progress(input.progress) };
}

export function normalizeCapabilityHostArtifactV1(input) {
  const keys = ['schemaVersion', 'artifactId', 'runId', 'name', 'mediaType', 'sizeBytes',
    'sha256', 'openMode'];
  if (!exact(input, keys) || input.schemaVersion !== 'capability-host-artifact-v1'
    || !UUID.test(input.artifactId) || !UUID.test(input.runId) || !string(input.name, 1, 240)
    || !/^[a-z0-9][a-z0-9!#$&^_.+-]+\/[a-z0-9][a-z0-9!#$&^_.+-]+$/iu.test(input.mediaType)
    || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0
    || !/^[a-f0-9]{64}$/u.test(input.sha256)
    || !['host-preview', 'external-app', 'download'].includes(input.openMode)) {
    fail('CAPABILITY_HOST_ARTIFACT_INVALID');
  }
  return clone(input);
}

export function normalizeCapabilityHostEventV1(input) {
  const keys = ['schemaVersion', 'sequence', 'emittedAt', 'run'];
  if (!exact(input, keys) || input.schemaVersion !== 'capability-host-event-v1'
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || !iso(input.emittedAt)) {
    fail('CAPABILITY_HOST_EVENT_INVALID');
  }
  return { ...clone(input), run: normalizeCapabilityHostRunV1(input.run) };
}

const runIdPayload = input => {
  if (!exact(input, ['runId']) || !UUID.test(input.runId)) fail('CAPABILITY_HOST_REQUEST_INVALID');
  return clone(input);
};

function submitPayload(input) {
  const keys = ['capabilityId', 'capabilityVersion', 'contractKey', 'input', 'idempotencyKey'];
  if (!exact(input, keys) || !CAPABILITY_ID.test(String(input.capabilityId))
    || !SEMVER.test(String(input.capabilityVersion)) || !string(input.contractKey, 1, 160)
    || !object(input.input) || new TextEncoder().encode(JSON.stringify(input.input)).byteLength > 64 * 1024
    || !string(input.idempotencyKey, 16, 160)) fail('CAPABILITY_HOST_REQUEST_INVALID');
  return clone(input);
}

export function createCapabilityExecutionHostClient({ profile, transport } = {}) {
  const hostProfile = normalizeCapabilityHostProfileV1(profile);
  if (!transport || typeof transport.request !== 'function') {
    fail('CAPABILITY_HOST_TRANSPORT_REQUIRED');
  }
  const request = (operation, payload) => transport.request(operation, clone(payload));
  const snapshot = async () => {
    const result = await request(OPERATIONS.snapshot, null);
    if (!exact(result, ['profile', 'runs']) || !Array.isArray(result.runs)) {
      fail('CAPABILITY_HOST_RESPONSE_INVALID');
    }
    const remoteProfile = normalizeCapabilityHostProfileV1(result.profile);
    if (remoteProfile.host !== hostProfile.host || remoteProfile.surface !== hostProfile.surface) {
      fail('CAPABILITY_HOST_PROFILE_MISMATCH');
    }
    return { profile: remoteProfile, runs: result.runs.map(normalizeCapabilityHostRunV1) };
  };
  const submit = async input => {
    if (!hostProfile.features.submit) fail('CAPABILITY_HOST_OPERATION_UNSUPPORTED');
    return normalizeCapabilityHostRunV1(await request(OPERATIONS.submit, submitPayload(input)));
  };
  const get = async runId => normalizeCapabilityHostRunV1(
    await request(OPERATIONS.get, runIdPayload({ runId })));
  const cancel = async runId => {
    if (!hostProfile.features.cancel) fail('CAPABILITY_HOST_OPERATION_UNSUPPORTED');
    return normalizeCapabilityHostRunV1(await request(OPERATIONS.cancel, runIdPayload({ runId })));
  };
  const artifacts = async runId => {
    if (!hostProfile.features.artifacts) fail('CAPABILITY_HOST_OPERATION_UNSUPPORTED');
    const result = await request(OPERATIONS.artifacts, runIdPayload({ runId }));
    if (!Array.isArray(result)) fail('CAPABILITY_HOST_RESPONSE_INVALID');
    return result.map(normalizeCapabilityHostArtifactV1);
  };
  const openArtifact = async artifactId => {
    if (!hostProfile.features.artifacts || !UUID.test(String(artifactId))) {
      fail('CAPABILITY_HOST_OPERATION_UNSUPPORTED');
    }
    const result = await request(OPERATIONS.openArtifact, { artifactId });
    if (!exact(result, ['opened', 'cancelled']) || typeof result.opened !== 'boolean'
      || typeof result.cancelled !== 'boolean' || result.opened === result.cancelled) {
      fail('CAPABILITY_HOST_RESPONSE_INVALID');
    }
    return result;
  };
  const subscribe = listener => {
    if (typeof listener !== 'function') fail('CAPABILITY_HOST_LISTENER_INVALID');
    if (typeof transport.subscribe !== 'function') return () => {};
    let sequence = 0;
    return transport.subscribe(value => {
      const event = normalizeCapabilityHostEventV1(value);
      if (event.sequence <= sequence) return;
      sequence = event.sequence; listener(event);
    });
  };
  return { profile: clone(hostProfile), snapshot, submit, get, cancel, artifacts, openArtifact,
    subscribe };
}
