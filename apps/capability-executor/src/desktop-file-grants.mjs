import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { normalizeWindowsFileIdentity, openVerifiedWindowsFile,
  sha256FromHandle } from './windows-file-identity.mjs';

const CAPABILITY_KEY = /^[a-z][a-z0-9.-]{2,159}$/u;
const EXTENSION = /^\.[a-z0-9]{1,16}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STATES = new Set(['pending', 'consuming', 'consumed', 'revoked', 'expired']);
const REQUEST_STATES = new Set(['waiting', 'selecting', 'approved', 'rejected', 'cancelled', 'expired']);
const ACTIVE_REQUEST_STATES = new Set(['waiting', 'selecting']);
const MAX_REQUEST_HISTORY = 200;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

const iso = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('CAPABILITY_DESKTOP_FILE_GRANT_INVALID');
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
const secretKey = id => `desktop-file-authorization-v1:${id}`;

function validateSelectionRequest({ capabilityKey, extensions = [], maxFiles = 1,
  ttlMs = 10 * 60_000, executionLeaseId = null, requestId = null,
  capabilityVersion = null, ownerWindowHandle = null } = {}) {
  if (!CAPABILITY_KEY.test(capabilityKey ?? '') || !Array.isArray(extensions)
    || extensions.length > 32 || extensions.some(value => !EXTENSION.test(value))
    || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 128
    || !Number.isSafeInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 60 * 60_000
    || executionLeaseId != null && !UUID.test(executionLeaseId)
    || requestId != null && !UUID.test(requestId)
    || capabilityVersion != null && (!Number.isSafeInteger(capabilityVersion) || capabilityVersion < 1)
    || ownerWindowHandle != null && !/^[1-9][0-9]{0,19}$/u.test(ownerWindowHandle)
    || (executionLeaseId == null) !== (requestId == null)
    || (executionLeaseId == null) !== (capabilityVersion == null)) {
    fail('CAPABILITY_DESKTOP_FILE_SELECTION_REQUEST_INVALID');
  }
  return { capabilityKey, extensions: [...new Set(extensions.map(value => value.toLowerCase()))],
    maxFiles, ttlMs, executionLeaseId, requestId, capabilityVersion, ownerWindowHandle };
}

function safeEntry(entry) {
  return { authorizationId: entry.authorizationId, capabilityKey: entry.capabilityKey,
    capabilityVersion: entry.capabilityVersion ?? null,
    executionLeaseId: entry.executionLeaseId ?? null, requestId: entry.requestId ?? null,
    state: entry.state, fileCount: entry.fileCount, displayNames: [...entry.displayNames],
    createdAt: entry.createdAt, expiresAt: entry.expiresAt, consumedAt: entry.consumedAt ?? null,
    revokedAt: entry.revokedAt ?? null };
}

function safeRequest(entry) {
  return { requestId: entry.requestId, executionLeaseId: entry.executionLeaseId,
    capabilityKey: entry.capabilityKey, capabilityVersion: entry.capabilityVersion,
    state: entry.state, createdAt: entry.createdAt,
    expiresAt: entry.expiresAt, resolvedAt: entry.resolvedAt ?? null };
}

function consentCenter(entries, generatedAt) {
  const active = entries.filter(entry => ACTIVE_REQUEST_STATES.has(entry.state)).reverse();
  const resolved = entries.filter(entry => !ACTIVE_REQUEST_STATES.has(entry.state)).reverse();
  const items = [...active, ...resolved].map(entry => ({ ...safeRequest(entry),
    actionable: entry.state === 'waiting' }));
  const counts = Object.fromEntries([...REQUEST_STATES].map(state => [state,
    items.filter(item => item.state === state).length]));
  return { schemaVersion: 'capability-desktop-file-consent-center-v1', generatedAt,
    notificationCount: counts.waiting, activeCount: counts.waiting + counts.selecting,
    historyCount: items.length - counts.waiting - counts.selecting, counts, items };
}

