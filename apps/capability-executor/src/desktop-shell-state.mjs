import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';

const INSTALL_STATES = new Set(['installing', 'installed', 'repair-required', 'uninstalling',
  'uninstalled']);

const exactKeys = (value, required, optional = []) => value && typeof value === 'object'
  && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));

const iso = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('CAPABILITY_DESKTOP_SHELL_INSTALL_STATE_INVALID');
  return date.toISOString();
};

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
  await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  try { await renameWithWindowsRetry(temporary, file); }
  catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function normalizeInstallation(value) {
  const required = ['schemaVersion', 'installationId', 'productId', 'installVersion', 'state',
    'dataRoot', 'launchCommand', 'startup', 'installedAt', 'updatedAt'];
  const optional = ['lastErrorCode', 'uninstalledAt', 'dataPreserved'];
  if (!exactKeys(value, required, optional)
    || value.schemaVersion !== 'capability-desktop-shell-installation-v1'
    || typeof value.installationId !== 'string' || value.installationId.length < 10
    || value.productId !== 'mooyu-capability-node' || typeof value.installVersion !== 'string'
    || value.installVersion.length < 1 || value.installVersion.length > 100
    || !INSTALL_STATES.has(value.state) || !path.isAbsolute(value.dataRoot)
    || !Array.isArray(value.launchCommand) || value.launchCommand.length < 1
    || value.launchCommand.length > 32 || value.launchCommand.some(item => typeof item !== 'string'
      || item.length < 1 || item.length > 4096)
    || !exactKeys(value.startup, ['enabled', 'provider', 'valueName'])
    || typeof value.startup.enabled !== 'boolean' || value.startup.provider !== 'hkcu-run'
    || typeof value.startup.valueName !== 'string' || value.startup.valueName.length < 1
    || value.startup.valueName.length > 100) {
    fail('CAPABILITY_DESKTOP_SHELL_INSTALL_STATE_INVALID');
  }
  for (const field of ['installedAt', 'updatedAt', 'uninstalledAt']) {
    if (value[field] != null) iso(value[field]);
  }
  if (value.lastErrorCode != null && (typeof value.lastErrorCode !== 'string'
    || !/^[A-Z0-9_]{1,160}$/u.test(value.lastErrorCode))) {
    fail('CAPABILITY_DESKTOP_SHELL_INSTALL_STATE_INVALID');
  }
  return structuredClone(value);
}

export function createDesktopShellInstallationStore({ rootDirectory, now = () => new Date() } = {}) {
  if (!path.isAbsolute(rootDirectory) || typeof now !== 'function') {
    fail('CAPABILITY_DESKTOP_SHELL_INSTALL_CONFIG_INVALID');
  }
  const directory = path.join(rootDirectory, 'desktop-shell');
  const manifestFile = path.join(directory, 'installation.json');
  const read = async () => {
    let value;
    try { value = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail('CAPABILITY_DESKTOP_SHELL_INSTALL_STATE_INVALID');
    }
    return normalizeInstallation(value);
  };
  const write = async input => {
    const previous = await read().catch(() => null);
    const value = normalizeInstallation({ ...input,
      installedAt: input.installedAt ?? previous?.installedAt ?? iso(now()),
      updatedAt: iso(now()),
    });
    await atomicJson(manifestFile, value);
    return value;
  };
  return { directory, manifestFile, read, write };
}

export function projectDesktopShellView({ installation = null, nodeStatus = null,
  startupEnabled = false, pendingFileConsentCount = 0, fileConsentCenter = null } = {}) {
  if (!Number.isSafeInteger(pendingFileConsentCount) || pendingFileConsentCount < 0) {
    fail('CAPABILITY_DESKTOP_SHELL_VIEW_INVALID');
  }
  if (fileConsentCenter != null && (fileConsentCenter.schemaVersion
      !== 'capability-desktop-file-consent-center-v1'
    || !Number.isSafeInteger(fileConsentCenter.notificationCount)
    || !Number.isSafeInteger(fileConsentCenter.activeCount)
    || fileConsentCenter.notificationCount < 0 || fileConsentCenter.activeCount < 0
    || fileConsentCenter.notificationCount !== pendingFileConsentCount)) {
    fail('CAPABILITY_DESKTOP_SHELL_VIEW_INVALID');
  }
  const installed = installation?.state === 'installed';
  const nodeState = nodeStatus?.state ?? null;
  let state = 'not-installed';
  if (installation && !installed) state = installation.state === 'uninstalled'
    ? 'not-installed' : 'attention';
  else if (installed) {
    if (nodeState === 'running') state = 'working';
    else if (nodeState === 'ready') state = 'ready';
    else if (nodeState === 'paused') state = 'paused';
    else if (['starting', 'recovering', 'checking-update', 'backoff'].includes(nodeState)) {
      state = 'starting';
    } else if (['failed', 'circuit-open'].includes(nodeState)) state = 'attention';
    else state = 'stopped';
  }
  const actions = {
    pause: ['ready', 'working', 'starting'].includes(state),
    resume: state === 'paused',
    stop: !['not-installed', 'stopped'].includes(state),
    diagnostics: installation != null,
    repair: state === 'attention',
    selectFiles: installed && !['attention', 'not-installed'].includes(state),
    manageAuthorizations: installed,
    reviewFileRequests: installed && pendingFileConsentCount > 0,
  };
  const fileConsent = fileConsentCenter == null
    ? { schemaVersion: 'capability-desktop-file-consent-summary-v1',
      notificationCount: pendingFileConsentCount, activeCount: pendingFileConsentCount }
    : { schemaVersion: 'capability-desktop-file-consent-summary-v1',
      notificationCount: fileConsentCenter.notificationCount,
      activeCount: fileConsentCenter.activeCount };
  return { schemaVersion: 'capability-desktop-shell-view-v2', state, startupEnabled,
    nodeState, pendingFileConsentCount, fileConsent, actions,
    attentionCode: installation?.lastErrorCode ?? null };
}

export { normalizeInstallation as normalizeDesktopShellInstallation };
