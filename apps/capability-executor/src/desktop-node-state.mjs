import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';

const STATES = new Set(['starting', 'recovering', 'checking-update', 'ready', 'running',
  'backoff', 'paused', 'circuit-open', 'stopping', 'stopped', 'failed']);
const COMMANDS = new Set(['pause', 'resume', 'stop']);

const iso = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('CAPABILITY_DESKTOP_NODE_STATE_INVALID');
  return date.toISOString();
};

const atomicJson = async (file, value) => {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  try {
    for (let attempt = 0;; attempt += 1) {
      try { await fs.promises.rename(temporary, file); break; }
      catch (error) {
        if (!['EPERM', 'EACCES'].includes(error?.code) || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
};

export function createDesktopNodeStateStore({ rootDirectory, now = () => new Date() } = {}) {
  if (!path.isAbsolute(rootDirectory) || typeof now !== 'function') {
    fail('CAPABILITY_DESKTOP_NODE_STATE_CONFIG_INVALID');
  }
  const stateDirectory = path.join(rootDirectory, 'desktop-node');
  const statusFile = path.join(stateDirectory, 'status.json');
  const controlDirectory = path.join(stateDirectory, 'control');
  const eventFile = path.join(stateDirectory, 'events.ndjson');

  const writeStatus = async input => {
    if (!STATES.has(input?.state) || !Number.isSafeInteger(input?.generation)
      || input.generation < 1 || !Number.isSafeInteger(input?.pid) || input.pid < 1) {
      fail('CAPABILITY_DESKTOP_NODE_STATE_INVALID');
    }
    const value = { schemaVersion: 'capability-desktop-node-status-v1', ...input,
      updatedAt: iso(input.updatedAt ?? now()) };
    await atomicJson(statusFile, value);
    return value;
  };

  const readStatus = async () => {
    let value;
    try { value = JSON.parse(await fs.promises.readFile(statusFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail('CAPABILITY_DESKTOP_NODE_STATE_INVALID');
    }
    if (value?.schemaVersion !== 'capability-desktop-node-status-v1'
      || !STATES.has(value.state) || !Number.isSafeInteger(value.generation)) {
      fail('CAPABILITY_DESKTOP_NODE_STATE_INVALID');
    }
    return value;
  };

  const requestControl = async command => {
    if (!COMMANDS.has(command)) fail('CAPABILITY_DESKTOP_NODE_CONTROL_INVALID');
    const value = { schemaVersion: 'capability-desktop-node-control-v1',
      requestId: crypto.randomUUID(), command, requestedAt: iso(now()) };
    await atomicJson(path.join(controlDirectory, `${value.requestedAt.replace(/[:.]/gu, '-')}-${value.requestId}.json`), value);
    return value;
  };

  const consumeControl = async () => {
    let files;
    try { files = (await fs.promises.readdir(controlDirectory)).filter(file => file.endsWith('.json')).sort(); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    if (files.length < 1) return null;
    const controls = [];
    for (const file of files) {
      let value;
      try { value = JSON.parse(await fs.promises.readFile(path.join(controlDirectory, file), 'utf8')); }
      catch { fail('CAPABILITY_DESKTOP_NODE_CONTROL_INVALID'); }
      if (value?.schemaVersion !== 'capability-desktop-node-control-v1'
        || typeof value.requestId !== 'string' || !COMMANDS.has(value.command)) {
        fail('CAPABILITY_DESKTOP_NODE_CONTROL_INVALID');
      }
      controls.push(value);
    }
    await Promise.all(files.map(file => fs.promises.rm(path.join(controlDirectory, file), { force: true })));
    return controls.find(value => value.command === 'stop') ?? controls.at(-1);
  };

  const appendEvent = async input => {
    const value = { schemaVersion: 'capability-desktop-node-event-v1',
      eventId: crypto.randomUUID(), occurredAt: iso(now()), type: String(input?.type ?? '').slice(0, 80),
      code: input?.code == null ? null : String(input.code).replace(/[^A-Z0-9_]/gu, '_').slice(0, 120),
      state: STATES.has(input?.state) ? input.state : null,
      attempt: Number.isSafeInteger(input?.attempt) ? input.attempt : null };
    if (!value.type) fail('CAPABILITY_DESKTOP_NODE_EVENT_INVALID');
    await fs.promises.mkdir(stateDirectory, { recursive: true });
    await fs.promises.appendFile(eventFile, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    const stats = await fs.promises.stat(eventFile);
    if (stats.size > 1024 * 1024) {
      const lines = (await fs.promises.readFile(eventFile, 'utf8')).trim().split('\n').slice(-1000);
      await fs.promises.writeFile(eventFile, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    return value;
  };

  const readEvents = async (limit = 200) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      fail('CAPABILITY_DESKTOP_NODE_DIAGNOSTICS_LIMIT_INVALID');
    }
    let raw;
    try { raw = await fs.promises.readFile(eventFile, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    return raw.trim().split('\n').filter(Boolean).slice(-limit).map(line => {
      try { return JSON.parse(line); } catch { return { schemaVersion: 'capability-desktop-node-event-v1',
        type: 'event-corrupt', code: 'CAPABILITY_DESKTOP_NODE_EVENT_INVALID' }; }
    });
  };

  return { stateDirectory, statusFile, controlDirectory, eventFile, writeStatus, readStatus,
    requestControl, consumeControl, appendEvent, readEvents };
}

export function redactDesktopNodeStatus(status) {
  return status && {
    schemaVersion: status.schemaVersion, state: status.state, generation: status.generation,
    pid: status.pid, paused: status.paused === true, runtime: status.runtime ?? null,
    consecutiveFailures: status.consecutiveFailures ?? 0, lastOutcome: status.lastOutcome ?? null,
    nextAttemptAt: status.nextAttemptAt ?? null, circuitOpenUntil: status.circuitOpenUntil ?? null,
    startedAt: status.startedAt ?? null, updatedAt: status.updatedAt ?? null,
  };
}

export async function readDesktopNodeDiagnostics({ stateStore, limit = 200,
  now = () => new Date() } = {}) {
  if (!stateStore || typeof stateStore.readStatus !== 'function'
    || typeof stateStore.readEvents !== 'function') {
    fail('CAPABILITY_DESKTOP_NODE_DIAGNOSTICS_CONFIG_INVALID');
  }
  const status = await stateStore.readStatus();
  const safeStatus = redactDesktopNodeStatus(status);
  return { schemaVersion: 'capability-desktop-node-diagnostics-v1',
    exportedAt: iso(now()), status: safeStatus, events: await stateStore.readEvents(limit) };
}

export async function exportDesktopNodeDiagnostics({ stateStore, destination, limit = 200,
  now = () => new Date() } = {}) {
  if (!path.isAbsolute(destination)) fail('CAPABILITY_DESKTOP_NODE_DIAGNOSTICS_CONFIG_INVALID');
  const report = await readDesktopNodeDiagnostics({ stateStore, limit, now });
  await atomicJson(destination, report);
  return report;
}
