import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { verifyWindowsRuntimeManifest } from './runtime-release-contracts.mjs';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${crypto
  .createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
const relativeFile = value => value.split('/').join(path.sep);

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
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
  await renameWithWindowsRetry(temporary, file);
}

async function renameDirectoryWithWindowsRetry(from, to) {
  return renameWithWindowsRetry(from, to);
}

const processIsAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
};

async function reclaimStaleLock(lockFile, staleAfterMs) {
  let state, stats;
  try { state = JSON.parse(await fs.promises.readFile(lockFile, 'utf8')); stats = await fs.promises.stat(lockFile); }
  catch { return false; }
  if (Date.now() - stats.mtimeMs < staleAfterMs || processIsAlive(Number(state?.pid))) return false;
  await fs.promises.unlink(lockFile).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  return true;
}

async function withLock(lockFile, staleAfterMs, operation) {
  await fs.promises.mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 2 && !handle; attempt += 1) {
    try { handle = await fs.promises.open(lockFile, 'wx', 0o600); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (attempt === 0 && await reclaimStaleLock(lockFile, staleAfterMs)) continue;
      fail('CAPABILITY_RUNTIME_INSTALL_BUSY', { retryable: true, safeFailure: true });
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

async function listFiles(root, directory = root) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }), files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) {
      fail('CAPABILITY_RUNTIME_RELEASE_ENTRY_UNSUPPORTED');
    }
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files;
}

