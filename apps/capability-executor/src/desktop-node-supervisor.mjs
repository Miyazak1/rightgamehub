import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { createDesktopNodeStateStore } from './desktop-node-state.mjs';

const TRANSIENT_CODES = new Set(['CAPABILITY_RUNTIME_UPDATE_CATALOG_FETCH_FAILED',
  'CAPABILITY_PACKAGE_DOWNLOAD_FAILED', 'CAPABILITY_NODE_API_HTTP_429',
  'CAPABILITY_NODE_API_HTTP_500', 'CAPABILITY_NODE_API_HTTP_502',
  'CAPABILITY_NODE_API_HTTP_503', 'CAPABILITY_NODE_API_HTTP_504']);
const FATAL_CODES = new Set(['CAPABILITY_NODE_SESSION_REFRESH_UNCERTAIN',
  'CAPABILITY_NODE_SESSION_INVALID', 'CAPABILITY_DESKTOP_NODE_STATE_INVALID',
  'CAPABILITY_RUNTIME_UPDATE_STATE_INVALID', 'CAPABILITY_RUNTIME_UPDATE_JOURNAL_INVALID',
  'CAPABILITY_RUNTIME_UPDATE_CATALOG_ROLLBACK', 'CAPABILITY_RUNTIME_UPDATE_CATALOG_EQUIVOCATION',
  'CAPABILITY_RUNTIME_UPDATE_RELEASE_ROLLBACK', 'CAPABILITY_RUNTIME_UPDATE_RELEASE_EQUIVOCATION']);

const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); },
    { once: true });
});
const processIsAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
};

async function acquireLock(file, staleAfterMs, now, pid) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { handle = await fs.promises.open(file, 'wx', 0o600); break; }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const value = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        const stats = await fs.promises.stat(file);
        stale = now().getTime() - stats.mtimeMs >= staleAfterMs && !processIsAlive(Number(value.pid));
      } catch {}
      if (!stale || attempt > 0) fail('CAPABILITY_DESKTOP_NODE_ALREADY_RUNNING',
        { safeFailure: true });
      await fs.promises.rm(file, { force: true });
    }
  }
  if (!handle) fail('CAPABILITY_DESKTOP_NODE_ALREADY_RUNNING', { safeFailure: true });
  await handle.writeFile(`${JSON.stringify({ schemaVersion: 'capability-desktop-node-lock-v1',
    pid, createdAt: now().toISOString() })}\n`);
  return async () => {
    await handle.close().catch(() => {});
    await fs.promises.rm(file, { force: true }).catch(() => {});
  };
}

