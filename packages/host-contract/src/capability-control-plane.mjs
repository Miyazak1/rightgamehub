import { CAPABILITY_HOST_OPERATIONS, CapabilityHostProtocolError,
  normalizeCapabilityHostProfileV1 } from './capability-execution.mjs';
import { normalizeCapabilityArtifactOpenDirectiveV1,
  verifyCapabilityArtifactOpenPayload } from './capability-artifact-open.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUIRED_API_METHODS = Object.freeze([
  'getCapabilityHostSnapshot', 'submitCapabilityHostRun', 'getCapabilityHostRun',
  'cancelCapabilityHostRun', 'listCapabilityHostRunArtifacts',
  'getCapabilityHostArtifactOpenDirective', 'getCapabilityHostArtifactContent',
]);

const fail = code => { throw new CapabilityHostProtocolError(code); };
const clone = value => structuredClone(value);
const unwrap = value => value?.data ?? value;
const runFingerprint = run => JSON.stringify([
  run?.state, run?.updatedAt, run?.artifactCount, run?.errorCode,
  run?.progress?.phase, run?.progress?.completed, run?.progress?.total,
]);

export function createCapabilityControlPlaneTransport({ apiClient, agentUserId, profile,
  openArtifact, pollIntervalMs = 2500, setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout } = {}) {
  const hostProfile = normalizeCapabilityHostProfileV1(profile);
  if (!UUID.test(String(agentUserId))) fail('CAPABILITY_HOST_AGENT_INVALID');
  if (!apiClient || REQUIRED_API_METHODS.some(method => typeof apiClient[method] !== 'function')) {
    fail('CAPABILITY_HOST_API_CLIENT_INVALID');
  }
  if (typeof openArtifact !== 'function') fail('CAPABILITY_HOST_ARTIFACT_OPENER_REQUIRED');
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60000
    || typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    fail('CAPABILITY_HOST_POLLING_INVALID');
  }

  const listeners = new Set();
  const fingerprints = new Map();
  let sequence = 0;
  let timer = null;
  let disposed = false;
  let polling = false;

  const profileValue = () => clone(hostProfile);
  const snapshot = async () => unwrap(await apiClient.getCapabilityHostSnapshot(
    agentUserId, profileValue()));
  const poll = async () => {
    if (disposed || polling || listeners.size === 0) return;
    polling = true;
    try {
      const current = await snapshot();
      for (const run of current?.runs ?? []) {
        const fingerprint = runFingerprint(run);
        if (fingerprints.get(run.runId) === fingerprint) continue;
        fingerprints.set(run.runId, fingerprint);
        const event = { schemaVersion: 'capability-host-event-v1', sequence: ++sequence,
          emittedAt: new Date().toISOString(), run: clone(run) };
        for (const listener of listeners) listener(event);
      }
    } catch {
      // Authentication refresh and retry live in the shared API client. A polling failure must not
      // stop a background run or erase the last known state; the next tick retries recovery.
    } finally {
      polling = false;
      if (!disposed && listeners.size > 0) timer = setTimer(poll, pollIntervalMs);
    }
  };
  const start = () => {
    if (!disposed && listeners.size > 0 && timer === null && !polling) {
      timer = setTimer(() => { timer = null; void poll(); }, 0);
    }
  };
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

  const request = async (operation, payload) => {
    if (disposed) fail('CAPABILITY_HOST_TRANSPORT_DISPOSED');
    if (operation === CAPABILITY_HOST_OPERATIONS.snapshot) return snapshot();
    if (operation === CAPABILITY_HOST_OPERATIONS.submit) return unwrap(
      await apiClient.submitCapabilityHostRun(agentUserId, profileValue(), clone(payload)));
    if (operation === CAPABILITY_HOST_OPERATIONS.get) return unwrap(
      await apiClient.getCapabilityHostRun(agentUserId, payload.runId, profileValue()));
    if (operation === CAPABILITY_HOST_OPERATIONS.cancel) return unwrap(
      await apiClient.cancelCapabilityHostRun(agentUserId, payload.runId, profileValue()));
    if (operation === CAPABILITY_HOST_OPERATIONS.artifacts) return unwrap(
      await apiClient.listCapabilityHostRunArtifacts(agentUserId, payload.runId, profileValue()));
    if (operation === CAPABILITY_HOST_OPERATIONS.openArtifact) {
      const directive = normalizeCapabilityArtifactOpenDirectiveV1(unwrap(
        await apiClient.getCapabilityHostArtifactOpenDirective(
          agentUserId, payload.artifactId, profileValue())), payload.artifactId);
      const artifact = unwrap(await apiClient.getCapabilityHostArtifactContent(
        agentUserId, payload.artifactId, profileValue()));
      const verified = await verifyCapabilityArtifactOpenPayload({ directive, artifact });
      const result = await openArtifact(verified);
      if (result?.opened === true) return { opened: true, cancelled: false };
      if (result?.opened === false && result?.cancelled === true) {
        return { opened: false, cancelled: true };
      }
      fail('CAPABILITY_HOST_ARTIFACT_OPEN_FAILED');
    }
    fail('CAPABILITY_HOST_OPERATION_UNSUPPORTED');
  };

  const subscribe = listener => {
    if (disposed || typeof listener !== 'function') fail('CAPABILITY_HOST_LISTENER_INVALID');
    listeners.add(listener); start();
    return () => { listeners.delete(listener); if (listeners.size === 0) stop(); };
  };
  const dispose = () => { disposed = true; stop(); listeners.clear(); fingerprints.clear(); };

  return Object.freeze({ request, subscribe, dispose });
}