export function createWindowsRuntimeReleaseStore({ rootDirectory, trustedKeys,
  platform = 'win32-x64', osBuild, lockStaleAfterMs = 10 * 60_000 } = {}) {
  if (!path.isAbsolute(rootDirectory) || !Array.isArray(trustedKeys)
    || platform !== 'win32-x64' || !Number.isSafeInteger(osBuild)
    || !Number.isSafeInteger(lockStaleAfterMs) || lockStaleAfterMs < 60_000) {
    fail('CAPABILITY_RUNTIME_STORE_CONFIG_INVALID');
  }
  const versionsRoot = path.join(rootDirectory, 'runtime-versions');
  const stateRoot = path.join(rootDirectory, 'runtime-state');
  const stagingRoot = path.join(rootDirectory, '.runtime-staging');

  const validateDirectory = async directory => {
    const manifestFile = path.join(directory, 'runtime.json');
    const stats = await fs.promises.lstat(manifestFile).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > 1024 * 1024) {
      fail('CAPABILITY_RUNTIME_RELEASE_MANIFEST_MISSING');
    }
    let parsed;
    try { parsed = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')); }
    catch { fail('CAPABILITY_RUNTIME_RELEASE_INVALID'); }
    const manifest = verifyWindowsRuntimeManifest({ manifest: parsed, trustedKeys, platform, osBuild });
    const actual = (await listFiles(directory)).sort();
    const expected = ['runtime.json', ...manifest.files.map(file => file.path)].sort();
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
      fail('CAPABILITY_RUNTIME_RELEASE_FILE_SET_MISMATCH');
    }
    for (const file of manifest.files) {
      const absolute = path.join(directory, relativeFile(file.path));
      const fileStats = await fs.promises.lstat(absolute).catch(() => null);
      if (!fileStats?.isFile() || fileStats.isSymbolicLink() || fileStats.size !== file.sizeBytes
        || await sha256(absolute) !== file.sha256) fail('CAPABILITY_RUNTIME_RELEASE_FILE_HASH_MISMATCH');
    }
    return { manifest, manifestSha256: await sha256(manifestFile) };
  };

  const install = async ({ sourceDirectory } = {}) => {
    if (!path.isAbsolute(sourceDirectory)) fail('CAPABILITY_RUNTIME_INSTALL_SOURCE_INVALID');
    const sourceStats = await fs.promises.lstat(sourceDirectory).catch(() => null);
    if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) {
      fail('CAPABILITY_RUNTIME_INSTALL_SOURCE_INVALID');
    }
    const source = await validateDirectory(sourceDirectory);
    const runtimeSegment = safeSegment(source.manifest.runtimeId);
    const releaseSegment = `${safeSegment(source.manifest.runtimeVersion)}-${source.manifestSha256.slice(0, 16)}`;
    const installDirectory = path.join(versionsRoot, runtimeSegment, releaseSegment);
    const stateFile = path.join(stateRoot, runtimeSegment, 'active.json');
    const lockFile = path.join(stateRoot, runtimeSegment, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      if (!await fs.promises.stat(installDirectory).then(item => item.isDirectory()).catch(() => false)) {
        const staging = path.join(stagingRoot, crypto.randomUUID());
        try {
          await fs.promises.mkdir(staging, { recursive: true });
          await fs.promises.copyFile(path.join(sourceDirectory, 'runtime.json'), path.join(staging, 'runtime.json'), fs.constants.COPYFILE_EXCL);
          for (const file of source.manifest.files) {
            const from = path.join(sourceDirectory, relativeFile(file.path));
            const to = path.join(staging, relativeFile(file.path));
            const sourceStats = await fs.promises.lstat(from);
            if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) fail('CAPABILITY_RUNTIME_INSTALL_SOURCE_INVALID');
            await fs.promises.mkdir(path.dirname(to), { recursive: true });
            await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
          }
          await validateDirectory(staging);
          await fs.promises.mkdir(path.dirname(installDirectory), { recursive: true });
          await renameDirectoryWithWindowsRetry(staging, installDirectory);
        } finally { await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {}); }
      } else await validateDirectory(installDirectory);
      let prior = null, priorRaw;
      try { priorRaw = await fs.promises.readFile(stateFile, 'utf8'); }
      catch (error) {
        if (error?.code !== 'ENOENT') fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID');
      }
      if (priorRaw != null) {
        try { prior = JSON.parse(priorRaw); }
        catch { fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID'); }
        if (prior?.schemaVersion !== 'windows-runtime-install-state-v1'
          || prior.active?.runtimeId !== source.manifest.runtimeId) {
          fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID');
        }
        await resolveInstalled(prior.active);
        if (prior.previous != null) await resolveInstalled(prior.previous);
      }
      const active = { runtimeId: source.manifest.runtimeId,
        runtimeVersion: source.manifest.runtimeVersion, manifestSha256: source.manifestSha256,
        directory: path.relative(rootDirectory, installDirectory), activatedAt: new Date().toISOString() };
      const previous = prior?.active && prior.active.manifestSha256 !== active.manifestSha256
        ? prior.active : prior?.previous ?? null;
      await atomicJson(stateFile, { schemaVersion: 'windows-runtime-install-state-v1', active, previous });
      return { ...active, absoluteDirectory: installDirectory, manifest: source.manifest,
        existing: prior?.active?.manifestSha256 === active.manifestSha256 };
    });
  };

  const loadState = async runtimeId => {
    const runtimeSegment = safeSegment(runtimeId);
    const stateFile = path.join(stateRoot, runtimeSegment, 'active.json');
    let raw;
    try { raw = await fs.promises.readFile(stateFile, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return { runtimeSegment, stateFile, state: null };
      fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID');
    }
    let state;
    try { state = JSON.parse(raw); } catch { fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID'); }
    if (state?.schemaVersion !== 'windows-runtime-install-state-v1'
      || state.active?.runtimeId !== runtimeId) fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID');
    return { runtimeSegment, stateFile, state };
  };

  const resolveInstalled = async installed => {
    const absoluteDirectory = path.resolve(rootDirectory, installed.directory);
    if (!absoluteDirectory.startsWith(`${path.resolve(rootDirectory)}${path.sep}`)) {
      fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID');
    }
    const verified = await validateDirectory(absoluteDirectory);
    if (verified.manifest.runtimeId !== installed.runtimeId
      || verified.manifest.runtimeVersion !== installed.runtimeVersion
      || verified.manifestSha256 !== installed.manifestSha256) {
      fail('CAPABILITY_RUNTIME_INSTALL_STATE_INVALID');
    }
    return { ...installed, absoluteDirectory, manifest: verified.manifest };
  };

  const active = async runtimeId => {
    const loaded = await loadState(runtimeId);
    return loaded.state ? resolveInstalled(loaded.state.active) : null;
  };

  const rollback = async (runtimeId, { expectedActiveManifestSha256 } = {}) => {
    const loaded = await loadState(runtimeId);
    if (!loaded.state?.previous) fail('CAPABILITY_RUNTIME_ROLLBACK_UNAVAILABLE');
    const lockFile = path.join(stateRoot, loaded.runtimeSegment, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      const current = await loadState(runtimeId);
      if (!current.state?.previous) fail('CAPABILITY_RUNTIME_ROLLBACK_UNAVAILABLE');
      if (expectedActiveManifestSha256 != null
        && current.state.active.manifestSha256 !== expectedActiveManifestSha256) {
        fail('CAPABILITY_RUNTIME_ROLLBACK_STATE_CHANGED');
      }
      const previous = await resolveInstalled(current.state.previous);
      const nextActive = { ...current.state.previous, activatedAt: new Date().toISOString() };
      await atomicJson(current.stateFile, { schemaVersion: 'windows-runtime-install-state-v1',
        active: nextActive, previous: current.state.active });
      return { ...previous, activatedAt: nextActive.activatedAt };
    });
  };

  const deactivate = async (runtimeId, { expectedActiveManifestSha256 } = {}) => {
    const loaded = await loadState(runtimeId);
    if (!loaded.state) return null;
    const lockFile = path.join(stateRoot, loaded.runtimeSegment, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      const current = await loadState(runtimeId);
      if (!current.state) return null;
      if (expectedActiveManifestSha256 != null
        && current.state.active.manifestSha256 !== expectedActiveManifestSha256) {
        fail('CAPABILITY_RUNTIME_DEACTIVATE_STATE_CHANGED');
      }
      const prior = await resolveInstalled(current.state.active);
      await fs.promises.unlink(current.stateFile);
      return prior;
    });
  };

  return { install, active, rollback, deactivate };
}
