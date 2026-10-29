import crypto from 'node:crypto';
import path from 'node:path';
import { fail } from './errors.mjs';
import { createDesktopShellInstallationStore, projectDesktopShellView } from './desktop-shell-state.mjs';
import { removeDesktopShellControlSecret } from './desktop-shell-ipc.mjs';
import { redactDesktopNodeStatus } from './desktop-node-state.mjs';

const sleepDefault = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const aliveDefault = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
};

const errorCode = error => String(error?.code ?? 'CAPABILITY_DESKTOP_SHELL_OPERATION_FAILED')
  .replace(/[^A-Z0-9_]/gu, '_').slice(0, 160);
const parseVersion = value => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(value ?? '');
  if (!match) fail('CAPABILITY_DESKTOP_SHELL_INSTALL_VERSION_INVALID');
  return { parts: match.slice(1, 4).map(Number), prerelease: match[4] ?? null };
};
const compareVersion = (left, right) => {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] - b.parts[index];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease == null) return 1;
  if (b.prerelease == null) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en');
};

export function createDesktopShellManager({ rootDirectory, startupRegistry, stateStore,
  credentialVault, installationStore = null, now = () => new Date(), sleep = sleepDefault,
  isProcessAlive = aliveDefault, stopTimeoutMs = 30_000, stopPollMs = 250 } = {}) {
  if (!path.isAbsolute(rootDirectory) || !startupRegistry
    || typeof startupRegistry.query !== 'function' || typeof startupRegistry.enable !== 'function'
    || typeof startupRegistry.disable !== 'function' || !stateStore
    || typeof stateStore.readStatus !== 'function' || typeof stateStore.requestControl !== 'function'
    || !credentialVault || typeof credentialVault.remove !== 'function'
    || !Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1000
    || !Number.isSafeInteger(stopPollMs) || stopPollMs < 10) {
    fail('CAPABILITY_DESKTOP_SHELL_MANAGER_CONFIG_INVALID');
  }
  installationStore ??= createDesktopShellInstallationStore({ rootDirectory, now });

  const snapshot = async () => {
    const installation = await installationStore.read();
    const startup = installation ? await startupRegistry.query(installation.startup.valueName)
      : { enabled: false, commandLine: null };
    const nodeStatus = redactDesktopNodeStatus(await stateStore.readStatus().catch(() => null));
    return { installation, startup, nodeStatus,
      view: projectDesktopShellView({ installation, nodeStatus, startupEnabled: startup.enabled }) };
  };

  const writeState = (base, state, additions = {}) => installationStore.write({ ...base, state,
    ...additions });

  const install = async ({ installVersion, launchCommand, startupValueName,
    enableStartup = true, allowRecoveryDowngrade = false } = {}) => {
    if (typeof installVersion !== 'string' || installVersion.length < 1
      || !Array.isArray(launchCommand) || typeof startupValueName !== 'string'
      || typeof allowRecoveryDowngrade !== 'boolean') {
      fail('CAPABILITY_DESKTOP_SHELL_INSTALL_CONFIG_INVALID');
    }
    parseVersion(installVersion);
    const previous = await installationStore.read();
    if (!allowRecoveryDowngrade && previous?.state !== 'uninstalled' && previous?.installVersion
      && compareVersion(installVersion, previous.installVersion) < 0) {
      fail('CAPABILITY_DESKTOP_SHELL_INSTALL_DOWNGRADE_BLOCKED');
    }
    const base = { schemaVersion: 'capability-desktop-shell-installation-v1',
      installationId: previous && previous.state !== 'uninstalled'
        ? previous.installationId : crypto.randomUUID(),
      productId: 'mooyu-capability-node', installVersion, dataRoot: rootDirectory,
      launchCommand: [...launchCommand], startup: { enabled: enableStartup,
        provider: 'hkcu-run', valueName: startupValueName },
      installedAt: previous?.installedAt ?? now().toISOString(), updatedAt: now().toISOString() };
    await writeState(base, 'installing');
    try {
      if (enableStartup) await startupRegistry.enable({ valueName: startupValueName,
        command: launchCommand });
      else await startupRegistry.disable(startupValueName);
      return await writeState(base, 'installed', { lastErrorCode: null });
    } catch (error) {
      await writeState(base, 'repair-required', { lastErrorCode: errorCode(error) });
      throw error;
    }
  };

  const repair = async () => {
    const installation = await installationStore.read();
    if (!installation || installation.state === 'uninstalled') {
      fail('CAPABILITY_DESKTOP_SHELL_NOT_INSTALLED');
    }
    try {
      if (installation.startup.enabled) await startupRegistry.enable({
        valueName: installation.startup.valueName, command: installation.launchCommand });
      else await startupRegistry.disable(installation.startup.valueName);
      return await writeState(installation, 'installed', { lastErrorCode: null });
    } catch (error) {
      await writeState(installation, 'repair-required', { lastErrorCode: errorCode(error) });
      throw error;
    }
  };

  const setStartup = async enabled => {
    if (typeof enabled !== 'boolean') fail('CAPABILITY_DESKTOP_SHELL_STARTUP_CONFIG_INVALID');
    const installation = await installationStore.read();
    if (!installation || installation.state !== 'installed') {
      fail('CAPABILITY_DESKTOP_SHELL_NOT_INSTALLED');
    }
    const changed = { ...installation, startup: { ...installation.startup, enabled } };
    try {
      if (enabled) await startupRegistry.enable({ valueName: changed.startup.valueName,
        command: changed.launchCommand });
      else await startupRegistry.disable(changed.startup.valueName);
      return await writeState(changed, 'installed', { lastErrorCode: null });
    } catch (error) {
      await writeState(changed, 'repair-required', { lastErrorCode: errorCode(error) });
      throw error;
    }
  };

  const waitForStop = async () => {
    const initial = await stateStore.readStatus().catch(() => null);
    if (!initial || initial.state === 'stopped' || !isProcessAlive(initial.pid)) return;
    await stateStore.requestControl('stop');
    const deadline = now().getTime() + stopTimeoutMs;
    while (now().getTime() < deadline) {
      await sleep(stopPollMs);
      const status = await stateStore.readStatus().catch(() => null);
      if (!status || status.state === 'stopped' || !isProcessAlive(status.pid)) return;
    }
    fail('CAPABILITY_DESKTOP_SHELL_STOP_TIMEOUT');
  };

  const uninstall = async () => {
    const installation = await installationStore.read();
    if (!installation || installation.state === 'uninstalled') {
      return installation ?? { state: 'uninstalled', dataPreserved: true };
    }
    await writeState(installation, 'uninstalling');
    try {
      await waitForStop();
      await startupRegistry.disable(installation.startup.valueName);
      await removeDesktopShellControlSecret(credentialVault);
      return await writeState(installation, 'uninstalled', { lastErrorCode: null,
        uninstalledAt: now().toISOString(), dataPreserved: true,
        startup: { ...installation.startup, enabled: false } });
    } catch (error) {
      await writeState(installation, 'repair-required', { lastErrorCode: errorCode(error) });
      throw error;
    }
  };

  const recover = async () => {
    const installation = await installationStore.read();
    if (!installation || ['installed', 'uninstalled'].includes(installation.state)) {
      return installation;
    }
    if (installation.state === 'uninstalling') return uninstall();
    return repair();
  };

  return { installationStore, snapshot, install, repair, recover, setStartup, uninstall };
}
