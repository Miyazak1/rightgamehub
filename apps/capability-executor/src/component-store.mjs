import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { normalizeCapabilityComponentRelease } from './component-update-catalog.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,119}$/u;
const ID = /^[a-z][a-z0-9._-]{2,119}$/u;
const ROLES = new Set(['pdf-renderer', 'layout-model', 'ocr-detection-model',
  'ocr-recognition-model', 'table-model', 'formula-model']);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${crypto
  .createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeComponent(value) {
  if (!exact(value, ['componentId', 'role', 'version', 'sha256', 'sizeBytes'])
    || !ID.test(value.componentId) || !ROLES.has(value.role) || !VERSION.test(value.version)
    || !SHA256.test(value.sha256) || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes < 1 || value.sizeBytes > 20 * 1024 ** 3) {
    fail('CAPABILITY_COMPONENT_IDENTITY_INVALID');
  }
  return structuredClone(value);
}

function componentFromRelease(release) {
  return { componentId: release.componentId, role: release.role,
    version: release.componentVersion, sha256: release.download.sha256,
    sizeBytes: release.download.sizeBytes };
}

async function renameWithWindowsRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try { await fs.promises.rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code) || attempt >= 7) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(25 * 2 ** attempt, 400)));
    }
  }
}

async function atomicJson(file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, json(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { await renameWithWindowsRetry(temporary, file); }
  catch (error) { await fs.promises.rm(temporary, { force: true }).catch(() => {}); throw error; }
}

const processIsAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
};

