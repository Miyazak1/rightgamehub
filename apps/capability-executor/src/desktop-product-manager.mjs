import path from 'node:path';
import { fail } from './errors.mjs';

const PRODUCT_ID = 'mooyu.windows.capability-desktop';
const releasePaths = release => {
  if (!release?.absoluteDirectory || !release?.manifest?.entrypoints) {
    fail('CAPABILITY_DESKTOP_PRODUCT_RELEASE_REQUIRED');
  }
  return Object.fromEntries(Object.entries(release.manifest.entrypoints).map(([name, entry]) =>
    [name, path.join(release.absoluteDirectory, ...entry.path.split('/'))]));
};

export function createWindowsDesktopProductManager({ productStore, shellManager, dataRoot,
  configurationPath, startupValueName = 'MooyuCapabilityNode', productId = PRODUCT_ID } = {}) {
  if (!productStore || typeof productStore.validateDirectory !== 'function'
    || typeof productStore.install !== 'function'
    || typeof productStore.active !== 'function' || typeof productStore.rollback !== 'function'
    || typeof productStore.repair !== 'function' || typeof productStore.deactivate !== 'function'
    || typeof productStore.purge !== 'function'
    || !shellManager || typeof shellManager.install !== 'function'
    || typeof shellManager.repair !== 'function' || typeof shellManager.uninstall !== 'function'
    || !shellManager.installationStore || !path.isAbsolute(dataRoot)
    || !path.isAbsolute(configurationPath) || typeof startupValueName !== 'string'
    || !/^[A-Za-z0-9_. -]{1,100}$/u.test(startupValueName)
    || productId !== PRODUCT_ID) fail('CAPABILITY_DESKTOP_PRODUCT_MANAGER_CONFIG_INVALID');

  const shellInstall = (release, { allowRecoveryDowngrade = false } = {}) => {
    const entries = releasePaths(release);
    return shellManager.install({ installVersion: release.manifest.productVersion,
      launchCommand: [entries.nodeRuntime, entries.shell, 'serve', '--config', configurationPath,
        '--root', dataRoot], startupValueName, enableStartup: true, allowRecoveryDowngrade });
  };

  const status = async () => {
    const [release, shell] = await Promise.all([productStore.active(productId),
      shellManager.snapshot()]);
    return { schemaVersion: 'windows-desktop-product-status-v1', productId,
      release: release == null ? null : { productVersion: release.manifest.productVersion,
        manifestSha256: release.manifestSha256 }, shell: shell.installation,
      ready: release != null && shell.installation?.state === 'installed'
        && shell.installation.installVersion === release.manifest.productVersion };
  };

  const restorePrevious = async ({ previousRelease, previousShell, failedManifestSha256 }) => {
    let restored = null;
    try {
      if (previousRelease) {
        restored = await productStore.rollback(productId, {
          expectedActiveManifestSha256: failedManifestSha256 });
        if (previousShell?.state === 'installed') {
          await shellInstall(restored, { allowRecoveryDowngrade: true });
          if (!previousShell.startup.enabled) await shellManager.setStartup(false);
        } else await shellManager.uninstall();
      } else {
        await productStore.deactivate(productId, {
          expectedActiveManifestSha256: failedManifestSha256 });
        await shellManager.uninstall();
      }
      return restored;
    } catch (error) {
      const failure = new Error('CAPABILITY_DESKTOP_PRODUCT_ROLLBACK_FAILED', { cause: error });
      failure.code = 'CAPABILITY_DESKTOP_PRODUCT_ROLLBACK_FAILED';
      throw failure;
    }
  };

  const install = async ({ sourceDirectory } = {}) => {
    const candidate = await productStore.validateDirectory(sourceDirectory);
    if (candidate.manifest.productId !== productId) fail('CAPABILITY_DESKTOP_PRODUCT_ID_MISMATCH');
    const previousRelease = await productStore.active(productId);
    const previousShell = await shellManager.installationStore.read();
    const installed = await productStore.install({ sourceDirectory });
    try {
      const shell = await shellInstall(installed.active);
      return { schemaVersion: 'windows-desktop-product-operation-v1', operation: 'install',
        productId, productVersion: installed.active.manifest.productVersion,
        manifestSha256: installed.active.manifestSha256, existing: installed.existing,
        shellState: shell.state, entrypoints: releasePaths(installed.active) };
    } catch (error) {
      await restorePrevious({ previousRelease, previousShell,
        failedManifestSha256: installed.active.manifestSha256 });
      throw error;
    }
  };

  const validateSource = async ({ sourceDirectory } = {}) => {
    const candidate = await productStore.validateDirectory(sourceDirectory);
    if (candidate.manifest.productId !== productId) fail('CAPABILITY_DESKTOP_PRODUCT_ID_MISMATCH');
    return candidate;
  };

  const rollback = async ({ expectedActiveManifestSha256 } = {}) => {
    if (typeof expectedActiveManifestSha256 !== 'string') {
      fail('CAPABILITY_DESKTOP_PRODUCT_ROLLBACK_INPUT_INVALID');
    }
    let restored;
    try {
      restored = await productStore.rollback(productId, { expectedActiveManifestSha256 });
    } catch (error) {
      if (error?.code !== 'CAPABILITY_DESKTOP_RELEASE_ROLLBACK_UNAVAILABLE') throw error;
      await productStore.deactivate(productId, { expectedActiveManifestSha256 });
      await shellManager.uninstall();
      return { schemaVersion: 'windows-desktop-product-operation-v1', operation: 'rollback',
        productId, state: 'not-installed' };
    }
    const shell = await shellInstall(restored, { allowRecoveryDowngrade: true });
    return { schemaVersion: 'windows-desktop-product-operation-v1', operation: 'rollback',
      productId, state: 'installed', productVersion: restored.manifest.productVersion,
      manifestSha256: restored.manifestSha256, shellState: shell.state };
  };

  const repair = async ({ sourceDirectory } = {}) => {
    let release;
    try { release = await productStore.active(productId); }
    catch (error) {
      if (!sourceDirectory) throw error;
      release = await productStore.repair(productId, { sourceDirectory });
    }
    if (!release) fail('CAPABILITY_DESKTOP_PRODUCT_NOT_INSTALLED');
    const shell = await shellInstall(release);
    return { schemaVersion: 'windows-desktop-product-operation-v1', operation: 'repair',
      productId, productVersion: release.manifest.productVersion,
      manifestSha256: release.manifestSha256, shellState: shell.state,
      entrypoints: releasePaths(release) };
  };

  const recover = async () => {
    const release = await productStore.active(productId);
    const shell = await shellManager.installationStore.read();
    if (!release) {
      if (shell && shell.state !== 'uninstalled') await shellManager.uninstall();
      return { schemaVersion: 'windows-desktop-product-operation-v1', operation: 'recover',
        productId, state: 'not-installed' };
    }
    if (shell?.state === 'installed' && shell.installVersion === release.manifest.productVersion) {
      await shellManager.repair();
    } else await shellInstall(release);
    return { schemaVersion: 'windows-desktop-product-operation-v1', operation: 'recover',
      productId, state: 'installed', productVersion: release.manifest.productVersion,
      manifestSha256: release.manifestSha256 };
  };

  const uninstall = async () => {
    const release = await productStore.active(productId);
    const shell = await shellManager.uninstall();
    if (release) await productStore.deactivate(productId,
      { expectedActiveManifestSha256: release.manifestSha256 });
    const purged = await productStore.purge(productId);
    return { schemaVersion: 'windows-desktop-product-operation-v1', operation: 'uninstall',
      productId, programsRemoved: purged.programsRemoved, dataPreserved: shell.dataPreserved !== false,
      dataRoot };
  };

  return { productId, status, validateSource, install, repair, rollback, recover, uninstall };
}

export { PRODUCT_ID as WINDOWS_DESKTOP_PRODUCT_ID };