export function createDesktopNodeSupervisor({ rootDirectory, runtimeUpdater, bootstrap, apiClient,
  resources, metadata = {}, stateStore = null, now = () => new Date(), random = Math.random,
  sleep = delay, pid = process.pid, pollIntervalMs = 10_000, heartbeatIntervalMs = 60_000,
  updateIntervalMs = 6 * 60 * 60_000, lockStaleAfterMs = 10 * 60_000,
  initialBackoffMs = 1000, maximumBackoffMs = 60_000, jitterRatio = 0.2,
  circuitFailureThreshold = 5, circuitCooldownMs = 5 * 60_000 } = {}) {
  if (!path.isAbsolute(rootDirectory) || !runtimeUpdater
    || typeof runtimeUpdater.recover !== 'function' || typeof runtimeUpdater.checkAndApply !== 'function'
    || !bootstrap || typeof bootstrap.assemble !== 'function' || !apiClient
    || typeof apiClient.heartbeat !== 'function' || !resources || typeof resources !== 'object'
    || !metadata || typeof metadata !== 'object' || typeof now !== 'function'
    || typeof random !== 'function' || typeof sleep !== 'function' || !Number.isSafeInteger(pid)
    || ![pollIntervalMs, heartbeatIntervalMs, updateIntervalMs, lockStaleAfterMs, initialBackoffMs,
      maximumBackoffMs, circuitFailureThreshold, circuitCooldownMs].every(Number.isSafeInteger)
    || pollIntervalMs < 50 || heartbeatIntervalMs < 50 || updateIntervalMs < 50
    || lockStaleAfterMs < 1000 || initialBackoffMs < 10 || maximumBackoffMs < initialBackoffMs
    || circuitFailureThreshold < 2 || circuitCooldownMs < 100 || jitterRatio < 0 || jitterRatio > 1) {
    fail('CAPABILITY_DESKTOP_NODE_CONFIG_INVALID');
  }
  stateStore ??= createDesktopNodeStateStore({ rootDirectory, now });
  const lockFile = path.join(stateStore.stateDirectory, 'supervisor.lock');
  let stopRequested = false, paused = false, runtime = null, runtimeRelease = null;
  let generation = 0, consecutiveFailures = 0, lastHeartbeatAt = 0, lastUpdateAt = 0;
  let lastOutcome = null, nextAttemptAt = null, circuitOpenUntil = null, startedAt = null;

  const status = async state => stateStore.writeStatus({ state, generation, pid, paused,
    startedAt, runtime: runtimeRelease, consecutiveFailures, lastOutcome,
    nextAttemptAt, circuitOpenUntil });
  const event = (type, code = null, attempt = null, state = null) => stateStore.appendEvent({
    type, code, attempt, state }).catch(() => {});
  const heartbeat = async force => {
    const current = now().getTime();
    if (!force && current - lastHeartbeatAt < heartbeatIntervalMs) return;
    await apiClient.heartbeat({ resources: structuredClone(resources), metadata: {
      ...structuredClone(metadata), supervisor: { schemaVersion: 'capability-desktop-node-heartbeat-v1',
        generation, state: paused ? 'paused' : 'online', runtime: runtimeRelease } } });
    lastHeartbeatAt = current;
  };
  const consumeControl = async () => {
    const control = await stateStore.consumeControl();
    if (!control) return;
    if (control.command === 'pause') paused = true;
    if (control.command === 'resume') paused = false;
    if (control.command === 'stop') stopRequested = true;
    await event('control-consumed', null, null, paused ? 'paused' : 'ready');
  };
  const assemble = async () => {
    const assembled = await bootstrap.assemble();
    if (!assembled?.runtime || typeof assembled.runtime.runOnce !== 'function'
      || typeof assembled.runtime.recover !== 'function') fail('CAPABILITY_DESKTOP_NODE_BOOTSTRAP_INVALID');
    runtime = assembled.runtime;
    runtimeRelease = assembled.release ? {
      runtimeId: assembled.release.runtimeId, runtimeVersion: assembled.release.runtimeVersion,
      manifestSha256: assembled.release.manifestSha256,
    } : null;
  };
  const updateAndAssemble = async force => {
    const current = now().getTime();
    if (!force && current - lastUpdateAt < updateIntervalMs) return false;
    await status('checking-update');
    const update = await runtimeUpdater.checkAndApply();
    lastUpdateAt = current;
    if (!runtime || update?.status === 'updated' || update?.status === 'commit-recovered') {
      await assemble();
      return true;
    }
    return false;
  };
  const backoffMs = attempt => {
    const base = Math.min(maximumBackoffMs, initialBackoffMs * 2 ** Math.max(0, attempt - 1));
    const factor = 1 + (random() * 2 - 1) * jitterRatio;
    return Math.max(10, Math.round(base * factor));
  };
  const isFatal = error => FATAL_CODES.has(error?.code)
    || error?.safeFailure === true && error?.retryable !== true
    && !TRANSIENT_CODES.has(error?.code) && !String(error?.code ?? '').startsWith('CAPABILITY_NODE_API_HTTP_5');

  const run = async ({ signal, maximumCycles = Number.POSITIVE_INFINITY } = {}) => {
    if (!(maximumCycles === Number.POSITIVE_INFINITY
      || Number.isSafeInteger(maximumCycles) && maximumCycles > 0)) {
      fail('CAPABILITY_DESKTOP_NODE_CYCLE_LIMIT_INVALID');
    }
    const releaseLock = await acquireLock(lockFile, lockStaleAfterMs, now, pid);
    generation = (await stateStore.readStatus().catch(() => null))?.generation + 1 || 1;
    startedAt = now().toISOString();
    await status('starting');
    await event('supervisor-started', null, null, 'starting');
    let cycles = 0;
    try {
      await status('recovering');
      await runtimeUpdater.recover();
      await updateAndAssemble(true);
      const recovered = await runtime.recover();
      if (recovered) lastOutcome = recovered.status;
      await heartbeat(true);
      await status('ready');
      while (!stopRequested && !signal?.aborted && cycles < maximumCycles) {
        await consumeControl();
        if (stopRequested) break;
        if (paused) {
          await status('paused');
          await heartbeat(false);
          await sleep(pollIntervalMs, signal);
          continue;
        }
        if (circuitOpenUntil && now().getTime() < new Date(circuitOpenUntil).getTime()) {
          await status('circuit-open');
          await heartbeat(false).catch(() => {});
          await sleep(Math.min(pollIntervalMs,
            new Date(circuitOpenUntil).getTime() - now().getTime()), signal);
          continue;
        }
        circuitOpenUntil = null;
        try {
          await updateAndAssemble(false);
          await heartbeat(false);
          await status('running');
          const outcome = await runtime.runOnce();
          cycles += 1;
          lastOutcome = outcome?.status ?? 'unknown';
          consecutiveFailures = 0;
          nextAttemptAt = null;
          await event('cycle-completed', null, cycles, 'ready');
          await status('ready');
          if (outcome?.status === 'idle') await sleep(pollIntervalMs, signal);
        } catch (error) {
          cycles += 1;
          consecutiveFailures += 1;
          lastOutcome = 'failed';
          await event('cycle-failed', error?.code ?? 'CAPABILITY_DESKTOP_NODE_CYCLE_FAILED',
            consecutiveFailures, 'backoff');
          if (isFatal(error)) {
            paused = true;
            await status('paused');
            continue;
          }
          if (consecutiveFailures >= circuitFailureThreshold) {
            circuitOpenUntil = new Date(now().getTime() + circuitCooldownMs).toISOString();
            nextAttemptAt = circuitOpenUntil;
            await status('circuit-open');
            continue;
          }
          const wait = backoffMs(consecutiveFailures);
          nextAttemptAt = new Date(now().getTime() + wait).toISOString();
          await status('backoff');
          await sleep(wait, signal);
        }
      }
      await status('stopping');
      await event('supervisor-stopping', null, null, 'stopping');
      await status('stopped');
      return { status: 'stopped', cycles, lastOutcome };
    } catch (error) {
      if (signal?.aborted || stopRequested) {
        await status('stopped').catch(() => {});
        return { status: 'stopped', cycles, lastOutcome };
      }
      lastOutcome = 'failed';
      await event('supervisor-failed', error?.code ?? 'CAPABILITY_DESKTOP_NODE_FAILED', null, 'failed');
      await status('failed').catch(() => {});
      throw error;
    } finally { await releaseLock(); }
  };

  return { run, stateStore };
}
