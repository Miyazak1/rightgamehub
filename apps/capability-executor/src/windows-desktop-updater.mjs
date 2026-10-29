import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fail } from './errors.mjs';
import { stableJson } from './package-contracts.mjs';
import { verifyWindowsDesktopUpdateCatalog } from './desktop-update-catalog.mjs';
import { downloadFileResumable } from './resumable-downloader.mjs';
import { extractZipSecurely } from './secure-zip.mjs';

const PRODUCT_ID = /^[a-z][a-z0-9.-]{2,119}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
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

const processIsAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
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
    if (!stale) fail('CAPABILITY_DESKTOP_UPDATE_BUSY', { retryable: true, safeFailure: true });
    await fs.promises.unlink(lockFile);
    try { handle = await fs.promises.open(lockFile, 'wx', 0o600); }
    catch { fail('CAPABILITY_DESKTOP_UPDATE_BUSY', { retryable: true, safeFailure: true }); }
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
  if (!isAllowedCatalogUrl(url, allowInsecureLocalhost)) {
    fail('CAPABILITY_DESKTOP_UPDATE_CATALOG_URL_INVALID');
  }
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal,
      headers: { accept: 'application/json' } });
  } catch (error) {
    throw Object.assign(new Error('CAPABILITY_DESKTOP_UPDATE_CATALOG_FETCH_FAILED',
      { cause: error }), { code: 'CAPABILITY_DESKTOP_UPDATE_CATALOG_FETCH_FAILED',
      retryable: true, safeFailure: true });
  }
  const length = Number(response.headers.get('content-length'));
  if (!response.ok || !response.body || Number.isFinite(length) && length > 1024 * 1024) {
    fail('CAPABILITY_DESKTOP_UPDATE_CATALOG_FETCH_FAILED',
      { retryable: response.status >= 500, safeFailure: true });
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    received += chunk.length;
    if (received > 1024 * 1024) fail('CAPABILITY_DESKTOP_UPDATE_CATALOG_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('CAPABILITY_DESKTOP_UPDATE_CATALOG_INVALID'); }
}

const defaultHealthProbe = async ({ productManager, targetManifestSha256 }) => {
  const status = await productManager.status();
  if (!status.ready || status.release?.manifestSha256 !== targetManifestSha256) {
    fail('CAPABILITY_DESKTOP_UPDATE_HEALTH_FAILED', { safeFailure: true });
  }
  return status;
};

export function createWindowsDesktopUpdater({ rootDirectory, productId, productManager,
  trustedCatalogKeys, catalogUrl, fetchImpl = globalThis.fetch, platform = process.platform,
  releasePlatform = 'win32-x64', osBuild, now = () => new Date(),
  allowInsecureLocalhost = false, archiveUrlResolver = value => value,
  healthProbe = defaultHealthProbe } = {}) {
  if (!path.isAbsolute(rootDirectory) || !PRODUCT_ID.test(String(productId ?? ''))
    || !productManager || productManager.productId !== productId
    || typeof productManager.status !== 'function'
    || typeof productManager.validateSource !== 'function'
    || typeof productManager.install !== 'function' || typeof productManager.repair !== 'function'
    || typeof productManager.rollback !== 'function' || typeof productManager.recover !== 'function'
    || !Array.isArray(trustedCatalogKeys) || typeof catalogUrl !== 'string'
    || typeof fetchImpl !== 'function' || platform !== 'win32'
    || releasePlatform !== 'win32-x64' || !Number.isSafeInteger(osBuild)
    || typeof now !== 'function' || typeof archiveUrlResolver !== 'function'
    || typeof healthProbe !== 'function') fail('CAPABILITY_DESKTOP_UPDATER_CONFIG_INVALID');
  const segment = safeSegment(productId);
  const stateDirectory = path.join(rootDirectory, 'update-state', segment);
  const stateFile = path.join(stateDirectory, 'state.json');
  const journalFile = path.join(stateDirectory, 'transaction.json');
  const auditFile = path.join(stateDirectory, 'audit.json');
  const lockFile = path.join(stateDirectory, 'update.lock');
  const downloads = path.join(rootDirectory, 'downloads');
  const extractionRoot = path.join(rootDirectory, '.update-extraction');

  const loadState = async () => {
    let value;
    try { value = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail('CAPABILITY_DESKTOP_UPDATE_STATE_INVALID');
    }
    if (value?.schemaVersion !== 'windows-desktop-updater-state-v1'
      || value.productId !== productId || !Number.isSafeInteger(value.highestCatalogSequence)
      || !Number.isSafeInteger(value.releaseSequence) || !SHA256.test(value.manifestSha256)
      || !SHA256.test(value.catalogSha256) || typeof value.updatedAt !== 'string') {
      fail('CAPABILITY_DESKTOP_UPDATE_STATE_INVALID');
    }
    return value;
  };

  const record = async (type, details = {}) => {
    let events = [];
    try { events = JSON.parse(await fs.promises.readFile(auditFile, 'utf8')).events; }
    catch {}
    if (!Array.isArray(events)) events = [];
    events.push({ eventId: crypto.randomUUID(), type, occurredAt: now().toISOString(),
      productId, ...details });
    await atomicJson(auditFile, { schemaVersion: 'windows-desktop-update-audit-v1',
      events: events.slice(-256) });
  };

  const recoverTransaction = async () => {
    let journal;
    try { journal = JSON.parse(await fs.promises.readFile(journalFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail('CAPABILITY_DESKTOP_UPDATE_JOURNAL_INVALID');
    }
    if (journal?.schemaVersion !== 'windows-desktop-update-transaction-v1'
      || journal.productId !== productId || !SHA256.test(journal.targetManifestSha256)
      || !['installing', 'health-check', 'committing'].includes(journal.phase)) {
      fail('CAPABILITY_DESKTOP_UPDATE_JOURNAL_INVALID');
    }
    const status = await productManager.status().catch(() => null);
    if (journal.phase === 'committing') {
      const nextState = journal.nextState;
      if (!status?.ready || status.release?.manifestSha256 !== journal.targetManifestSha256
        || nextState?.schemaVersion !== 'windows-desktop-updater-state-v1'
        || nextState.productId !== productId
        || nextState.manifestSha256 !== journal.targetManifestSha256) {
        fail('CAPABILITY_DESKTOP_UPDATE_COMMIT_RECOVERY_INVALID');
      }
      await atomicJson(stateFile, nextState);
      await fs.promises.rm(journalFile, { force: true });
      await record('commit-recovered', { manifestSha256: journal.targetManifestSha256 });
      return { status: 'commit-recovered', targetManifestSha256: journal.targetManifestSha256 };
    }
    if (status?.release?.manifestSha256 === journal.targetManifestSha256) {
      await productManager.rollback({ expectedActiveManifestSha256:
        journal.targetManifestSha256 });
    } else await productManager.recover();
    await fs.promises.rm(journalFile, { force: true });
    await record('transaction-rolled-back', { manifestSha256: journal.targetManifestSha256 });
    return { status: 'recovered', targetManifestSha256: journal.targetManifestSha256 };
  };

  const checkAndApply = async ({ signal } = {}) => withUpdaterLock(lockFile, async () => {
    const recovery = await recoverTransaction();
    const rawCatalog = await fetchCatalog({ url: catalogUrl, fetchImpl, signal,
      allowInsecureLocalhost });
    const catalog = verifyWindowsDesktopUpdateCatalog({ catalog: rawCatalog,
      trustedKeys: trustedCatalogKeys, now: now() });
    const catalogSha256 = crypto.createHash('sha256').update(stableJson(catalog)).digest('hex');
    const priorState = await loadState();
    if (priorState && catalog.sequence < priorState.highestCatalogSequence) {
      fail('CAPABILITY_DESKTOP_UPDATE_CATALOG_ROLLBACK');
    }
    if (priorState && catalog.sequence === priorState.highestCatalogSequence
      && catalogSha256 !== priorState.catalogSha256) {
      fail('CAPABILITY_DESKTOP_UPDATE_CATALOG_EQUIVOCATION');
    }
    const revoked = new Set(catalog.revokedManifestSha256s);
    const compatible = catalog.releases.filter(item => item.productId === productId
      && item.platform === releasePlatform && item.minimumOsBuild <= osBuild
      && !revoked.has(item.manifestSha256))
      .sort((left, right) => right.releaseSequence - left.releaseSequence);
    if (compatible.length < 1) fail('CAPABILITY_DESKTOP_UPDATE_RELEASE_UNAVAILABLE');
    const selected = compatible[0];
    if (priorState && selected.releaseSequence < priorState.releaseSequence) {
      fail('CAPABILITY_DESKTOP_UPDATE_RELEASE_ROLLBACK');
    }
    if (priorState && selected.releaseSequence === priorState.releaseSequence
      && selected.manifestSha256 !== priorState.manifestSha256) {
      fail('CAPABILITY_DESKTOP_UPDATE_RELEASE_EQUIVOCATION');
    }
    let currentStatus = null, currentStatusError = null;
    try { currentStatus = await productManager.status(); }
    catch (error) { currentStatusError = error; }
    const nextState = { schemaVersion: 'windows-desktop-updater-state-v1', productId,
      catalogId: catalog.catalogId, highestCatalogSequence: catalog.sequence, catalogSha256,
      releaseSequence: selected.releaseSequence, manifestSha256: selected.manifestSha256,
      updatedAt: now().toISOString() };
    if (currentStatus?.ready
      && currentStatus.release?.manifestSha256 === selected.manifestSha256) {
      await atomicJson(stateFile, nextState);
      await record('current', { manifestSha256: selected.manifestSha256,
        releaseSequence: selected.releaseSequence });
      return { status: 'current', recovery, release: selected, product: currentStatus };
    }

    const resolvedUrl = archiveUrlResolver(selected.archive.url, selected);
    const archive = await downloadFileResumable({ url: resolvedUrl,
      destinationDirectory: downloads, expectedBytes: selected.archive.sizeBytes,
      expectedSha256: selected.archive.sha256, fetchImpl, signal, allowInsecureLocalhost });
    const extraction = path.join(extractionRoot, crypto.randomUUID());
    try {
      await extractZipSecurely({ archivePath: archive, destination: extraction,
        maxFiles: 10_000, maxExpandedBytes: 2 * 1024 ** 3 });
      const manifestFile = path.join(extraction, 'desktop.json');
      if (await sha256(manifestFile).catch(() => null) !== selected.manifestSha256) {
        fail('CAPABILITY_DESKTOP_UPDATE_MANIFEST_HASH_MISMATCH');
      }
      const candidate = await productManager.validateSource({ sourceDirectory: extraction });
      if (candidate.manifestSha256 !== selected.manifestSha256
        || candidate.manifest.productVersion !== selected.productVersion) {
        fail('CAPABILITY_DESKTOP_UPDATE_RELEASE_MISMATCH');
      }
      await atomicJson(journalFile, { schemaVersion: 'windows-desktop-update-transaction-v1',
        productId, phase: 'installing', priorManifestSha256:
          currentStatus?.release?.manifestSha256 ?? null,
        targetManifestSha256: selected.manifestSha256,
        releaseSequence: selected.releaseSequence, createdAt: now().toISOString() });
      const operation = currentStatusError
        ? await productManager.repair({ sourceDirectory: extraction })
        : await productManager.install({ sourceDirectory: extraction });
      if (operation.manifestSha256 !== selected.manifestSha256) {
        fail('CAPABILITY_DESKTOP_UPDATE_INSTALL_MISMATCH');
      }
      await atomicJson(journalFile, { schemaVersion: 'windows-desktop-update-transaction-v1',
        productId, phase: 'health-check', priorManifestSha256:
          currentStatus?.release?.manifestSha256 ?? null,
        targetManifestSha256: selected.manifestSha256,
        releaseSequence: selected.releaseSequence, createdAt: now().toISOString() });
      try {
        await healthProbe({ productManager, targetManifestSha256: selected.manifestSha256,
          operation, release: selected });
      } catch (error) {
        await productManager.rollback({ expectedActiveManifestSha256:
          selected.manifestSha256 });
        await fs.promises.rm(journalFile, { force: true });
        await record('health-failed-rolled-back', { manifestSha256: selected.manifestSha256 });
        throw Object.assign(new Error('CAPABILITY_DESKTOP_UPDATE_HEALTH_FAILED', { cause: error }),
          { code: 'CAPABILITY_DESKTOP_UPDATE_HEALTH_FAILED', safeFailure: true });
      }
      await atomicJson(journalFile, { schemaVersion: 'windows-desktop-update-transaction-v1',
        productId, phase: 'committing', priorManifestSha256:
          currentStatus?.release?.manifestSha256 ?? null,
        targetManifestSha256: selected.manifestSha256,
        releaseSequence: selected.releaseSequence, createdAt: now().toISOString(), nextState });
      await atomicJson(stateFile, nextState);
      await fs.promises.rm(journalFile, { force: true });
      await record('updated', { manifestSha256: selected.manifestSha256,
        releaseSequence: selected.releaseSequence });
      return { status: 'updated', recovery, release: selected,
        product: await productManager.status() };
    } finally {
      await fs.promises.rm(extraction, { recursive: true, force: true }).catch(() => {});
    }
  });

  const status = async () => {
    let audit = [];
    try { audit = JSON.parse(await fs.promises.readFile(auditFile, 'utf8')).events; }
    catch {}
    return { schemaVersion: 'windows-desktop-updater-status-v1', state: await loadState(),
      product: await productManager.status(),
      transactionPending: await fs.promises.stat(journalFile).then(() => true).catch(() => false),
      recentAudit: Array.isArray(audit) ? audit.slice(-20) : [] };
  };
  return { checkAndApply, status,
    recover: () => withUpdaterLock(lockFile, recoverTransaction) };
}
