import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { normalizeCapabilityComponentRelease } from './component-update-catalog.mjs';
import { extractVerifiedCapabilityComponentBundle,
  verifyInstalledCapabilityComponentBundle } from './component-bundle.mjs';

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

function componentFromRelease(release) {
  return { componentId: release.componentId, role: release.role,
    version: release.componentVersion, sha256: release.download.sha256,
    sizeBytes: release.download.sizeBytes };
}

function normalizeBundleRelease(value) {
  const release = normalizeCapabilityComponentRelease(value, 'capability-component-catalog-v2');
  if (release.content.kind !== 'zip-bundle') {
    fail('CAPABILITY_COMPONENT_BUNDLE_RELEASE_INVALID', { safeFailure: true });
  }
  return release;
}

function sameComponent(left, right) {
  return ['componentId', 'role', 'version', 'sha256', 'sizeBytes']
    .every(key => left?.[key] === right?.[key]);
}

function normalizeComponent(value) {
  if (!exact(value, ['componentId', 'role', 'version', 'sha256', 'sizeBytes'])
    || !ID.test(value.componentId) || !ROLES.has(value.role) || !VERSION.test(value.version)
    || !SHA256.test(value.sha256) || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes < 1 || value.sizeBytes > 20 * 1024 ** 3) {
    fail('CAPABILITY_COMPONENT_BUNDLE_IDENTITY_INVALID', { safeFailure: true });
  }
  return structuredClone(value);
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
      fail('CAPABILITY_COMPONENT_BUNDLE_STORE_BUSY', { retryable: true, safeFailure: true });
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

export function createCapabilityComponentBundleStore({ rootDirectory,
  quotaBytes = 40 * 1024 ** 3, lockStaleAfterMs = 10 * 60_000 } = {}) {
  if (!path.isAbsolute(rootDirectory ?? '') || !Number.isSafeInteger(quotaBytes)
    || quotaBytes < 1 || quotaBytes > 100 * 1024 ** 3
    || !Number.isSafeInteger(lockStaleAfterMs) || lockStaleAfterMs < 60_000) {
    fail('CAPABILITY_COMPONENT_BUNDLE_STORE_CONFIG_INVALID');
  }
  const componentsRoot = path.join(rootDirectory, 'bundle-components');
  const stateRoot = path.join(rootDirectory, 'bundle-component-state');
  const stagingRoot = path.join(rootDirectory, '.bundle-component-staging');
  const storeLock = path.join(stateRoot, 'store.lock');
  const resolvedComponentsRoot = path.resolve(componentsRoot);
  const resolvedStagingRoot = path.resolve(stagingRoot);
  const installDirectoryFor = component => path.join(componentsRoot,
    safeSegment(component.componentId), safeSegment(component.version), component.sha256);
  const stateFileFor = componentId => path.join(stateRoot, safeSegment(componentId), 'active.json');
  const isContained = (candidate, root) => candidate.startsWith(`${root}${path.sep}`);

  const validateInstallation = async (directory, release, { allowStaging = false } = {}) => {
    const resolved = path.resolve(directory);
    if (!isContained(resolved, resolvedComponentsRoot)
      && !(allowStaging && isContained(resolved, resolvedStagingRoot))) {
      fail('CAPABILITY_COMPONENT_BUNDLE_STORE_PATH_INVALID');
    }
    const stats = await fs.promises.lstat(resolved).catch(() => null);
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
      fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID', { safeFailure: true });
    }
    const names = await fs.promises.readdir(resolved);
    if (names.length !== 3 || !names.includes('component.archive')
      || !names.includes('bundle') || !names.includes('install.json')) {
      fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID', { safeFailure: true });
    }
    let metadata;
    try { metadata = JSON.parse(await fs.promises.readFile(path.join(resolved, 'install.json'), 'utf8')); }
    catch { fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID', { safeFailure: true }); }
    if (!exact(metadata, ['schemaVersion', 'release'])
      || metadata.schemaVersion !== 'capability-component-bundle-store-install-v1') {
      fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID', { safeFailure: true });
    }
    const metadataRelease = normalizeBundleRelease(metadata.release);
    const component = componentFromRelease(release);
    if (!sameComponent(componentFromRelease(metadataRelease), component)
      || JSON.stringify(metadataRelease.content) !== JSON.stringify(release.content)
      || !allowStaging && path.basename(resolved) !== component.sha256) {
      fail('CAPABILITY_COMPONENT_BUNDLE_IDENTITY_MISMATCH', { safeFailure: true });
    }
    const verified = await verifyInstalledCapabilityComponentBundle({
      archivePath: path.join(resolved, 'component.archive'),
      bundleDirectory: path.join(resolved, 'bundle'), component, content: release.content,
    });
    return { ...verified, release, directory: resolved,
      archivePath: path.join(resolved, 'component.archive'), absolutePath: verified.rootDirectory };
  };

  const loadState = async componentId => {
    const stateFile = stateFileFor(componentId);
    let state;
    try { state = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return { stateFile, state: null };
      fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID');
    }
    if (!exact(state, ['schemaVersion', 'active', 'previous'])
      || state.schemaVersion !== 'capability-component-bundle-state-v1') {
      fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID');
    }
    return { stateFile, state };
  };

  const releaseFromState = entry => {
    if (!exact(entry, ['release', 'content'])) fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID');
    const release = normalizeBundleRelease({ ...entry.release, content: entry.content });
    return release;
  };

  const stateEntry = release => {
    const { content, ...rest } = release;
    return { release: rest, content };
  };

  const listInstalled = async () => {
    const result = [];
    const componentEntries = await fs.promises.readdir(componentsRoot, { withFileTypes: true })
      .catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const componentEntry of componentEntries) {
      if (!componentEntry.isDirectory() || componentEntry.isSymbolicLink()) {
        fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID');
      }
      const componentDirectory = path.join(componentsRoot, componentEntry.name);
      for (const versionEntry of await fs.promises.readdir(componentDirectory, { withFileTypes: true })) {
        if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) {
          fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID');
        }
        const versionDirectory = path.join(componentDirectory, versionEntry.name);
        for (const digestEntry of await fs.promises.readdir(versionDirectory, { withFileTypes: true })) {
          if (!digestEntry.isDirectory() || digestEntry.isSymbolicLink()
            || !SHA256.test(digestEntry.name)) fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID');
          const directory = path.join(versionDirectory, digestEntry.name);
          let metadata;
          try { metadata = JSON.parse(await fs.promises.readFile(path.join(directory, 'install.json'), 'utf8')); }
          catch { fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID'); }
          if (metadata?.schemaVersion !== 'capability-component-bundle-store-install-v1') {
            fail('CAPABILITY_COMPONENT_BUNDLE_INSTALLATION_INVALID');
          }
          const release = normalizeBundleRelease(metadata.release);
          result.push(await validateInstallation(directory, release));
        }
      }
    }
    return result;
  };

  const install = async ({ release: releaseValue, sourceFile } = {}) => {
    const release = normalizeBundleRelease(releaseValue), component = componentFromRelease(release);
    if (!path.isAbsolute(sourceFile ?? '')) fail('CAPABILITY_COMPONENT_BUNDLE_SOURCE_INVALID');
    return withLock(storeLock, lockStaleAfterMs, async () => {
      const installDirectory = installDirectoryFor(component);
      const exists = await fs.promises.lstat(installDirectory)
        .then(item => item.isDirectory()).catch(error => error?.code === 'ENOENT' ? false : Promise.reject(error));
      if (exists) await validateInstallation(installDirectory, release);
      else {
        const installed = await listInstalled();
        const usedBytes = installed.reduce((sum, item) => sum + item.component.sizeBytes
          + item.content.expandedSizeBytes, 0);
        if (usedBytes + component.sizeBytes + release.content.expandedSizeBytes > quotaBytes) {
          fail('CAPABILITY_COMPONENT_BUNDLE_QUOTA_EXCEEDED', { safeFailure: true });
        }
        const staging = path.join(stagingRoot, crypto.randomUUID());
        try {
          await fs.promises.mkdir(staging, { recursive: true });
          await fs.promises.copyFile(sourceFile, path.join(staging, 'component.archive'),
            fs.constants.COPYFILE_EXCL);
          await extractVerifiedCapabilityComponentBundle({ archivePath: path.join(staging, 'component.archive'),
            destination: path.join(staging, 'bundle'), component, content: release.content });
          await fs.promises.writeFile(path.join(staging, 'install.json'), json({
            schemaVersion: 'capability-component-bundle-store-install-v1', release,
          }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await validateInstallation(staging, release, { allowStaging: true });
          await fs.promises.mkdir(path.dirname(installDirectory), { recursive: true });
          await renameWithWindowsRetry(staging, installDirectory);
        } finally { await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {}); }
      }
      const loaded = await loadState(component.componentId);
      if (loaded.state) {
        const activeRelease = releaseFromState(loaded.state.active);
        await validateInstallation(installDirectoryFor(componentFromRelease(activeRelease)), activeRelease);
        if (loaded.state.previous) {
          const previousRelease = releaseFromState(loaded.state.previous);
          await validateInstallation(installDirectoryFor(componentFromRelease(previousRelease)), previousRelease);
        }
      }
      const activeRelease = loaded.state ? releaseFromState(loaded.state.active) : null;
      const previous = activeRelease?.download.sha256 !== component.sha256
        ? loaded.state?.active ?? null : loaded.state?.previous ?? null;
      await atomicJson(loaded.stateFile, { schemaVersion: 'capability-component-bundle-state-v1',
        active: stateEntry(release), previous });
      const verified = await validateInstallation(installDirectory, release);
      return { ...verified, component, existing: exists
        || activeRelease?.download.sha256 === component.sha256 };
    });
  };

  const resolve = async ({ component, release: releaseValue } = {}) => {
    const release = normalizeBundleRelease(releaseValue), expected = componentFromRelease(release);
    if (!sameComponent(component, expected)) fail('CAPABILITY_COMPONENT_IDENTITY_MISMATCH');
    const loaded = await loadState(expected.componentId);
    if (!loaded.state) return null;
    const active = releaseFromState(loaded.state.active);
    if (!sameComponent(componentFromRelease(active), expected)
      || JSON.stringify(active.content) !== JSON.stringify(release.content)) return null;
    const verified = await validateInstallation(installDirectoryFor(expected), release);
    return { ...verified, component: expected };
  };

  const inventory = async () => {
    const installed = await listInstalled(), active = new Set(), previous = new Set();
    const stateEntries = await fs.promises.readdir(stateRoot, { withFileTypes: true })
      .catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const entry of stateEntries) {
      if (entry.name === 'store.lock') continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID');
      }
      let state;
      try { state = JSON.parse(await fs.promises.readFile(path.join(stateRoot, entry.name,
        'active.json'), 'utf8')); } catch { fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID'); }
      if (state?.schemaVersion !== 'capability-component-bundle-state-v1') {
        fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID');
      }
      active.add(componentFromRelease(releaseFromState(state.active)).sha256);
      if (state.previous) previous.add(componentFromRelease(releaseFromState(state.previous)).sha256);
    }
    const entries = installed.map(item => ({ ...item.component, content: item.content,
      storedBytes: item.component.sizeBytes + item.content.expandedSizeBytes,
      active: active.has(item.component.sha256), previous: previous.has(item.component.sha256) }));
    return { quotaBytes, usedBytes: entries.reduce((sum, item) => sum + item.storedBytes, 0), entries };
  };

  const protectedSha256s = async retain => {
    if (!Array.isArray(retain) || retain.length > 4096) {
      fail('CAPABILITY_COMPONENT_BUNDLE_RETAIN_INVALID');
    }
    const protectedSet = new Set(retain.map(item => normalizeComponent(item).sha256));
    const entries = await fs.promises.readdir(stateRoot, { withFileTypes: true })
      .catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const entry of entries) {
      if (entry.name === 'store.lock') continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID');
      }
      let state;
      try { state = JSON.parse(await fs.promises.readFile(path.join(stateRoot, entry.name,
        'active.json'), 'utf8')); } catch { fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID'); }
      if (state?.schemaVersion !== 'capability-component-bundle-state-v1') {
        fail('CAPABILITY_COMPONENT_BUNDLE_STATE_INVALID');
      }
      protectedSet.add(componentFromRelease(releaseFromState(state.active)).sha256);
      if (state.previous) protectedSet.add(componentFromRelease(releaseFromState(state.previous)).sha256);
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
      const storedBytes = item.component.sizeBytes + item.content.expandedSizeBytes;
      reclaimedBytes += storedBytes;
      removed.push({ ...item.component, storedBytes });
    }
    return { reclaimedBytes, removed };
  });

  const remove = async value => {
    const component = normalizeComponent(value);
    return withLock(storeLock, lockStaleAfterMs, async () => {
      if ((await protectedSha256s([])).has(component.sha256)) {
        fail('CAPABILITY_COMPONENT_BUNDLE_IN_USE', { safeFailure: true });
      }
      const match = (await listInstalled()).find(item => sameComponent(item.component, component));
      if (!match) return { removed: false, reclaimedBytes: 0 };
      await fs.promises.rm(match.directory, { recursive: true, force: false });
      return { removed: true,
        reclaimedBytes: match.component.sizeBytes + match.content.expandedSizeBytes };
    });
  };

  return { install, resolve, inventory, pruneUnused, remove };
}
