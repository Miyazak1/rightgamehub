import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { verifyWindowsDesktopReleaseManifest } from './desktop-release-contracts.mjs';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const relativeFile = value => value.split('/').join(path.sep);
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${crypto
  .createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;

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
  await fs.promises.writeFile(temporary, json(value), { encoding: 'utf8', mode: 0o600,
    flag: 'wx' });
  try { await renameWithWindowsRetry(temporary, file); }
  catch (error) { await fs.promises.rm(temporary, { force: true }).catch(() => {}); throw error; }
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
  try {
    state = JSON.parse(await fs.promises.readFile(lockFile, 'utf8'));
    stats = await fs.promises.stat(lockFile);
  } catch { return false; }
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
      fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_BUSY', { retryable: true, safeFailure: true });
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
      fail('CAPABILITY_DESKTOP_RELEASE_ENTRY_UNSUPPORTED');
    }
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files;
}

const contained = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative);
};

export function createWindowsDesktopReleaseStore({ installRoot, trustedKeys,
  platform = 'win32-x64', osBuild, lockStaleAfterMs = 10 * 60_000 } = {}) {
  if (!path.isAbsolute(installRoot) || !Array.isArray(trustedKeys)
    || platform !== 'win32-x64' || !Number.isSafeInteger(osBuild)
    || !Number.isSafeInteger(lockStaleAfterMs) || lockStaleAfterMs < 60_000) {
    fail('CAPABILITY_DESKTOP_RELEASE_STORE_CONFIG_INVALID');
  }
  const versionsRoot = path.join(installRoot, 'product-versions');
  const stateRoot = path.join(installRoot, 'product-state');
  const stagingRoot = path.join(installRoot, '.product-staging');

  const validateDirectory = async directory => {
    const manifestFile = path.join(directory, 'desktop.json');
    const stats = await fs.promises.lstat(manifestFile).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > 2 * 1024 * 1024) {
      fail('CAPABILITY_DESKTOP_RELEASE_MANIFEST_MISSING');
    }
    let parsed;
    try { parsed = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')); }
    catch { fail('CAPABILITY_DESKTOP_RELEASE_INVALID'); }
    const manifest = verifyWindowsDesktopReleaseManifest({ manifest: parsed, trustedKeys,
      platform, osBuild });
    const actual = (await listFiles(directory)).sort();
    const expected = ['desktop.json', ...manifest.files.map(file => file.path)].sort();
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
      fail('CAPABILITY_DESKTOP_RELEASE_FILE_SET_MISMATCH');
    }
    for (const file of manifest.files) {
      const absolute = path.join(directory, relativeFile(file.path));
      const fileStats = await fs.promises.lstat(absolute).catch(() => null);
      if (!fileStats?.isFile() || fileStats.isSymbolicLink() || fileStats.size !== file.sizeBytes
        || await sha256(absolute) !== file.sha256) {
        fail('CAPABILITY_DESKTOP_RELEASE_FILE_HASH_MISMATCH');
      }
    }
    return { manifest, manifestSha256: await sha256(manifestFile) };
  };

  const stageRelease = async (sourceDirectory, source, staging) => {
    await fs.promises.mkdir(staging, { recursive: true });
    await fs.promises.copyFile(path.join(sourceDirectory, 'desktop.json'),
      path.join(staging, 'desktop.json'), fs.constants.COPYFILE_EXCL);
    for (const file of source.manifest.files) {
      const from = path.join(sourceDirectory, relativeFile(file.path));
      const to = path.join(staging, relativeFile(file.path));
      const fileStats = await fs.promises.lstat(from);
      if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
        fail('CAPABILITY_DESKTOP_RELEASE_SOURCE_INVALID');
      }
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    }
    await validateDirectory(staging);
  };

  const resolveInstalled = async installed => {
    if (!installed || typeof installed !== 'object') {
      fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_STATE_INVALID');
    }
    const absoluteDirectory = path.resolve(installRoot, installed.directory ?? '');
    if (!contained(installRoot, absoluteDirectory)) {
      fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_STATE_INVALID');
    }
    const verified = await validateDirectory(absoluteDirectory);
    if (verified.manifest.productId !== installed.productId
      || verified.manifest.productVersion !== installed.productVersion
      || verified.manifestSha256 !== installed.manifestSha256) {
      fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_STATE_INVALID');
    }
    return { ...installed, absoluteDirectory, manifest: verified.manifest };
  };

  const loadState = async productId => {
    const productSegment = safeSegment(productId);
    const stateFile = path.join(stateRoot, productSegment, 'active.json');
    let raw;
    try { raw = await fs.promises.readFile(stateFile, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return { productSegment, stateFile, state: null };
      fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_STATE_INVALID');
    }
    let state;
    try { state = JSON.parse(raw); } catch { fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_STATE_INVALID'); }
    if (state?.schemaVersion !== 'windows-desktop-install-state-v1'
      || state.active?.productId !== productId) {
      fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_STATE_INVALID');
    }
    return { productSegment, stateFile, state };
  };

  const install = async ({ sourceDirectory } = {}) => {
    if (!path.isAbsolute(sourceDirectory)) fail('CAPABILITY_DESKTOP_RELEASE_SOURCE_INVALID');
    const sourceStats = await fs.promises.lstat(sourceDirectory).catch(() => null);
    if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) {
      fail('CAPABILITY_DESKTOP_RELEASE_SOURCE_INVALID');
    }
    const source = await validateDirectory(sourceDirectory);
    const productSegment = safeSegment(source.manifest.productId);
    const releaseSegment = `${safeSegment(source.manifest.productVersion)}-${source.manifestSha256
      .slice(0, 16)}`;
    const installDirectory = path.join(versionsRoot, productSegment, releaseSegment);
    const stateFile = path.join(stateRoot, productSegment, 'active.json');
    const lockFile = path.join(stateRoot, productSegment, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      if (!await fs.promises.stat(installDirectory).then(item => item.isDirectory()).catch(() => false)) {
        const staging = path.join(stagingRoot, crypto.randomUUID());
        try {
          await stageRelease(sourceDirectory, source, staging);
          await fs.promises.mkdir(path.dirname(installDirectory), { recursive: true });
          await renameDirectoryWithWindowsRetry(staging, installDirectory);
        } finally { await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {}); }
      } else await validateDirectory(installDirectory);
      const loaded = await loadState(source.manifest.productId);
      if (loaded.state) {
        await resolveInstalled(loaded.state.active);
        if (loaded.state.previous) await resolveInstalled(loaded.state.previous);
      }
      const active = { productId: source.manifest.productId,
        productVersion: source.manifest.productVersion, manifestSha256: source.manifestSha256,
        directory: path.relative(installRoot, installDirectory), activatedAt: new Date().toISOString() };
      const previous = loaded.state?.active
        && loaded.state.active.manifestSha256 !== active.manifestSha256
        ? loaded.state.active : loaded.state?.previous ?? null;
      await atomicJson(stateFile, { schemaVersion: 'windows-desktop-install-state-v1',
        active, previous });
      return { active: { ...active, absoluteDirectory: installDirectory,
        manifest: source.manifest }, previous,
      existing: loaded.state?.active?.manifestSha256 === active.manifestSha256 };
    });
  };

  const active = async productId => {
    const loaded = await loadState(productId);
    return loaded.state ? resolveInstalled(loaded.state.active) : null;
  };

  const repair = async (productId, { sourceDirectory } = {}) => {
    if (!path.isAbsolute(sourceDirectory)) fail('CAPABILITY_DESKTOP_RELEASE_SOURCE_INVALID');
    const source = await validateDirectory(sourceDirectory);
    if (source.manifest.productId !== productId) fail('CAPABILITY_DESKTOP_PRODUCT_ID_MISMATCH');
    const loaded = await loadState(productId);
    if (!loaded.state) fail('CAPABILITY_DESKTOP_PRODUCT_NOT_INSTALLED');
    const lockFile = path.join(stateRoot, loaded.productSegment, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      const current = await loadState(productId);
      if (!current.state || current.state.active.manifestSha256 !== source.manifestSha256
        || current.state.active.productVersion !== source.manifest.productVersion) {
        fail('CAPABILITY_DESKTOP_RELEASE_REPAIR_SOURCE_MISMATCH');
      }
      const target = path.resolve(installRoot, current.state.active.directory);
      if (!contained(installRoot, target)) fail('CAPABILITY_DESKTOP_RELEASE_INSTALL_STATE_INVALID');
      try { return await resolveInstalled(current.state.active); }
      catch (error) {
        if (!String(error?.code ?? '').startsWith('CAPABILITY_DESKTOP_RELEASE_')) throw error;
      }
      const staging = path.join(stagingRoot, crypto.randomUUID());
      const quarantine = `${target}.repair-${crypto.randomUUID()}`;
      let moved = false;
      try {
        await stageRelease(sourceDirectory, source, staging);
        await renameDirectoryWithWindowsRetry(target, quarantine);
        moved = true;
        await renameDirectoryWithWindowsRetry(staging, target);
        const verified = await resolveInstalled(current.state.active);
        await fs.promises.rm(quarantine, { recursive: true, force: true });
        moved = false;
        return verified;
      } catch (error) {
        if (moved) {
          await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
          try { await renameDirectoryWithWindowsRetry(quarantine, target); moved = false; }
          catch { /* Preserve quarantine for explicit recovery instead of deleting the last good copy. */ }
        }
        throw error;
      } finally {
        await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    });
  };

  const rollback = async (productId, { expectedActiveManifestSha256 } = {}) => {
    const loaded = await loadState(productId);
    if (!loaded.state?.previous) fail('CAPABILITY_DESKTOP_RELEASE_ROLLBACK_UNAVAILABLE');
    const lockFile = path.join(stateRoot, loaded.productSegment, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      const current = await loadState(productId);
      if (!current.state?.previous) fail('CAPABILITY_DESKTOP_RELEASE_ROLLBACK_UNAVAILABLE');
      if (expectedActiveManifestSha256 != null
        && current.state.active.manifestSha256 !== expectedActiveManifestSha256) {
        fail('CAPABILITY_DESKTOP_RELEASE_ROLLBACK_STATE_CHANGED');
      }
      const previous = await resolveInstalled(current.state.previous);
      const nextActive = { ...current.state.previous, activatedAt: new Date().toISOString() };
      await atomicJson(current.stateFile, { schemaVersion: 'windows-desktop-install-state-v1',
        active: nextActive, previous: current.state.active });
      return { ...previous, activatedAt: nextActive.activatedAt };
    });
  };

  const deactivate = async (productId, { expectedActiveManifestSha256 } = {}) => {
    const loaded = await loadState(productId);
    if (!loaded.state) return null;
    const lockFile = path.join(stateRoot, loaded.productSegment, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      const current = await loadState(productId);
      if (!current.state) return null;
      if (expectedActiveManifestSha256 != null
        && current.state.active.manifestSha256 !== expectedActiveManifestSha256) {
        fail('CAPABILITY_DESKTOP_RELEASE_DEACTIVATE_STATE_CHANGED');
      }
      const prior = await resolveInstalled(current.state.active);
      await fs.promises.unlink(current.stateFile);
      return prior;
    });
  };

  const purge = async productId => {
    const productSegment = safeSegment(productId);
    const lockFile = path.join(stateRoot, productSegment, 'install.lock');
    const result = await withLock(lockFile, lockStaleAfterMs, async () => {
      const loaded = await loadState(productId);
      if (loaded.state) fail('CAPABILITY_DESKTOP_RELEASE_STILL_ACTIVE');
      await fs.promises.rm(path.join(versionsRoot, productSegment), { recursive: true, force: true });
      return { productId, programsRemoved: true };
    });
    await fs.promises.rm(path.join(stateRoot, productSegment), { recursive: true, force: true });
    return result;
  };

  return { installRoot, validateDirectory, install, active, repair, rollback, deactivate, purge };
}
