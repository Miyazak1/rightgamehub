import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractZipSecurely } from './secure-zip.mjs';
import { fail } from './errors.mjs';
import { normalizePackageManifest, verifyPackageRelease } from './package-contracts.mjs';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const digestFile = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${crypto
  .createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
const relativeFile = value => value.split('/').join(path.sep);

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

async function reclaimStaleLock(lockFile, staleAfterMs) {
  let lock = null, stats = null;
  try {
    stats = await fs.promises.stat(lockFile);
    lock = JSON.parse(await fs.promises.readFile(lockFile, 'utf8'));
  } catch {}
  if (!stats || Date.now() - stats.mtimeMs < staleAfterMs || processIsAlive(Number(lock?.pid))) return false;
  await fs.promises.unlink(lockFile).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
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
      fail('CAPABILITY_PACKAGE_INSTALL_BUSY', { retryable: true, safeFailure: true });
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
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }), result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) {
      fail('CAPABILITY_PACKAGE_INSTALLED_ENTRY_UNSUPPORTED');
    }
    if (entry.isDirectory()) result.push(...await listFiles(root, absolute));
    else result.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return result;
}

async function validateInstalledDirectory(directory, release) {
  const manifestFile = path.join(directory, 'capability.json');
  const stats = await fs.promises.stat(manifestFile).catch(() => null);
  if (!stats?.isFile() || stats.size > 1024 * 1024) fail('CAPABILITY_PACKAGE_MANIFEST_MISSING');
  let parsed;
  try { parsed = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')); }
  catch { fail('CAPABILITY_PACKAGE_MANIFEST_INVALID'); }
  const manifest = normalizePackageManifest(parsed);
  if (manifest.capabilityId !== release.capabilityId
    || manifest.capabilityVersion !== release.capabilityVersion
    || manifest.contract.key !== release.contract.key
    || manifest.contract.version !== release.contract.version) {
    fail('CAPABILITY_PACKAGE_IDENTITY_MISMATCH');
  }
  const actual = await listFiles(directory), declared = ['capability.json', ...manifest.files.map(file => file.path)].sort();
  if (actual.length !== declared.length || actual.some((value, index) => value !== declared[index])) {
    fail('CAPABILITY_PACKAGE_FILE_SET_MISMATCH');
  }
  for (const file of manifest.files) {
    const absolute = path.join(directory, relativeFile(file.path));
    const fileStats = await fs.promises.stat(absolute);
    if (!fileStats.isFile() || fileStats.size !== file.sizeBytes
      || await digestFile(absolute) !== file.sha256) fail('CAPABILITY_PACKAGE_FILE_HASH_MISMATCH');
  }
  return manifest;
}

export function createCapabilityPackageStore({ rootDirectory, trustedKeys, platform,
  extractZip = extractZipSecurely, lockStaleAfterMs = 10 * 60 * 1000 } = {}) {
  if (!path.isAbsolute(rootDirectory) || typeof platform !== 'string'
    || !Array.isArray(trustedKeys) || typeof extractZip !== 'function'
    || !Number.isSafeInteger(lockStaleAfterMs) || lockStaleAfterMs < 60_000) {
    fail('CAPABILITY_PACKAGE_STORE_CONFIG_INVALID');
  }
  const capabilityRoot = path.join(rootDirectory, 'capabilities');
  const stateRoot = path.join(rootDirectory, 'state');
  const stagingRoot = path.join(rootDirectory, '.staging');

  const install = async ({ manifest, placementIndex, archivePath }) => {
    const release = verifyPackageRelease({ manifest, placementIndex, trustedKeys });
    if (!release.placement.platforms.includes(platform)) fail('CAPABILITY_PACKAGE_PLATFORM_MISMATCH');
    const archiveStats = await fs.promises.stat(archivePath).catch(() => null);
    if (!archiveStats?.isFile() || archiveStats.size !== release.package.sizeBytes
      || await digestFile(archivePath) !== release.package.sha256) fail('CAPABILITY_PACKAGE_ARCHIVE_HASH_MISMATCH');
    const capabilityDirectory = safeSegment(release.capabilityId), versionDirectory = safeSegment(release.capabilityVersion);
    const installDirectory = path.join(capabilityRoot, capabilityDirectory, versionDirectory,
      release.package.sha256);
    const stateFile = path.join(stateRoot, capabilityDirectory, 'active.json');
    const lockFile = path.join(stateRoot, capabilityDirectory, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      let packageManifest;
      if (await fs.promises.stat(installDirectory).then(item => item.isDirectory()).catch(() => false)) {
        packageManifest = await validateInstalledDirectory(installDirectory, release);
      } else {
        const staging = path.join(stagingRoot, crypto.randomUUID());
        try {
          await fs.promises.mkdir(staging, { recursive: true });
          await extractZip({ archivePath, destination: staging });
          packageManifest = await validateInstalledDirectory(staging, release);
          await fs.promises.mkdir(path.dirname(installDirectory), { recursive: true });
          await renameWithWindowsRetry(staging, installDirectory);
        } finally {
          await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
        }
      }
      let prior = null;
      try { prior = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); } catch {}
      const active = { capabilityId: release.capabilityId, capabilityVersion: release.capabilityVersion,
        packageSha256: release.package.sha256, directory: path.relative(rootDirectory, installDirectory),
        activatedAt: new Date().toISOString() };
      const previous = prior?.active && prior.active.packageSha256 !== active.packageSha256
        ? prior.active : prior?.previous ?? null;
      await atomicJson(stateFile, { schemaVersion: 'capability-install-state-v1', active, previous });
      return { ...active, absoluteDirectory: installDirectory, packageManifest, existing: prior?.active?.packageSha256 === active.packageSha256 };
    });
  };

  const rollback = async capabilityId => {
    const capabilityDirectory = safeSegment(capabilityId), stateFile = path.join(stateRoot,
      capabilityDirectory, 'active.json'), lockFile = path.join(stateRoot, capabilityDirectory, 'install.lock');
    return withLock(lockFile, lockStaleAfterMs, async () => {
      let state;
      try { state = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); }
      catch { fail('CAPABILITY_PACKAGE_ROLLBACK_UNAVAILABLE'); }
      if (state?.schemaVersion !== 'capability-install-state-v1' || !state.previous) {
        fail('CAPABILITY_PACKAGE_ROLLBACK_UNAVAILABLE');
      }
      const previousDirectory = path.resolve(rootDirectory, state.previous.directory);
      const root = `${path.resolve(rootDirectory)}${path.sep}`;
      if (!previousDirectory.startsWith(root)) fail('CAPABILITY_PACKAGE_STATE_INVALID');
      const release = { capabilityId: state.previous.capabilityId,
        capabilityVersion: state.previous.capabilityVersion,
        contract: (await readPackageManifest(previousDirectory)).contract };
      const packageManifest = await validateInstalledDirectory(previousDirectory, release);
      const next = { schemaVersion: 'capability-install-state-v1', active: {
        ...state.previous, activatedAt: new Date().toISOString() }, previous: state.active };
      await atomicJson(stateFile, next);
      return { ...next.active, absoluteDirectory: previousDirectory, packageManifest };
    });
  };

  const readPackageManifest = async directory => normalizePackageManifest(JSON.parse(
    await fs.promises.readFile(path.join(directory, 'capability.json'), 'utf8')));
  const active = async capabilityId => {
    const stateFile = path.join(stateRoot, safeSegment(capabilityId), 'active.json');
    let state;
    try { state = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); } catch { return null; }
    if (state?.schemaVersion !== 'capability-install-state-v1' || state.active?.capabilityId !== capabilityId) {
      fail('CAPABILITY_PACKAGE_STATE_INVALID');
    }
    const absoluteDirectory = path.resolve(rootDirectory, state.active.directory);
    if (!absoluteDirectory.startsWith(`${path.resolve(rootDirectory)}${path.sep}`)) {
      fail('CAPABILITY_PACKAGE_STATE_INVALID');
    }
    return { ...state.active, absoluteDirectory,
      packageManifest: await readPackageManifest(absoluteDirectory) };
  };

  const verifyActive = async ({ manifest, placementIndex }) => {
    const release = verifyPackageRelease({ manifest, placementIndex, trustedKeys });
    if (!release.placement.platforms.includes(platform)) fail('CAPABILITY_PACKAGE_PLATFORM_MISMATCH');
    const current = await active(release.capabilityId);
    if (!current || current.capabilityVersion !== release.capabilityVersion
      || current.packageSha256 !== release.package.sha256) return null;
    const packageManifest = await validateInstalledDirectory(current.absoluteDirectory, release);
    return { ...current, packageManifest, existing: true };
  };

  return { install, rollback, active, verifyActive };
}
