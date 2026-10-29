export const CAPABILITY_EXECUTION_FORMAT = 'mooyu.capability-execution';
export const CAPABILITY_EXECUTION_SCHEMA_VERSION = 1;

const TARGETS = new Set(['browser', 'desktop', 'cloud']);
const ADAPTERS = new Set(['trusted-react', 'wasm', 'native-package', 'hosted-worker', 'remote-provider']);
const PLATFORMS = new Set(['web', 'windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64',
  'linux-x64', 'linux-arm64', 'server-linux-x64', 'server-linux-arm64']);
const FILE_SCOPES = new Set(['none', 'user-selected', 'workspace']);
const UPLOAD_POLICIES = new Set(['never', 'consent', 'allowed']);
const CLOUD_FALLBACK = new Set(['never', 'consent', 'allowed']);
const DEVICES = new Set(['camera', 'microphone', 'gpu']);
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CAPABILITY_ID = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/u;
const CONTRACT_KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class CapabilityExecutionContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CapabilityExecutionContractError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new CapabilityExecutionContractError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key))
  && keys.every(key => Object.hasOwn(value, key));
const string = (value, min, max, pattern = null) => typeof value === 'string'
  && value.trim() === value && value.length >= min && value.length <= max && (!pattern || pattern.test(value));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const unique = values => Array.isArray(values) && new Set(values).size === values.length;
const clone = value => structuredClone(value);

function validatePackage(value) {
  if (!exact(value, ['url', 'sha256', 'signature', 'keyId', 'sizeBytes'])
    || !string(value.url, 8, 2000) || !value.url.startsWith('https://')
    || !string(value.sha256, 64, 64, SHA256)
    || !string(value.signature, 32, 4096)
    || !string(value.keyId, 3, 120, CONTRACT_KEY)
    || !integer(value.sizeBytes, 1, 50 * 1024 * 1024 * 1024)) fail('CAPABILITY_EXECUTION_PACKAGE_INVALID');
}

