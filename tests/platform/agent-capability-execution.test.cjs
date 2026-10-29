const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../packages/agent-capabilities/src/execution.mjs')).href;
const digest = character => character.repeat(64);
const node = ({ id = '11111111-1111-4111-8111-111111111111', target = 'desktop',
  platform = 'windows-x64', online = true, userPresent = true, installed = [], memoryMiB = 8192 } = {}) => ({
  nodeId: id, target, platform, online, userPresent,
  available: { cpuCores: 4, memoryMiB, diskMiB: 20480, gpuMemoryMiB: 0 },
  permissions: { files: 'user-selected', networkDomains: target === 'cloud' ? ['api.document.example'] : [], devices: [] },
  installed,
});

const manifest = {
  format: 'mooyu.capability-execution', schemaVersion: 1,
  capabilityId: 'research.paper.layout', capabilityVersion: '1.0.0',
  contract: { key: 'research.paper.layout', version: 1 },
  placements: [
    { target: 'desktop', adapter: 'native-package', priority: 100,
      platforms: ['windows-x64', 'macos-arm64', 'linux-x64'],
      resources: { cpuCores: 2, memoryMiB: 2048, diskMiB: 4096, gpuMemoryMiB: 0 },
      permissions: { files: 'user-selected', networkDomains: [], devices: [] },
      dataPolicy: { localOnly: true, upload: 'never' }, offline: true, background: true,
      package: { url: 'https://downloads.mooyu.fun/capabilities/paper-layout/1.0.0/windows-x64.zip',
        sha256: digest('a'), signature: 'signed-capability-package-value-0001', keyId: 'mooyu-release-2026-10',
        sizeBytes: 420000000 } },
    { target: 'cloud', adapter: 'remote-provider', priority: 50, platforms: ['server-linux-x64'],
      resources: { cpuCores: 1, memoryMiB: 512, diskMiB: 0, gpuMemoryMiB: 0 },
      permissions: { files: 'none', networkDomains: ['api.document.example'], devices: [] },
      dataPolicy: { localOnly: false, upload: 'consent' }, offline: false, background: true,
      package: null },
  ],
  selectionPolicy: { preference: ['desktop', 'cloud'], cloudFallback: 'consent',
    requiresUserPresence: false, queueWhenOffline: true },
};

test('execution manifest is strict and preserves local-only boundaries', async () => {
  const api = await import(moduleUrl);
  assert.deepEqual(api.validateCapabilityExecutionManifestV1(manifest), manifest);
  assert.throws(() => api.validateCapabilityExecutionManifestV1({ ...manifest, extra: true }),
    error => error.code === 'CAPABILITY_EXECUTION_MANIFEST_INVALID');
  const unsafe = structuredClone(manifest);
  unsafe.placements[0].dataPolicy.upload = 'allowed';
  assert.throws(() => api.validateCapabilityExecutionManifestV1(unsafe),
    error => error.code === 'CAPABILITY_EXECUTION_LOCAL_ONLY_INVALID');
});

test('selector requests a signed package, then selects the installed local capability', async () => {
  const api = await import(moduleUrl);
  const first = api.selectCapabilityExecution(manifest,
    { nodes: [node()], cloudConsent: false, userPresent: true });
  assert.equal(first.status, 'download-required');
  assert.equal(first.target, 'desktop');
  assert.equal(first.download.sha256, digest('a'));
  const ready = api.selectCapabilityExecution(manifest, { nodes: [node({ installed: [{
    capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
    packageSha256: digest('a'),
  }] })], cloudConsent: false, userPresent: true });
  assert.deepEqual(ready, { status: 'ready', target: 'desktop',
    nodeId: '11111111-1111-4111-8111-111111111111', placementIndex: 0, download: null, reasons: [] });
});

test('selector queues offline local work and requires consent before cloud fallback', async () => {
  const api = await import(moduleUrl);
  const waiting = api.selectCapabilityExecution(manifest,
    { nodes: [node({ online: false })], cloudConsent: false, userPresent: true });
  assert.equal(waiting.status, 'consent-required');
  assert.equal(waiting.reasons[0], 'CLOUD_PROCESSING_CONSENT_REQUIRED');
  const cloud = node({ id: '22222222-2222-4222-8222-222222222222', target: 'cloud',
    platform: 'server-linux-x64', memoryMiB: 4096 });
  const selected = api.selectCapabilityExecution(manifest,
    { nodes: [node({ online: false }), cloud], cloudConsent: true, userPresent: true });
  assert.equal(selected.status, 'ready');
  assert.equal(selected.target, 'cloud');
});

test('selector fails closed when resources or user presence are unavailable', async () => {
  const api = await import(moduleUrl);
  const constrained = api.selectCapabilityExecution(manifest,
    { nodes: [node({ memoryMiB: 1024 })], cloudConsent: false, userPresent: true });
  assert.equal(constrained.status, 'consent-required');
  const foreground = structuredClone(manifest);
  foreground.selectionPolicy.requiresUserPresence = true;
  assert.equal(api.selectCapabilityExecution(foreground,
    { nodes: [node()], cloudConsent: false, userPresent: false }).status, 'waiting-for-user');
});

test('selector never places work on a node whose permission ceiling is too narrow', async () => {
  const api = await import(moduleUrl);
  const local = structuredClone(manifest);
  local.placements = [local.placements[0]];
  local.placements[0].permissions.devices = ['gpu'];
  local.selectionPolicy = { preference: ['desktop'], cloudFallback: 'never',
    requiresUserPresence: false, queueWhenOffline: true };
  assert.equal(api.selectCapabilityExecution(local,
    { nodes: [node()], cloudConsent: false, userPresent: true }).status, 'unavailable');
});
