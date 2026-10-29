import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { selectCapabilityComponentRelease } from './component-update-catalog.mjs';
import { downloadComponentFileResumable } from './resumable-downloader.mjs';

export function createCapabilityComponentManager({ store, bundleStore = null, downloadDirectory, trustedKeys,
  platform = 'win32-x64', fetchImpl = globalThis.fetch, now = () => new Date(),
  allowInsecureLocalhost = false, resolveDownloadUrl = value => value } = {}) {
  if (!store || typeof store.resolve !== 'function' || typeof store.install !== 'function'
    || !path.isAbsolute(downloadDirectory) || !Array.isArray(trustedKeys)
    || platform !== 'win32-x64' || typeof fetchImpl !== 'function' || typeof now !== 'function'
    || typeof resolveDownloadUrl !== 'function') fail('CAPABILITY_COMPONENT_MANAGER_CONFIG_INVALID');

  const ensure = async ({ catalog, component, engine, languages = [], signal } = {}) => {
    const release = selectCapabilityComponentRelease({ catalog, trustedKeys, now: now(),
      component, engine, platform, languages });
    const selectedStore = release.content?.kind === 'zip-bundle' ? bundleStore : store;
    if (!selectedStore || typeof selectedStore.resolve !== 'function'
      || typeof selectedStore.install !== 'function') {
      fail('CAPABILITY_COMPONENT_MANAGER_BUNDLE_STORE_REQUIRED', { safeFailure: true });
    }
    const installed = release.content?.kind === 'zip-bundle'
      ? await selectedStore.resolve({ component, release }) : await selectedStore.resolve(component);
    if (installed) return { ...installed, releaseSequence: release.releaseSequence,
      downloaded: false };
    const url = resolveDownloadUrl(release.download.url, release);
    if (typeof url !== 'string') fail('CAPABILITY_COMPONENT_DOWNLOAD_URL_INVALID');
    const sourceFile = await downloadComponentFileResumable({ url, destinationDirectory: downloadDirectory,
      expectedBytes: release.download.sizeBytes, expectedSha256: release.download.sha256,
      fetchImpl, signal, allowInsecureLocalhost });
    try {
      const result = await selectedStore.install({ release, sourceFile });
      return { ...result, releaseSequence: release.releaseSequence, downloaded: true };
    } finally {
      await fs.promises.rm(sourceFile, { force: true }).catch(() => {});
    }
  };

  return { ensure };
}
