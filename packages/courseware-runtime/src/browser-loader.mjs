import { validateCoursewareModuleLock } from './module-lock.mjs';
import { validateCoursewareModuleManifest } from './module-contract.mjs';

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) fail('COURSEWARE_MODULE_CRYPTO_UNAVAILABLE', 'Web Crypto SHA-256 is required to load release modules.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url, { credentials:'omit',cache:'no-store',redirect:'error' });
  if (!response?.ok) fail('COURSEWARE_MODULE_FETCH_FAILED', `Unable to load ${url}.`, { url,status:response?.status });
  return new Uint8Array(await response.arrayBuffer());
}

function sameReleaseUrl(base, relative) {
  const url = new URL(relative, base);
  if (url.origin !== base.origin) fail('COURSEWARE_MODULE_URL_INVALID', 'Release modules must stay on the release origin.', { url:url.href });
  return url;
}

export async function loadCoursewareModuleRelease({
  lockUrl = './dist/mooyu-modules.lock.json',
  registry,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  importModule = specifier => import(specifier),
  releaseBaseUrl = globalThis.location?.href,
} = {}) {
  if (!registry?.register || !fetchImpl || !releaseBaseUrl) fail('COURSEWARE_MODULE_LOADER_INVALID', 'A registry, fetch implementation and release URL are required.');
  const base = new URL(releaseBaseUrl);
  const resolvedLockUrl = sameReleaseUrl(base, lockUrl);
  const lockBytes = await fetchBytes(resolvedLockUrl, fetchImpl);
  let lock;
  try { lock = validateCoursewareModuleLock(JSON.parse(new TextDecoder().decode(lockBytes))); }
  catch (error) { fail(error.code ?? 'COURSEWARE_MODULE_LOCK_INVALID', error.message, { pointer:error.pointer }); }
  const loaded = [];
  for (const record of lock.modules) {
    const manifestUrl = sameReleaseUrl(base, record.manifest);
    const entryUrl = sameReleaseUrl(base, record.entry);
    const [manifestBytes, entryBytes] = await Promise.all([fetchBytes(manifestUrl, fetchImpl),fetchBytes(entryUrl, fetchImpl)]);
    const [manifestHash, entryHash] = await Promise.all([sha256(manifestBytes),sha256(entryBytes)]);
    if (`sha256:${manifestHash}` !== record.manifestIntegrity) fail('COURSEWARE_MODULE_INTEGRITY_MISMATCH', `Module manifest ${record.manifest} failed integrity verification.`, { moduleId:record.module.id,url:manifestUrl.href });
    if (`sha256:${entryHash}` !== record.module.integrity) fail('COURSEWARE_MODULE_INTEGRITY_MISMATCH', `Module entry ${record.entry} failed integrity verification.`, { moduleId:record.module.id,url:entryUrl.href });
    let sourceManifest;
    try { sourceManifest = validateCoursewareModuleManifest(JSON.parse(new TextDecoder().decode(manifestBytes))); }
    catch { fail('COURSEWARE_MODULE_MANIFEST_INVALID', `${record.manifest} is not JSON.`, { moduleId:record.module.id }); }
    if (JSON.stringify(sourceManifest) !== JSON.stringify(record.module)) fail('COURSEWARE_MODULE_LOCK_STALE', `Locked manifest ${record.manifest} differs from its source.`, { moduleId:record.module.id });
    const moduleUrl = URL.createObjectURL(new Blob([entryBytes], { type:'text/javascript' }));
    try {
      const namespace = await importModule(moduleUrl);
      const implementation = namespace.default ?? namespace.coursewareModule;
      if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation) || 'manifest' in implementation) fail('COURSEWARE_MODULE_EXPORT_INVALID', `Module ${record.module.id} must export implementation hooks without a manifest.`, { moduleId:record.module.id });
      registry.register({ ...implementation,manifest:record.module });
      loaded.push(record.module.id);
    } finally { URL.revokeObjectURL(moduleUrl); }
  }
  return Object.freeze({ lock,loaded:Object.freeze(loaded),roots:lock.roots });
}