async function withLock(lockFile, staleAfterMs, operation) {
  await fs.promises.mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 2 && !handle; attempt += 1) {
    try { handle = await fs.promises.open(lockFile, 'wx', 0o600); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let state = null, stats = null;
      try {
        state = JSON.parse(await fs.promises.readFile(lockFile, 'utf8'));
        stats = await fs.promises.stat(lockFile);
      } catch {}
      if (attempt === 0 && stats && Date.now() - stats.mtimeMs >= staleAfterMs
        && !processIsAlive(Number(state?.pid))) {
        await fs.promises.unlink(lockFile).catch(unlinkError => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        });
        continue;
      }
      fail('CAPABILITY_COMPONENT_STORE_BUSY', { retryable: true, safeFailure: true });
    }
  }
  try {
    await handle.writeFile(json({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await fs.promises.unlink(lockFile).catch(() => {});
  }
}

export function createCapabilityComponentStore({ rootDirectory,
  quotaBytes = 20 * 1024 ** 3, lockStaleAfterMs = 10 * 60_000 } = {}) {
  if (!path.isAbsolute(rootDirectory) || !Number.isSafeInteger(quotaBytes) || quotaBytes < 1
    || quotaBytes > 100 * 1024 ** 3 || !Number.isSafeInteger(lockStaleAfterMs)
    || lockStaleAfterMs < 60_000) fail('CAPABILITY_COMPONENT_STORE_CONFIG_INVALID');
  const componentsRoot = path.join(rootDirectory, 'components');
  const stateRoot = path.join(rootDirectory, 'component-state');
  const stagingRoot = path.join(rootDirectory, '.component-staging');
  const storeLock = path.join(stateRoot, 'store.lock');
  const contained = candidate => candidate.startsWith(`${path.resolve(componentsRoot)}${path.sep}`);
  const installDirectoryFor = component => path.join(componentsRoot,
    safeSegment(component.componentId), safeSegment(component.version), component.sha256);
  const stateFileFor = componentId => path.join(stateRoot, safeSegment(componentId), 'active.json');

  const validateInstalledDirectory = async (directory, expected = null,
    { allowStaging = false } = {}) => {
    const resolved = path.resolve(directory);
    if (!contained(resolved) && !(allowStaging
      && resolved.startsWith(`${path.resolve(stagingRoot)}${path.sep}`))) {
      fail('CAPABILITY_COMPONENT_STORE_PATH_INVALID');
    }
    const directoryStats = await fs.promises.lstat(resolved).catch(() => null);
    if (!directoryStats?.isDirectory() || directoryStats.isSymbolicLink()) {
      fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
    }
    const names = await fs.promises.readdir(resolved);
    if (names.length !== 2 || !names.includes('component.bin') || !names.includes('component.json')) {
      fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
    }
    const binary = path.join(resolved, 'component.bin');
    const metadataFile = path.join(resolved, 'component.json');
    const [binaryStats, metadataStats] = await Promise.all([
      fs.promises.lstat(binary).catch(() => null), fs.promises.lstat(metadataFile).catch(() => null),
    ]);
    if (!binaryStats?.isFile() || binaryStats.isSymbolicLink() || !metadataStats?.isFile()
      || metadataStats.isSymbolicLink() || metadataStats.size > 64 * 1024) {
      fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
    }
    let metadata;
    try { metadata = JSON.parse(await fs.promises.readFile(metadataFile, 'utf8')); }
    catch { fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID'); }
    if (!exact(metadata, ['schemaVersion', 'component'])
      || metadata.schemaVersion !== 'capability-component-install-v1') {
      fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
    }
    const component = normalizeComponent(metadata.component);
    if (binaryStats.size !== component.sizeBytes || await sha256(binary) !== component.sha256
      || !allowStaging && path.basename(resolved) !== component.sha256) {
      fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
    }
    if (expected && Object.keys(component).some(key => component[key] !== expected[key])) {
      fail('CAPABILITY_COMPONENT_IDENTITY_MISMATCH');
    }
    return { component, absolutePath: binary, directory: resolved };
  };

  const listInstalled = async () => {
    const result = [];
    const componentDirectories = await fs.promises.readdir(componentsRoot,
      { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const componentEntry of componentDirectories) {
      if (!componentEntry.isDirectory() || componentEntry.isSymbolicLink()) {
        fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
      }
      const componentDirectory = path.join(componentsRoot, componentEntry.name);
      for (const versionEntry of await fs.promises.readdir(componentDirectory, { withFileTypes: true })) {
        if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) {
          fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
        }
        const versionDirectory = path.join(componentDirectory, versionEntry.name);
        for (const digestEntry of await fs.promises.readdir(versionDirectory, { withFileTypes: true })) {
          if (!digestEntry.isDirectory() || digestEntry.isSymbolicLink()
            || !SHA256.test(digestEntry.name)) fail('CAPABILITY_COMPONENT_INSTALLATION_INVALID');
          result.push(await validateInstalledDirectory(path.join(versionDirectory, digestEntry.name)));
        }
      }
    }
    return result;
  };

  const loadState = async componentId => {
    const stateFile = stateFileFor(componentId);
    let parsed;
    try { parsed = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return { stateFile, state: null };
      fail('CAPABILITY_COMPONENT_STATE_INVALID');
    }
    if (!exact(parsed, ['schemaVersion', 'active', 'previous'])
      || parsed.schemaVersion !== 'capability-component-state-v1'
      || parsed.active?.componentId !== componentId) fail('CAPABILITY_COMPONENT_STATE_INVALID');
    return { stateFile, state: parsed };
  };

  const resolveStateEntry = async entry => {
    const component = normalizeComponent(entry);
    return validateInstalledDirectory(installDirectoryFor(component), component);
  };

  const install = async ({ release, sourceFile } = {}) => {
    const normalizedRelease = normalizeCapabilityComponentRelease(release);
    const component = componentFromRelease(normalizedRelease);
    if (!path.isAbsolute(sourceFile)) fail('CAPABILITY_COMPONENT_SOURCE_INVALID');
    const sourceStats = await fs.promises.lstat(sourceFile).catch(() => null);
    if (!sourceStats?.isFile() || sourceStats.isSymbolicLink()
      || sourceStats.size !== component.sizeBytes || await sha256(sourceFile) !== component.sha256) {
      fail('CAPABILITY_COMPONENT_SOURCE_INVALID', { safeFailure: true });
    }
    return withLock(storeLock, lockStaleAfterMs, async () => {
      const installDirectory = installDirectoryFor(component);
      const exists = await fs.promises.stat(installDirectory).then(item => item.isDirectory()).catch(() => false);
      if (exists) await validateInstalledDirectory(installDirectory, component);
      else {
        const installed = await listInstalled();
        const usedBytes = installed.reduce((sum, item) => sum + item.component.sizeBytes, 0);
        if (usedBytes + component.sizeBytes > quotaBytes) {
          fail('CAPABILITY_COMPONENT_QUOTA_EXCEEDED', { safeFailure: true });
        }
        const staging = path.join(stagingRoot, crypto.randomUUID());
        try {
          await fs.promises.mkdir(staging, { recursive: true });
          await fs.promises.copyFile(sourceFile, path.join(staging, 'component.bin'),
            fs.constants.COPYFILE_EXCL);
          await fs.promises.writeFile(path.join(staging, 'component.json'), json({
            schemaVersion: 'capability-component-install-v1', component,
          }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await validateInstalledDirectory(staging, component, { allowStaging: true });
          await fs.promises.mkdir(path.dirname(installDirectory), { recursive: true });
          await renameWithWindowsRetry(staging, installDirectory);
        } finally { await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {}); }
        await validateInstalledDirectory(installDirectory, component);
      }
      const loaded = await loadState(component.componentId);
      if (loaded.state) {
        await resolveStateEntry(loaded.state.active);
        if (loaded.state.previous) await resolveStateEntry(loaded.state.previous);
      }
      const previous = loaded.state?.active?.sha256 !== component.sha256
        ? loaded.state?.active ?? null : loaded.state?.previous ?? null;
      await atomicJson(loaded.stateFile, { schemaVersion: 'capability-component-state-v1',
        active: component, previous });
      const resolved = await validateInstalledDirectory(installDirectory, component);
      return { component, absolutePath: resolved.absolutePath,
        existing: exists || loaded.state?.active?.sha256 === component.sha256 };
    });
  };

  const resolve = async value => {
    const component = normalizeComponent(value), loaded = await loadState(component.componentId);
    if (!loaded.state || Object.keys(component).some(key => loaded.state.active[key] !== component[key])) {
      return null;
    }
    const resolved = await resolveStateEntry(loaded.state.active);
    return { component, absolutePath: resolved.absolutePath };
  };

  const inventory = async () => {
    const installed = await listInstalled(), activeSha256s = new Set();
    const stateEntries = await fs.promises.readdir(stateRoot,
      { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const entry of stateEntries) {
      if (entry.name === 'store.lock') continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('CAPABILITY_COMPONENT_STATE_INVALID');
      const stateFile = path.join(stateRoot, entry.name, 'active.json');
      let state;
      try { state = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); }
      catch { fail('CAPABILITY_COMPONENT_STATE_INVALID'); }
      if (state?.schemaVersion !== 'capability-component-state-v1') {
        fail('CAPABILITY_COMPONENT_STATE_INVALID');
      }
      activeSha256s.add(normalizeComponent(state.active).sha256);
    }
    const entries = installed.map(item => ({ ...item.component,
      active: activeSha256s.has(item.component.sha256) }));
    return { quotaBytes, usedBytes: entries.reduce((sum, item) => sum + item.sizeBytes, 0), entries };
  };

  const protectedSha256s = async retain => {
    if (!Array.isArray(retain) || retain.length > 4096) fail('CAPABILITY_COMPONENT_RETAIN_INVALID');
    const protectedSet = new Set(retain.map(item => normalizeComponent(item).sha256));
    const stateEntries = await fs.promises.readdir(stateRoot,
      { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const entry of stateEntries) {
      if (entry.name === 'store.lock') continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('CAPABILITY_COMPONENT_STATE_INVALID');
      let state;
      try { state = JSON.parse(await fs.promises.readFile(path.join(stateRoot, entry.name,
        'active.json'), 'utf8')); } catch { fail('CAPABILITY_COMPONENT_STATE_INVALID'); }
      if (state?.schemaVersion !== 'capability-component-state-v1') {
        fail('CAPABILITY_COMPONENT_STATE_INVALID');
      }
      protectedSet.add(normalizeComponent(state.active).sha256);
      if (state.previous) protectedSet.add(normalizeComponent(state.previous).sha256);
    }
    return protectedSet;
  };

  const pruneUnused = async ({ retain = [] } = {}) => withLock(storeLock, lockStaleAfterMs, async () => {
    const protectedSet = await protectedSha256s(retain), installed = await listInstalled();
    let reclaimedBytes = 0;
    const removed = [];
    for (const item of installed) {
      if (protectedSet.has(item.component.sha256)) continue;
      await fs.promises.rm(item.directory, { recursive: true, force: false });
      reclaimedBytes += item.component.sizeBytes;
      removed.push({ ...item.component });
    }
    return { reclaimedBytes, removed };
  });

  const remove = async value => {
    const component = normalizeComponent(value);
    return withLock(storeLock, lockStaleAfterMs, async () => {
      const protectedSet = await protectedSha256s([]);
      if (protectedSet.has(component.sha256)) {
        fail('CAPABILITY_COMPONENT_IN_USE', { safeFailure: true });
      }
      const directory = installDirectoryFor(component);
      const stats = await fs.promises.lstat(directory).catch(error => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (!stats) return { removed: false, reclaimedBytes: 0 };
      await validateInstalledDirectory(directory, component);
      await fs.promises.rm(directory, { recursive: true, force: false });
      return { removed: true, reclaimedBytes: component.sizeBytes };
    });
  };

  return { install, resolve, inventory, pruneUnused, remove };
}
