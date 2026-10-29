import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fail } from './errors.mjs';
import { stableJson } from './package-contracts.mjs';
import { verifyWindowsRuntimeUpdateCatalog } from './runtime-update-catalog.mjs';
import { downloadFileResumable } from './resumable-downloader.mjs';
import { extractZipSecurely } from './secure-zip.mjs';
import { probeWindowsSandboxHost } from './windows-runtime-health.mjs';

const RUNTIME_ID = /^[a-z][a-z0-9.-]{2,119}$/u;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const safeSegment = value => `${String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 80)}-${crypto
  .createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function atomicJson(file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, json(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.promises.rename(temporary, file);
}

const processIsAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
};

async function withUpdaterLock(lockFile, operation) {
  await fs.promises.mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  try { handle = await fs.promises.open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let stale = false;
    try {
      const state = JSON.parse(await fs.promises.readFile(lockFile, 'utf8'));
      const stats = await fs.promises.stat(lockFile);
      stale = Date.now() - stats.mtimeMs >= 10 * 60_000 && !processIsAlive(Number(state.pid));
    } catch {}
    if (!stale) fail('CAPABILITY_RUNTIME_UPDATE_BUSY', { retryable: true, safeFailure: true });
    await fs.promises.unlink(lockFile);
    try { handle = await fs.promises.open(lockFile, 'wx', 0o600); }
    catch { fail('CAPABILITY_RUNTIME_UPDATE_BUSY', { retryable: true, safeFailure: true }); }
  }
  try {
    await handle.writeFile(json({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await fs.promises.unlink(lockFile).catch(() => {});
  }
}

function isAllowedCatalogUrl(value, allowInsecureLocalhost) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || allowInsecureLocalhost === true && url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch { return false; }
}

async function fetchCatalog({ url, fetchImpl, signal, allowInsecureLocalhost }) {
  if (!isAllowedCatalogUrl(url, allowInsecureLocalhost)) fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_URL_INVALID');
  let response;
  try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal,
    headers: { accept: 'application/json' } }); }
  catch (error) { throw Object.assign(new Error('CAPABILITY_RUNTIME_UPDATE_CATALOG_FETCH_FAILED', { cause: error }),
    { code: 'CAPABILITY_RUNTIME_UPDATE_CATALOG_FETCH_FAILED', retryable: true, safeFailure: true }); }
  const length = Number(response.headers.get('content-length'));
  if (!response.ok || !response.body || Number.isFinite(length) && length > 1024 * 1024) {
    fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_FETCH_FAILED',
      { retryable: response.status >= 500, safeFailure: true });
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    received += chunk.length;
    if (received > 1024 * 1024) fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_TOO_LARGE');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_INVALID'); }
}

export function createWindowsRuntimeUpdater({ rootDirectory, runtimeId, runtimeStore,
  trustedCatalogKeys, catalogUrl, fetchImpl = globalThis.fetch, platform = process.platform,
  releasePlatform = 'win32-x64', osBuild, now = () => new Date(),
  allowInsecureLocalhost = false, archiveUrlResolver = value => value,
  healthProbe = probeWindowsSandboxHost } = {}) {
  if (!path.isAbsolute(rootDirectory) || !RUNTIME_ID.test(String(runtimeId ?? ''))
    || !runtimeStore || typeof runtimeStore.install !== 'function'
    || typeof runtimeStore.active !== 'function' || typeof runtimeStore.rollback !== 'function'
    || typeof runtimeStore.deactivate !== 'function' || !Array.isArray(trustedCatalogKeys)
    || typeof catalogUrl !== 'string' || typeof fetchImpl !== 'function' || platform !== 'win32'
    || releasePlatform !== 'win32-x64' || !Number.isSafeInteger(osBuild)
    || typeof now !== 'function' || typeof archiveUrlResolver !== 'function'
    || typeof healthProbe !== 'function') fail('CAPABILITY_RUNTIME_UPDATER_CONFIG_INVALID');
  const segment = safeSegment(runtimeId);
  const stateDirectory = path.join(rootDirectory, 'update-state', segment);
  const stateFile = path.join(stateDirectory, 'state.json');
  const journalFile = path.join(stateDirectory, 'transaction.json');
  const lockFile = path.join(stateDirectory, 'update.lock');
  const downloads = path.join(rootDirectory, 'downloads');
  const extractionRoot = path.join(rootDirectory, '.update-extraction');

  const loadState = async () => {
    let raw;
    try { raw = await fs.promises.readFile(stateFile, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail('CAPABILITY_RUNTIME_UPDATE_STATE_INVALID');
    }
    let value;
    try { value = JSON.parse(raw); } catch { fail('CAPABILITY_RUNTIME_UPDATE_STATE_INVALID'); }
    if (value?.schemaVersion !== 'windows-runtime-updater-state-v1'
      || value.runtimeId !== runtimeId || !Number.isSafeInteger(value.highestCatalogSequence)
      || !Number.isSafeInteger(value.releaseSequence)) fail('CAPABILITY_RUNTIME_UPDATE_STATE_INVALID');
    return value;
  };

  const recover = async () => {
    let raw;
    try { raw = await fs.promises.readFile(journalFile, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail('CAPABILITY_RUNTIME_UPDATE_JOURNAL_INVALID');
    }
    let journal;
    try { journal = JSON.parse(raw); } catch { fail('CAPABILITY_RUNTIME_UPDATE_JOURNAL_INVALID'); }
    if (journal?.schemaVersion !== 'windows-runtime-update-transaction-v1'
      || journal.runtimeId !== runtimeId || typeof journal.targetManifestSha256 !== 'string') {
      fail('CAPABILITY_RUNTIME_UPDATE_JOURNAL_INVALID');
    }
    const active = await runtimeStore.active(runtimeId);
    if (journal.phase === 'committing') {
      const nextState = journal.nextState;
      if (active?.manifestSha256 !== journal.targetManifestSha256
        || nextState?.schemaVersion !== 'windows-runtime-updater-state-v1'
        || nextState.runtimeId !== runtimeId
        || nextState.manifestSha256 !== journal.targetManifestSha256) {
        fail('CAPABILITY_RUNTIME_UPDATE_COMMIT_RECOVERY_INVALID');
      }
      await atomicJson(stateFile, nextState);
      await fs.promises.rm(journalFile, { force: true });
      return { status: 'commit-recovered', targetManifestSha256: journal.targetManifestSha256 };
    }
    if (active?.manifestSha256 === journal.targetManifestSha256) {
      if (journal.priorManifestSha256) {
        const restored = await runtimeStore.rollback(runtimeId,
          { expectedActiveManifestSha256: journal.targetManifestSha256 });
        if (restored.manifestSha256 !== journal.priorManifestSha256) {
          fail('CAPABILITY_RUNTIME_UPDATE_ROLLBACK_MISMATCH');
        }
      } else {
        await runtimeStore.deactivate(runtimeId,
          { expectedActiveManifestSha256: journal.targetManifestSha256 });
      }
    }
    await fs.promises.rm(journalFile, { force: true });
    return { status: 'recovered', targetManifestSha256: journal.targetManifestSha256 };
  };

  const checkAndApply = async ({ signal } = {}) => withUpdaterLock(lockFile, async () => {
    const recovery = await recover();
    const rawCatalog = await fetchCatalog({ url: catalogUrl, fetchImpl, signal, allowInsecureLocalhost });
    const catalog = verifyWindowsRuntimeUpdateCatalog({ catalog: rawCatalog,
      trustedKeys: trustedCatalogKeys, now: now() });
    const catalogSha256 = crypto.createHash('sha256').update(stableJson(catalog)).digest('hex');
    const priorState = await loadState();
    if (priorState && catalog.sequence < priorState.highestCatalogSequence) {
      fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_ROLLBACK');
    }
    if (priorState && catalog.sequence === priorState.highestCatalogSequence
      && catalogSha256 !== priorState.catalogSha256) fail('CAPABILITY_RUNTIME_UPDATE_CATALOG_EQUIVOCATION');
    const revoked = new Set(catalog.revokedManifestSha256s);
    const compatible = catalog.releases.filter(item => item.runtimeId === runtimeId
      && item.platform === releasePlatform && item.minimumOsBuild <= osBuild
      && !revoked.has(item.manifestSha256))
      .sort((a, b) => b.releaseSequence - a.releaseSequence);
    if (compatible.length < 1) fail('CAPABILITY_RUNTIME_UPDATE_RELEASE_UNAVAILABLE');
    const selected = compatible[0];
    if (priorState && selected.releaseSequence < priorState.releaseSequence) {
      fail('CAPABILITY_RUNTIME_UPDATE_RELEASE_ROLLBACK');
    }
    if (priorState && selected.releaseSequence === priorState.releaseSequence
      && selected.manifestSha256 !== priorState.manifestSha256) {
      fail('CAPABILITY_RUNTIME_UPDATE_RELEASE_EQUIVOCATION');
    }
    const active = await runtimeStore.active(runtimeId);
    if (active?.manifestSha256 === selected.manifestSha256) {
      await atomicJson(stateFile, { schemaVersion: 'windows-runtime-updater-state-v1', runtimeId,
        catalogId: catalog.catalogId, highestCatalogSequence: catalog.sequence, catalogSha256,
        releaseSequence: selected.releaseSequence, manifestSha256: selected.manifestSha256,
        updatedAt: now().toISOString() });
      return { status: 'current', recovery, release: selected, active };
    }

    const resolvedUrl = archiveUrlResolver(selected.archive.url, selected);
    const archive = await downloadFileResumable({ url: resolvedUrl,
      destinationDirectory: downloads, expectedBytes: selected.archive.sizeBytes,
      expectedSha256: selected.archive.sha256, fetchImpl, signal, allowInsecureLocalhost });
    const extraction = path.join(extractionRoot, crypto.randomUUID());
    try {
      await extractZipSecurely({ archivePath: archive, destination: extraction,
        maxFiles: 128, maxExpandedBytes: 1024 * 1024 ** 2 });
      const manifestFile = path.join(extraction, 'runtime.json');
      if (await sha256(manifestFile).catch(() => null) !== selected.manifestSha256) {
        fail('CAPABILITY_RUNTIME_UPDATE_MANIFEST_HASH_MISMATCH');
      }
      await atomicJson(journalFile, { schemaVersion: 'windows-runtime-update-transaction-v1',
        runtimeId, phase: 'installing', priorManifestSha256: active?.manifestSha256 ?? null,
        targetManifestSha256: selected.manifestSha256, releaseSequence: selected.releaseSequence,
        createdAt: now().toISOString() });
      const installed = await runtimeStore.install({ sourceDirectory: extraction });
      if (installed.manifestSha256 !== selected.manifestSha256) {
        fail('CAPABILITY_RUNTIME_UPDATE_INSTALL_MISMATCH');
      }
      await atomicJson(journalFile, { schemaVersion: 'windows-runtime-update-transaction-v1',
        runtimeId, phase: 'health-check', priorManifestSha256: active?.manifestSha256 ?? null,
        targetManifestSha256: selected.manifestSha256, releaseSequence: selected.releaseSequence,
        createdAt: now().toISOString() });
      const helper = installed.manifest.files.find(item => item.role === 'sandbox-host');
      const helperPath = path.resolve(installed.absoluteDirectory,
        ...installed.manifest.helper.path.split('/'));
      try {
        await healthProbe({ helperPath, helperSha256: helper.sha256, platform });
      } catch (error) {
        if (active) await runtimeStore.rollback(runtimeId,
          { expectedActiveManifestSha256: selected.manifestSha256 });
        else await runtimeStore.deactivate(runtimeId,
          { expectedActiveManifestSha256: selected.manifestSha256 });
        await fs.promises.rm(journalFile, { force: true });
        throw Object.assign(new Error('CAPABILITY_RUNTIME_UPDATE_HEALTH_FAILED', { cause: error }),
          { code: 'CAPABILITY_RUNTIME_UPDATE_HEALTH_FAILED', safeFailure: true });
      }
      const nextState = { schemaVersion: 'windows-runtime-updater-state-v1', runtimeId,
        catalogId: catalog.catalogId, highestCatalogSequence: catalog.sequence, catalogSha256,
        releaseSequence: selected.releaseSequence, manifestSha256: selected.manifestSha256,
        updatedAt: now().toISOString() };
      await atomicJson(journalFile, { schemaVersion: 'windows-runtime-update-transaction-v1',
        runtimeId, phase: 'committing', priorManifestSha256: active?.manifestSha256 ?? null,
        targetManifestSha256: selected.manifestSha256, releaseSequence: selected.releaseSequence,
        createdAt: now().toISOString(), nextState });
      await atomicJson(stateFile, nextState);
      await fs.promises.rm(journalFile, { force: true });
      return { status: 'updated', recovery, release: selected, active: installed };
    } finally { await fs.promises.rm(extraction, { recursive: true, force: true }).catch(() => {}); }
  });

  const status = async () => ({ state: await loadState(), active: await runtimeStore.active(runtimeId),
    transactionPending: await fs.promises.stat(journalFile).then(() => true).catch(() => false) });
  return { checkAndApply, status, recover: () => withUpdaterLock(lockFile, recover) };
}