function validatePlacement(value) {
  if (!exact(value, ['target', 'adapter', 'priority', 'platforms', 'resources', 'permissions',
    'dataPolicy', 'offline', 'background', 'package'])
    || !TARGETS.has(value.target) || !ADAPTERS.has(value.adapter)
    || !integer(value.priority, 1, 100) || !unique(value.platforms) || value.platforms.length < 1
    || value.platforms.length > 9 || value.platforms.some(platform => !PLATFORMS.has(platform))
    || !exact(value.resources, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || !integer(value.resources.cpuCores, 1, 256)
    || !integer(value.resources.memoryMiB, 16, 1048576)
    || !integer(value.resources.diskMiB, 0, 10485760)
    || !integer(value.resources.gpuMemoryMiB, 0, 1048576)
    || !exact(value.permissions, ['files', 'networkDomains', 'devices'])
    || !FILE_SCOPES.has(value.permissions.files)
    || !unique(value.permissions.networkDomains) || value.permissions.networkDomains.length > 32
    || value.permissions.networkDomains.some(domain => !string(domain, 1, 253)
      || !/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(domain))
    || !unique(value.permissions.devices) || value.permissions.devices.length > 3
    || value.permissions.devices.some(device => !DEVICES.has(device))
    || !exact(value.dataPolicy, ['localOnly', 'upload'])
    || typeof value.dataPolicy.localOnly !== 'boolean' || !UPLOAD_POLICIES.has(value.dataPolicy.upload)
    || typeof value.offline !== 'boolean' || typeof value.background !== 'boolean') {
    fail('CAPABILITY_EXECUTION_PLACEMENT_INVALID');
  }
  if (value.dataPolicy.localOnly && (value.target === 'cloud' || value.dataPolicy.upload !== 'never')) {
    fail('CAPABILITY_EXECUTION_LOCAL_ONLY_INVALID');
  }
  if (value.target === 'browser' && !value.platforms.includes('web')) fail('CAPABILITY_EXECUTION_BROWSER_PLATFORM_INVALID');
  if (value.target !== 'browser' && value.platforms.includes('web')) fail('CAPABILITY_EXECUTION_PLATFORM_INVALID');
  if (['wasm', 'native-package'].includes(value.adapter)) {
    if (!object(value.package)) fail('CAPABILITY_EXECUTION_PACKAGE_REQUIRED');
    validatePackage(value.package);
  } else if (value.package !== null) fail('CAPABILITY_EXECUTION_PACKAGE_UNEXPECTED');
  if (value.adapter === 'trusted-react' && value.target !== 'browser'
    || value.adapter === 'native-package' && value.target !== 'desktop'
    || value.adapter === 'hosted-worker' && value.target !== 'cloud') {
    fail('CAPABILITY_EXECUTION_ADAPTER_TARGET_INVALID');
  }
}

export function validateCapabilityExecutionManifestV1(value) {
  if (!exact(value, ['format', 'schemaVersion', 'capabilityId', 'capabilityVersion', 'contract',
    'placements', 'selectionPolicy'])
    || value.format !== CAPABILITY_EXECUTION_FORMAT
    || value.schemaVersion !== CAPABILITY_EXECUTION_SCHEMA_VERSION
    || !string(value.capabilityId, 3, 160, CAPABILITY_ID)
    || !string(value.capabilityVersion, 5, 64, SEMVER)
    || !exact(value.contract, ['key', 'version'])
    || !string(value.contract.key, 3, 120, CONTRACT_KEY)
    || !integer(value.contract.version, 1, 2147483647)
    || !Array.isArray(value.placements) || value.placements.length < 1 || value.placements.length > 12
    || !exact(value.selectionPolicy, ['preference', 'cloudFallback', 'requiresUserPresence',
      'queueWhenOffline'])
    || !unique(value.selectionPolicy.preference) || value.selectionPolicy.preference.length < 1
    || value.selectionPolicy.preference.length > 3
    || value.selectionPolicy.preference.some(target => !TARGETS.has(target))
    || !CLOUD_FALLBACK.has(value.selectionPolicy.cloudFallback)
    || typeof value.selectionPolicy.requiresUserPresence !== 'boolean'
    || typeof value.selectionPolicy.queueWhenOffline !== 'boolean') {
    fail('CAPABILITY_EXECUTION_MANIFEST_INVALID');
  }
  for (const placement of value.placements) validatePlacement(placement);
  const placementTargets = new Set(value.placements.map(item => item.target));
  if (value.selectionPolicy.preference.some(target => !placementTargets.has(target))) {
    fail('CAPABILITY_EXECUTION_PREFERENCE_INVALID');
  }
  if (!placementTargets.has('cloud') && value.selectionPolicy.cloudFallback !== 'never') {
    fail('CAPABILITY_EXECUTION_CLOUD_FALLBACK_INVALID');
  }
  return clone(value);
}

function validateNode(node) {
  if (!exact(node, ['nodeId', 'target', 'platform', 'online', 'userPresent', 'available', 'permissions', 'installed'])
    || !string(node.nodeId, 36, 36, NODE_ID) || !TARGETS.has(node.target)
    || !PLATFORMS.has(node.platform) || typeof node.online !== 'boolean'
    || typeof node.userPresent !== 'boolean'
    || !exact(node.available, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || !integer(node.available.cpuCores, 0, 256)
    || !integer(node.available.memoryMiB, 0, 1048576)
    || !integer(node.available.diskMiB, 0, 10485760)
    || !integer(node.available.gpuMemoryMiB, 0, 1048576)
    || !exact(node.permissions, ['files', 'networkDomains', 'devices'])
    || !FILE_SCOPES.has(node.permissions.files)
    || !unique(node.permissions.networkDomains) || node.permissions.networkDomains.length > 64
    || node.permissions.networkDomains.some(domain => !string(domain, 1, 253)
      || !/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(domain))
    || !unique(node.permissions.devices) || node.permissions.devices.length > 3
    || node.permissions.devices.some(device => !DEVICES.has(device))
    || !Array.isArray(node.installed) || node.installed.length > 1024) fail('CAPABILITY_EXECUTION_NODE_INVALID');
  for (const item of node.installed) {
    if (!exact(item, ['capabilityId', 'capabilityVersion', 'packageSha256'])
      || !string(item.capabilityId, 3, 160, CAPABILITY_ID)
      || !string(item.capabilityVersion, 5, 64, SEMVER)
      || !(item.packageSha256 === null || string(item.packageSha256, 64, 64, SHA256))) {
      fail('CAPABILITY_EXECUTION_INSTALLATION_INVALID');
    }
  }
}

const enough = (available, required) => available.cpuCores >= required.cpuCores
  && available.memoryMiB >= required.memoryMiB && available.diskMiB >= required.diskMiB
  && available.gpuMemoryMiB >= required.gpuMemoryMiB;

const fileRank = { none: 0, 'user-selected': 1, workspace: 2 };
const domainAllowed = (required, allowed) => allowed === required
  || (allowed.startsWith('*.') && required.endsWith(allowed.slice(1))
    && required.length > allowed.length - 1);
const permits = (available, required) => fileRank[available.files] >= fileRank[required.files]
  && required.devices.every(device => available.devices.includes(device))
  && required.networkDomains.every(domain => available.networkDomains.some(item => domainAllowed(domain, item)));

function installed(node, manifest, placement) {
  if (placement.package === null) return true;
  return node.installed.some(item => item.capabilityId === manifest.capabilityId
    && item.capabilityVersion === manifest.capabilityVersion
    && item.packageSha256 === placement.package.sha256);
}

export function selectCapabilityExecution(manifestInput, context) {
  const manifest = validateCapabilityExecutionManifestV1(manifestInput);
  if (!exact(context, ['nodes', 'cloudConsent', 'userPresent']) || !Array.isArray(context.nodes)
    || context.nodes.length > 256 || typeof context.cloudConsent !== 'boolean'
    || typeof context.userPresent !== 'boolean') fail('CAPABILITY_EXECUTION_CONTEXT_INVALID');
  context.nodes.forEach(validateNode);
  if (manifest.selectionPolicy.requiresUserPresence && !context.userPresent) {
    return { status: 'waiting-for-user', target: null, nodeId: null, placementIndex: null,
      download: null, reasons: ['USER_PRESENCE_REQUIRED'] };
  }
  let sawOfflinePreferred = false;
  let sawDownload = null;
  for (const target of manifest.selectionPolicy.preference) {
    const placements = manifest.placements.map((placement, index) => ({ placement, index }))
      .filter(item => item.placement.target === target)
      .sort((left, right) => right.placement.priority - left.placement.priority || left.index - right.index);
    if (target === 'cloud' && manifest.selectionPolicy.cloudFallback === 'consent' && !context.cloudConsent) {
      return { status: 'consent-required', target: 'cloud', nodeId: null, placementIndex: null,
        download: null, reasons: ['CLOUD_PROCESSING_CONSENT_REQUIRED'] };
    }
    if (target === 'cloud' && manifest.selectionPolicy.cloudFallback === 'never'
      && manifest.selectionPolicy.preference[0] !== 'cloud') continue;
    for (const { placement, index } of placements) {
      const nodes = context.nodes.filter(node => node.target === target
        && placement.platforms.includes(node.platform) && enough(node.available, placement.resources)
        && permits(node.permissions, placement.permissions))
        .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
      if (nodes.some(node => !node.online)) sawOfflinePreferred = true;
      for (const node of nodes.filter(item => item.online)) {
        if (manifest.selectionPolicy.requiresUserPresence && !node.userPresent) continue;
        if (!installed(node, manifest, placement)) {
          sawDownload ??= { target, nodeId: node.nodeId, placementIndex: index,
            download: clone(placement.package), reasons: ['CAPABILITY_PACKAGE_REQUIRED'] };
          continue;
        }
        return { status: 'ready', target, nodeId: node.nodeId, placementIndex: index,
          download: null, reasons: [] };
      }
    }
    if (sawDownload?.target === target) return { status: 'download-required', ...sawDownload };
  }
  if (sawOfflinePreferred && manifest.selectionPolicy.queueWhenOffline) {
    return { status: 'waiting-for-device', target: null, nodeId: null, placementIndex: null,
      download: null, reasons: ['ELIGIBLE_DEVICE_OFFLINE'] };
  }
  return { status: 'unavailable', target: null, nodeId: null, placementIndex: null,
    download: null, reasons: ['NO_ELIGIBLE_EXECUTION_NODE'] };
}