function pruneRequests(entries) {
  if (entries.length <= MAX_REQUEST_HISTORY) return entries;
  const active = entries.filter(entry => ACTIVE_REQUEST_STATES.has(entry.state));
  if (active.length > MAX_REQUEST_HISTORY) {
    fail('CAPABILITY_DESKTOP_FILE_CONSENT_CAPACITY_REACHED', { safeFailure: true });
  }
  const resolved = entries.filter(entry => !ACTIVE_REQUEST_STATES.has(entry.state));
  const remaining = Math.max(0, MAX_REQUEST_HISTORY - active.length);
  return [...active, ...resolved.slice(-remaining)];
}

export function createDesktopFileGrantBroker({ rootDirectory, credentialVault, selectionAdapter,
  now = () => new Date(), sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  requireTaskBinding = false, consentTimeoutMs = 5 * 60_000, consentPollMs = 250 } = {}) {
  if (!path.isAbsolute(rootDirectory) || !credentialVault
    || typeof credentialVault.store !== 'function' || typeof credentialVault.load !== 'function'
    || typeof credentialVault.remove !== 'function' || !selectionAdapter
    || typeof selectionAdapter.selectFiles !== 'function' || typeof now !== 'function'
    || typeof sleep !== 'function' || typeof requireTaskBinding !== 'boolean'
    || !Number.isSafeInteger(consentTimeoutMs) || consentTimeoutMs < 30_000
    || consentTimeoutMs > 30 * 60_000 || !Number.isSafeInteger(consentPollMs)
    || consentPollMs < 10 || consentPollMs > 5000) {
    fail('CAPABILITY_DESKTOP_FILE_GRANT_CONFIG_INVALID');
  }
  const directory = path.join(rootDirectory, 'desktop-shell');
  const indexFile = path.join(directory, 'file-authorizations.json');
  const requestFile = path.join(directory, 'file-consent-requests.json');
  const activeConsumptions = new Set();
  let queue = Promise.resolve();
  const exclusive = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {}); return result;
  };
  const readIndex = async () => {
    let value;
    try { value = JSON.parse(await fs.promises.readFile(indexFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return [];
      fail('CAPABILITY_DESKTOP_FILE_GRANT_LEDGER_INVALID');
    }
    if (!Array.isArray(value?.entries) || value.entries.length > 1000) {
      fail('CAPABILITY_DESKTOP_FILE_GRANT_LEDGER_INVALID');
    }
    let entries = value.entries;
    if (value.schemaVersion === 'capability-desktop-file-authorization-index-v1') {
      entries = entries.map(entry => exact(entry, ['authorizationId', 'capabilityKey', 'state',
        'fileCount', 'displayNames', 'createdAt', 'expiresAt', 'consumedAt', 'revokedAt'])
        ? { ...entry, capabilityVersion: null, executionLeaseId: null, requestId: null } : entry);
    } else if (value.schemaVersion === 'capability-desktop-file-authorization-index-v2') {
      entries = entries.map(entry => exact(entry, ['authorizationId', 'capabilityKey',
        'executionLeaseId', 'requestId', 'state', 'fileCount', 'displayNames', 'createdAt',
        'expiresAt', 'consumedAt', 'revokedAt']) ? { ...entry, capabilityVersion: null } : entry);
    } else if (value.schemaVersion !== 'capability-desktop-file-authorization-index-v3') {
      fail('CAPABILITY_DESKTOP_FILE_GRANT_LEDGER_INVALID');
    }
    if (entries.some(entry => !exact(entry, ['authorizationId', 'capabilityKey',
        'capabilityVersion', 'executionLeaseId', 'requestId', 'state', 'fileCount',
        'displayNames', 'createdAt', 'expiresAt', 'consumedAt', 'revokedAt'])
        || !UUID.test(entry.authorizationId ?? '')
        || !CAPABILITY_KEY.test(entry.capabilityKey ?? '') || !STATES.has(entry.state)
        || entry.executionLeaseId != null && !UUID.test(entry.executionLeaseId)
        || entry.requestId != null && !UUID.test(entry.requestId)
        || entry.capabilityVersion != null && (!Number.isSafeInteger(entry.capabilityVersion)
          || entry.capabilityVersion < 1)
        || !Number.isSafeInteger(entry.fileCount) || entry.fileCount < 1
        || !Array.isArray(entry.displayNames) || entry.displayNames.length !== entry.fileCount
        || entry.displayNames.some(name => typeof name !== 'string' || name.length < 1 || name.length > 200)
        || !Number.isFinite(new Date(entry.createdAt).getTime())
        || (entry.executionLeaseId == null) !== (entry.requestId == null)
        || (entry.executionLeaseId == null) !== (entry.capabilityVersion == null)
        || !Number.isFinite(new Date(entry.expiresAt).getTime())
        || entry.consumedAt != null && !Number.isFinite(new Date(entry.consumedAt).getTime())
        || entry.revokedAt != null && !Number.isFinite(new Date(entry.revokedAt).getTime()))) {
      fail('CAPABILITY_DESKTOP_FILE_GRANT_LEDGER_INVALID');
    }
    return entries;
  };
  const writeIndex = entries => atomicJson(indexFile, {
    schemaVersion: 'capability-desktop-file-authorization-index-v3', entries,
  });
  const readRequests = async () => {
    let value;
    try { value = JSON.parse(await fs.promises.readFile(requestFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return [];
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_LEDGER_INVALID');
    }
    if (!Array.isArray(value?.entries) || value.entries.length > 1000) {
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_LEDGER_INVALID');
    }
    let entries = value.entries;
    if (value.schemaVersion === 'capability-desktop-file-consent-index-v1') {
      entries = entries.map(entry => exact(entry, ['requestId', 'executionLeaseId', 'capabilityKey',
        'state', 'createdAt', 'expiresAt', 'resolvedAt']) ? { ...entry,
        capabilityVersion: null, state: 'expired', resolvedAt: entry.resolvedAt ?? iso(now()) } : entry);
    } else if (value.schemaVersion !== 'capability-desktop-file-consent-index-v2') {
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_LEDGER_INVALID');
    }
    if (entries.some(entry => !exact(entry, ['requestId', 'executionLeaseId', 'capabilityKey',
        'capabilityVersion', 'state', 'createdAt', 'expiresAt', 'resolvedAt'])
        || !UUID.test(entry.requestId ?? '')
        || !UUID.test(entry.executionLeaseId ?? '') || !CAPABILITY_KEY.test(entry.capabilityKey ?? '')
        || entry.capabilityVersion != null && (!Number.isSafeInteger(entry.capabilityVersion)
          || entry.capabilityVersion < 1)
        || entry.capabilityVersion == null && entry.state !== 'expired'
        || !REQUEST_STATES.has(entry.state) || !Number.isFinite(new Date(entry.createdAt).getTime())
        || !Number.isFinite(new Date(entry.expiresAt).getTime())
        || entry.resolvedAt != null && !Number.isFinite(new Date(entry.resolvedAt).getTime()))) {
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_LEDGER_INVALID');
    }
    return entries;
  };
  const writeRequests = entries => atomicJson(requestFile, {
    schemaVersion: 'capability-desktop-file-consent-index-v2', entries: pruneRequests(entries),
  });
  const expireRequests = entries => {
    const current = now().getTime();
    for (const entry of entries) {
      if (entry.state === 'selecting'
        || entry.state === 'waiting' && new Date(entry.expiresAt).getTime() <= current) {
        entry.state = 'expired'; entry.resolvedAt = iso(now());
      }
    }
    return entries;
  };
  const expire = async entries => {
    const current = now().getTime();
    for (const entry of entries) {
      if (entry.state === 'consuming' && !activeConsumptions.has(entry.authorizationId)) {
        entry.state = 'consumed'; entry.consumedAt ??= iso(now());
        await credentialVault.remove(secretKey(entry.authorizationId));
      } else if (entry.state === 'pending' && new Date(entry.expiresAt).getTime() <= current) {
        entry.state = 'expired';
        await credentialVault.remove(secretKey(entry.authorizationId));
      }
    }
    return entries;
  };
  const createAuthorization = async request => {
    const normalized = validateSelectionRequest(request);
    const selected = await selectionAdapter.selectFiles({ extensions: normalized.extensions,
      maxFiles: normalized.maxFiles, ownerWindowHandle: normalized.ownerWindowHandle });
    if (!Array.isArray(selected) || selected.length > normalized.maxFiles
      || selected.some(file => !path.isAbsolute(file))) {
      fail('CAPABILITY_DESKTOP_FILE_SELECTION_INVALID');
    }
    if (selected.length < 1) return { status: 'cancelled' };
    const unique = [...new Set(selected.map(file => path.resolve(file)))];
    if (unique.length !== selected.length) fail('CAPABILITY_DESKTOP_FILE_SELECTION_INVALID');
    const files = [];
    for (const sourcePath of unique) {
      const extension = path.extname(sourcePath).toLowerCase();
      if (normalized.extensions.length > 0 && !normalized.extensions.includes(extension)) {
        fail('CAPABILITY_DESKTOP_FILE_SELECTION_TYPE_INVALID');
      }
      let opened;
      try { opened = await openVerifiedWindowsFile(sourcePath); }
      catch (error) {
        if (error?.code === 'CAPABILITY_WINDOWS_FILE_IDENTITY_UNAVAILABLE') {
          fail('CAPABILITY_DESKTOP_FILE_SELECTION_INVALID');
        }
        throw error;
      }
      try {
        files.push({ grantId: crypto.randomUUID(), sourcePath,
          displayName: path.basename(sourcePath).slice(0, 200), identity: opened.identity,
          sha256: await sha256FromHandle(opened.handle) });
      } finally { await opened.handle.close().catch(() => {}); }
    }
    const authorizationId = crypto.randomUUID(), createdAt = iso(now());
    const record = { schemaVersion: 'capability-desktop-file-authorization-secret-v4',
      authorizationId, capabilityKey: normalized.capabilityKey,
      capabilityVersion: normalized.capabilityVersion,
      executionLeaseId: normalized.executionLeaseId, requestId: normalized.requestId, createdAt,
      expiresAt: iso(now().getTime() + normalized.ttlMs), files };
    await credentialVault.store(secretKey(authorizationId), JSON.stringify(record));
    try {
      const entries = await expire(await readIndex());
      entries.push({ authorizationId, capabilityKey: normalized.capabilityKey,
        capabilityVersion: normalized.capabilityVersion,
        executionLeaseId: record.executionLeaseId, requestId: record.requestId, state: 'pending',
        fileCount: files.length, displayNames: files.map(file => file.displayName),
        createdAt, expiresAt: record.expiresAt, consumedAt: null, revokedAt: null });
      await writeIndex(entries.slice(-1000));
      return { status: 'authorized', ...safeEntry(entries.at(-1)) };
    } catch (error) {
      await credentialVault.remove(secretKey(authorizationId)).catch(() => {});
      throw error;
    }
  };
  const authorize = request => exclusive(() => createAuthorization(request));
  const list = () => exclusive(async () => {
    const entries = await expire(await readIndex()); await writeIndex(entries);
    return entries.map(safeEntry);
  });
  const revoke = authorizationId => exclusive(async () => {
    const entries = await expire(await readIndex());
    const entry = entries.find(item => item.authorizationId === authorizationId);
    if (!entry) fail('CAPABILITY_DESKTOP_FILE_AUTHORIZATION_NOT_FOUND');
    if (entry.state === 'pending') {
      entry.state = 'revoked'; entry.revokedAt = iso(now());
      await credentialVault.remove(secretKey(authorizationId));
    }
    await writeIndex(entries); return safeEntry(entry);
  });
  const listConsentRequests = () => exclusive(async () => {
    const entries = expireRequests(await readRequests());
    await writeRequests(entries);
    return pruneRequests(entries).map(safeRequest);
  });
  const getConsentCenter = () => exclusive(async () => {
    const entries = expireRequests(await readRequests());
    const retained = pruneRequests(entries);
    await writeRequests(retained);
    return consentCenter(retained, iso(now()));
  });
  const approveConsentRequest = request => exclusive(async () => {
    if (!request || !UUID.test(request.requestId ?? '')) {
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_REQUEST_INVALID');
    }
    const requests = expireRequests(await readRequests());
    const entry = requests.find(item => item.requestId === request.requestId);
    if (!entry) fail('CAPABILITY_DESKTOP_FILE_CONSENT_NOT_FOUND');
    if (entry.state !== 'waiting') fail('CAPABILITY_DESKTOP_FILE_CONSENT_NOT_WAITING');
    entry.state = 'selecting';
    await writeRequests(requests);
    let authorization;
    try {
      authorization = await createAuthorization({ capabilityKey: entry.capabilityKey,
        capabilityVersion: entry.capabilityVersion,
        executionLeaseId: entry.executionLeaseId, requestId: entry.requestId,
        extensions: request.extensions ?? [], maxFiles: request.maxFiles ?? 1,
        ttlMs: request.ttlMs ?? 10 * 60_000,
        ownerWindowHandle: request.ownerWindowHandle ?? null });
    } catch (error) {
      entry.state = 'waiting';
      await writeRequests(requests);
      throw error;
    }
    if (authorization.status === 'cancelled') {
      entry.state = 'waiting';
      await writeRequests(requests);
      return authorization;
    }
    entry.state = 'approved';
    entry.resolvedAt = iso(now());
    await writeRequests(requests);
    return { ...authorization, consentRequest: safeRequest(entry) };
  });
  const rejectConsentRequest = requestId => exclusive(async () => {
    if (!UUID.test(requestId ?? '')) fail('CAPABILITY_DESKTOP_FILE_CONSENT_REQUEST_INVALID');
    const requests = expireRequests(await readRequests());
    const entry = requests.find(item => item.requestId === requestId);
    if (!entry) fail('CAPABILITY_DESKTOP_FILE_CONSENT_NOT_FOUND');
    if (entry.state !== 'waiting') fail('CAPABILITY_DESKTOP_FILE_CONSENT_NOT_WAITING');
    entry.state = 'rejected';
    entry.resolvedAt = iso(now());
    await writeRequests(requests);
    return safeRequest(entry);
  });
  const cancelConsentRequest = (requestId, state) => exclusive(async () => {
    const requests = expireRequests(await readRequests());
    const entry = requests.find(item => item.requestId === requestId);
    if (entry?.state === 'waiting') {
      entry.state = state;
      entry.resolvedAt = iso(now());
      await writeRequests(requests);
    }
  });
  const ensureConsentRequest = ({ executionLeaseId, capabilityKey,
    capabilityVersion }) => exclusive(async () => {
    const requests = expireRequests(await readRequests());
    let entry = requests.find(item => item.executionLeaseId === executionLeaseId);
    if (entry && (entry.capabilityKey !== capabilityKey
      || entry.capabilityVersion !== capabilityVersion)) {
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_CONTRACT_MISMATCH', { safeFailure: true });
    }
    if (!entry) {
      entry = { requestId: crypto.randomUUID(), executionLeaseId, capabilityKey, capabilityVersion,
        state: 'waiting',
        createdAt: iso(now()), expiresAt: iso(now().getTime() + consentTimeoutMs), resolvedAt: null };
      requests.push(entry);
    }
    await writeRequests(requests);
    return safeRequest(entry);
  });
  const inspectConsent = ({ requestId, executionLeaseId, capabilityKey,
    capabilityVersion }) => exclusive(async () => {
    const requests = expireRequests(await readRequests());
    const authorizations = await expire(await readIndex());
    const authorization = authorizations.find(item => item.state === 'pending'
      && item.capabilityKey === capabilityKey && item.executionLeaseId === executionLeaseId
      && item.requestId === requestId && item.capabilityVersion === capabilityVersion);
    const request = requests.find(item => item.requestId === requestId);
    await writeRequests(requests);
    await writeIndex(authorizations);
    return { authorizationId: authorization?.authorizationId ?? null,
      state: request?.state ?? 'expired' };
  });
  const consumeAuthorization = async ({ authorizationId, capabilityKey,
    capabilityVersion = null, executionLeaseId = null, requestId = null }) => {
    const entry = await exclusive(async () => {
      const entries = await expire(await readIndex());
      const found = entries.find(item => item.authorizationId === authorizationId
        && item.state === 'pending' && item.capabilityKey === capabilityKey
        && item.capabilityVersion === capabilityVersion
        && item.executionLeaseId === executionLeaseId && item.requestId === requestId);
      if (!found) {
        await writeIndex(entries);
        fail('CAPABILITY_DESKTOP_FILE_AUTHORIZATION_REQUIRED', { safeFailure: true });
      }
      found.state = 'consuming';
      activeConsumptions.add(found.authorizationId);
      try { await writeIndex(entries); }
      catch (error) { activeConsumptions.delete(found.authorizationId); throw error; }
      return structuredClone(found);
    });
    try {
      const raw = await credentialVault.load(secretKey(entry.authorizationId));
      let record;
      try { record = JSON.parse(raw); } catch { fail('CAPABILITY_DESKTOP_FILE_GRANT_SECRET_INVALID'); }
      const v1 = record?.schemaVersion === 'capability-desktop-file-authorization-secret-v1';
      const v2 = record?.schemaVersion === 'capability-desktop-file-authorization-secret-v2';
      const v3 = record?.schemaVersion === 'capability-desktop-file-authorization-secret-v3';
      const v4 = record?.schemaVersion === 'capability-desktop-file-authorization-secret-v4';
      const fields = v1 ? ['schemaVersion', 'authorizationId', 'capabilityKey', 'createdAt',
        'expiresAt', 'files'] : v2 ? ['schemaVersion', 'authorizationId', 'capabilityKey',
        'executionLeaseId', 'requestId', 'createdAt', 'expiresAt', 'files']
        : ['schemaVersion', 'authorizationId', 'capabilityKey', 'capabilityVersion',
          'executionLeaseId', 'requestId', 'createdAt', 'expiresAt', 'files'];
      if (!exact(record, fields)
        || !v1 && !v2 && !v3 && !v4
        || record.authorizationId !== entry.authorizationId || record.capabilityKey !== capabilityKey
        || (v1 || v2 ? null : record.capabilityVersion) !== capabilityVersion
        || (v1 ? null : record.executionLeaseId) !== executionLeaseId
        || (v1 ? null : record.requestId) !== requestId
        || !Array.isArray(record.files) || record.files.length !== entry.fileCount
        || requireTaskBinding && !v4
        || record.files.some(file => !exact(file, v4
          ? ['grantId', 'sourcePath', 'displayName', 'identity', 'sha256']
          : ['grantId', 'sourcePath', 'displayName', 'size', 'mtimeMs', 'sha256'])
          || !UUID.test(file.grantId ?? '') || !path.isAbsolute(file.sourcePath)
          || typeof file.displayName !== 'string' || file.displayName.length < 1
          || file.displayName.length > 200 || !/^[a-f0-9]{64}$/u.test(file.sha256 ?? '')
          || !v4 && (!Number.isSafeInteger(file.size) || file.size < 0
            || !Number.isFinite(file.mtimeMs)))) {
        fail('CAPABILITY_DESKTOP_FILE_GRANT_SECRET_INVALID');
      }
      const grants = [];
      for (const file of record.files) {
        let expectedIdentity = null;
        if (v4) {
          try { expectedIdentity = normalizeWindowsFileIdentity(file.identity); }
          catch { fail('CAPABILITY_DESKTOP_FILE_GRANT_SECRET_INVALID'); }
        }
        const opened = await openVerifiedWindowsFile(file.sourcePath, expectedIdentity);
        try {
          if (!v4) {
            const stats = await opened.handle.stat();
            if (stats.size !== file.size || stats.mtimeMs !== file.mtimeMs) {
              fail('CAPABILITY_DESKTOP_FILE_GRANT_SOURCE_CHANGED');
            }
          }
          if (await sha256FromHandle(opened.handle) !== file.sha256) {
            fail('CAPABILITY_DESKTOP_FILE_GRANT_SOURCE_CHANGED');
          }
        } finally { await opened.handle.close().catch(() => {}); }
        grants.push({ grantId: file.grantId, scope: 'user-selected', sourcePath: file.sourcePath,
          access: 'read', displayName: file.displayName, identity: opened.identity });
      }
      return grants;
    } finally {
      try {
        await exclusive(async () => {
          const entries = await readIndex();
          const current = entries.find(item => item.authorizationId === entry.authorizationId);
          if (!current || current.state !== 'consuming') {
            fail('CAPABILITY_DESKTOP_FILE_GRANT_LEDGER_INVALID');
          }
          current.state = 'consumed';
          current.consumedAt = iso(now());
          try { await writeIndex(entries); }
          finally { await credentialVault.remove(secretKey(entry.authorizationId)); }
        });
      } finally { activeConsumptions.delete(entry.authorizationId); }
    }
  };
  const resolve = async ({ fileScope, contract, leaseId, signal } = {}) => {
    if (fileScope === 'none') return [];
    if (fileScope !== 'user-selected' || !CAPABILITY_KEY.test(contract?.key ?? '')
      || signal != null && !(signal instanceof AbortSignal)) {
      fail('CAPABILITY_DESKTOP_FILE_GRANT_SCOPE_INVALID', { safeFailure: true });
    }
    if (!requireTaskBinding) {
      const authorizationId = await exclusive(async () => {
        const entries = await expire(await readIndex());
        const entry = entries.find(item => item.state === 'pending'
          && item.capabilityKey === contract.key && item.executionLeaseId == null);
        await writeIndex(entries);
        if (!entry) fail('CAPABILITY_DESKTOP_FILE_AUTHORIZATION_REQUIRED', { safeFailure: true });
        return entry.authorizationId;
      });
      return consumeAuthorization({ authorizationId, capabilityKey: contract.key });
    }
    if (!UUID.test(leaseId ?? '')) {
      fail('CAPABILITY_DESKTOP_FILE_EXECUTION_LEASE_REQUIRED', { safeFailure: true });
    }
    if (!Number.isSafeInteger(contract.version) || contract.version < 1) {
      fail('CAPABILITY_DESKTOP_FILE_CONTRACT_VERSION_REQUIRED', { safeFailure: true });
    }
    const consent = await ensureConsentRequest({ executionLeaseId: leaseId,
      capabilityKey: contract.key, capabilityVersion: contract.version });
    for (;;) {
      if (signal?.aborted) {
        await cancelConsentRequest(consent.requestId, 'cancelled');
        fail('CAPABILITY_DESKTOP_FILE_CONSENT_CANCELLED', { safeFailure: true });
      }
      const state = await inspectConsent({ requestId: consent.requestId,
        executionLeaseId: leaseId, capabilityKey: contract.key,
        capabilityVersion: contract.version });
      if (state.authorizationId) {
        return consumeAuthorization({ authorizationId: state.authorizationId,
          capabilityKey: contract.key, capabilityVersion: contract.version,
          executionLeaseId: leaseId, requestId: consent.requestId });
      }
      if (state.state === 'approved') {
        fail('CAPABILITY_DESKTOP_FILE_CONSENT_REPLAYED', { safeFailure: true });
      }
      if (state.state === 'rejected') {
        fail('CAPABILITY_DESKTOP_FILE_CONSENT_REJECTED', { safeFailure: true });
      }
      if (['expired', 'cancelled'].includes(state.state)) {
        fail(state.state === 'cancelled' ? 'CAPABILITY_DESKTOP_FILE_CONSENT_CANCELLED'
          : 'CAPABILITY_DESKTOP_FILE_CONSENT_TIMEOUT', { safeFailure: true });
      }
      await sleep(consentPollMs);
    }
  };
  return { indexFile, requestFile, authorize, list, revoke, resolve,
    listConsentRequests, getConsentCenter, approveConsentRequest, rejectConsentRequest };
}
