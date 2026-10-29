import { normalizeCapabilityHostRunV1 } from './capability-execution.mjs';

const ACTIVE = new Set(['awaiting-consent', 'queued', 'installing', 'running']);

const clone = value => structuredClone(value);
const fail = code => { const error = new Error(code); error.name = 'CapabilityTaskSurfaceError';
  error.code = code; error.retryable = false; throw error; };
const errorCode = error => typeof error?.code === 'string' && error.code.length
  ? error.code : 'CAPABILITY_TASK_SURFACE_UNAVAILABLE';

function task(run, profile) {
  run = normalizeCapabilityHostRunV1(run);
  return {
    ...run,
    active: ACTIVE.has(run.state),
    actions: {
      canCancel: profile.features.cancel && ACTIVE.has(run.state),
      canListArtifacts: profile.features.artifacts && run.state === 'succeeded'
        && run.artifactCount > 0,
    },
  };
}

function ordered(values) {
  return [...values].sort((left, right) => {
    const activity = Number(right.active) - Number(left.active);
    if (activity) return activity;
    const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return updated || right.runId.localeCompare(left.runId);
  });
}

export function createCapabilityTaskSurface({ client, clock = () => new Date() } = {}) {
  if (!client || typeof client.snapshot !== 'function' || typeof client.cancel !== 'function'
    || typeof client.artifacts !== 'function' || typeof client.openArtifact !== 'function'
    || typeof client.subscribe !== 'function' || !client.profile) {
    fail('CAPABILITY_TASK_SURFACE_CLIENT_REQUIRED');
  }
  const profile = clone(client.profile);
  const listeners = new Set();
  const runs = new Map();
  let status = 'idle';
  let lastError = null;
  let updatedAt = null;
  let unsubscribe = null;
  let disposed = false;
  let refreshPromise = null;
  let liveRevision = 0;

  const snapshot = () => {
    const tasks = ordered(runs.values());
    return clone({
      schemaVersion: 'capability-task-surface-v1',
      status,
      host: profile.host,
      surface: profile.surface,
      tasks,
      activeCount: tasks.filter(item => item.active).length,
      completedCount: tasks.filter(item => !item.active).length,
      updatedAt,
      errorCode: lastError,
    });
  };
  const emit = () => { const value = snapshot(); for (const listener of listeners) listener(value); };
  const mergeTask = next => {
    const previous = runs.get(next.runId);
    if (previous && Date.parse(next.updatedAt) <= Date.parse(previous.updatedAt)) return false;
    runs.set(next.runId, next); updatedAt = clock().toISOString(); lastError = null;
    if (status !== 'loading') status = 'ready';
    return true;
  };
  const merge = value => mergeTask(task(value, profile));
  const refresh = async () => {
    if (disposed) fail('CAPABILITY_TASK_SURFACE_DISPOSED');
    if (refreshPromise) return refreshPromise;
    const refreshRevision = liveRevision;
    status = 'loading'; lastError = null; emit();
    refreshPromise = (async () => {
      try {
        const remote = await client.snapshot();
        const next = new Map();
        for (const run of remote.runs) {
          const item = task(run, profile); next.set(item.runId, item);
        }
        if (liveRevision === refreshRevision) {
          runs.clear();
          for (const [id, value] of next) runs.set(id, value);
        } else {
          for (const value of next.values()) mergeTask(value);
        }
        status = 'ready'; updatedAt = clock().toISOString(); lastError = null; emit();
        return snapshot();
      } catch (error) {
        status = 'error'; lastError = errorCode(error); updatedAt = clock().toISOString(); emit();
        throw error;
      } finally { refreshPromise = null; }
    })();
    return refreshPromise;
  };
  const start = async () => {
    if (disposed) fail('CAPABILITY_TASK_SURFACE_DISPOSED');
    if (!unsubscribe) unsubscribe = client.subscribe(event => {
      liveRevision += 1;
      if (merge(event.run)) emit();
    });
    return refresh();
  };
  const cancel = async runId => {
    if (disposed) fail('CAPABILITY_TASK_SURFACE_DISPOSED');
    const current = runs.get(runId);
    if (!current || !current.actions.canCancel) fail('CAPABILITY_TASK_SURFACE_CANCEL_UNAVAILABLE');
    const result = await client.cancel(runId); merge(result); emit(); return clone(runs.get(runId));
  };
  const artifacts = async runId => {
    if (disposed) fail('CAPABILITY_TASK_SURFACE_DISPOSED');
    const current = runs.get(runId);
    if (!current || !current.actions.canListArtifacts) {
      fail('CAPABILITY_TASK_SURFACE_ARTIFACTS_UNAVAILABLE');
    }
    return clone(await client.artifacts(runId));
  };
  const openArtifact = async artifactId => {
    if (disposed) fail('CAPABILITY_TASK_SURFACE_DISPOSED');
    return clone(await client.openArtifact(artifactId));
  };
  const subscribe = listener => {
    if (disposed || typeof listener !== 'function') fail('CAPABILITY_TASK_SURFACE_LISTENER_INVALID');
    listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; unsubscribe?.(); unsubscribe = null; listeners.clear();
  };
  return Object.freeze({ getSnapshot: snapshot, subscribe, start, refresh, cancel, artifacts,
    openArtifact, dispose });
}
