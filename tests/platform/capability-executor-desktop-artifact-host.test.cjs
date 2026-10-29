const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const artifactId = '9a59180c-598e-4d63-9e6c-cfbdb315ab8d';
const runId = 'bf9af255-0b8f-49bb-9884-6a3dbf076a9f';
const now = Date.parse('2026-10-29T05:00:00.000Z');
const content = { z: 1, nested: { b: true, a: 'text' } };
const canonical = '{"nested":{"a":"text","b":true},"z":1}';
const sha256 = crypto.createHash('sha256').update(canonical).digest('hex');
const payload = (openMode = 'host-preview', overrides = {}) => ({
  directive: { schemaVersion: 'capability-artifact-open-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256,
    openMode, locator: `mooyu-artifact://${openMode}/${artifactId}`,
    expiresAt: new Date(now + 120000).toISOString(), ...overrides.directive },
  artifact: { schemaVersion: 'capability-artifact-content-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256, content,
    ...overrides.artifact },
});

test('desktop host reuses shared verification for read-only preview across shell restart', async () => {
  const api = await import(apiUrl), previews = [];
  const ui = { async previewJson(request) { previews.push(request);
    return { opened: true, cancelled: false }; },
  async saveJson() { throw new Error('unexpected save'); } };
  const first = api.createDesktopCapabilityArtifactHost({ nativeArtifactUi: ui, now: () => now });
  assert.deepEqual(await first.open(payload()), { opened: true, cancelled: false });
  const restarted = api.createDesktopCapabilityArtifactHost({ nativeArtifactUi: ui,
    now: () => now });
  assert.deepEqual(await restarted.open(payload('external-app')),
    { opened: true, cancelled: false });
  assert.equal(previews.length, 2);
  assert.equal(previews.every(item => item.readOnly === true), true);
  assert.equal(previews[0].content, `${JSON.stringify(content, null, 2)}\n`);
  assert.equal(previews[1].requestedMode, 'external-app');
});

test('desktop host preserves native save cancellation and rejects tampering before UI', async () => {
  const api = await import(apiUrl); let saves = 0;
  const ui = { async previewJson() { throw new Error('unexpected preview'); },
    async saveJson() { saves += 1; return saves === 1
      ? { opened: false, cancelled: true } : { opened: true, cancelled: false }; } };
  const host = api.createDesktopCapabilityArtifactHost({ nativeArtifactUi: ui, now: () => now });
  assert.deepEqual(await host.open(payload('download')), { opened: false, cancelled: true });
  assert.deepEqual(await host.open(payload('download')), { opened: true, cancelled: false });
  await assert.rejects(host.open(payload('download', {
    artifact: { content: { ...content, z: 2 } },
  })), error => error.code === 'CAPABILITY_HOST_ARTIFACT_INTEGRITY');
  assert.equal(saves, 2);
});

test('Windows native adapter writes only after a local save choice and never exposes the path', async () => {
  const api = await import(apiUrl), writes = [], calls = [];
  const target = path.resolve('.runtime/desktop-artifact-tests/verified.result.json');
  const outputs = [JSON.stringify({ selectedPath: null, cancelled: true }),
    JSON.stringify({ selectedPath: target, cancelled: false })];
  const ui = api.createWindowsCapabilityArtifactUi({ platform: 'win32',
    run: async request => { calls.push(request); return outputs.shift(); },
    fileSystem: { async writeFile(...args) { writes.push(args); } } });
  const request = { title: 'verified.result', suggestedName: 'verified.result.json',
    mediaType: 'application/json', content: '{\n  "ok": true\n}\n', readOnly: true,
    requestedMode: 'download' };
  assert.deepEqual(await ui.saveJson(request), { opened: false, cancelled: true });
  assert.equal(writes.length, 0);
  assert.deepEqual(await ui.saveJson(request), { opened: true, cancelled: false });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], target);
  assert.equal(writes[0][1], request.content);
  assert.deepEqual(calls.map(item => item.action), ['save', 'save']);
});

test('Windows native adapter fails closed on forged dialog output', async () => {
  const api = await import(apiUrl), writes = [];
  const request = { title: 'verified.result', suggestedName: 'verified.result.json',
    mediaType: 'application/json', content: '{}\n', readOnly: true, requestedMode: 'download' };
  const ui = api.createWindowsCapabilityArtifactUi({ platform: 'win32',
    run: async () => JSON.stringify({ selectedPath: 'relative.json', cancelled: false }),
    fileSystem: { async writeFile(...args) { writes.push(args); } } });
  await assert.rejects(ui.saveJson(request), error =>
    error.code === 'CAPABILITY_DESKTOP_ARTIFACT_UI_OUTPUT_INVALID');
  assert.equal(writes.length, 0);
  const preview = api.createWindowsCapabilityArtifactUi({ platform: 'win32',
    run: async () => JSON.stringify({ opened: false, cancelled: true }),
    fileSystem: { async writeFile() {} } });
  await assert.rejects(preview.previewJson({ ...request, requestedMode: 'host-preview' }), error =>
    error.code === 'CAPABILITY_DESKTOP_ARTIFACT_UI_OUTPUT_INVALID');
});

test('desktop shell exposes the trusted opener without putting artifact bodies on control IPC', async () => {
  const api = await import(apiUrl); let opened = 0;
  const stateStore = { async readStatus() { return null; }, async requestControl() {}, };
  const supervisor = { stateStore, async run() { return { status: 'stopped' }; } };
  const controlServer = { async start() {}, async close() {} };
  const shell = api.createDesktopShellHost({ rootDirectory: path.resolve('.runtime/shell'),
    supervisor, credentialVault: {}, controlServer,
    capabilityArtifactHost: { async open(value) { opened += 1; return value; } } });
  assert.deepEqual(await shell.capabilityArtifacts.open({ local: true }), { local: true });
  assert.equal(opened, 1);
  assert.deepEqual(await shell.run(), { status: 'stopped' });
});

test('signed desktop release source carries the shared verifier beside the desktop adapter', async () => {
  const fs = require('node:fs');
  const buildSource = await fs.promises.readFile('scripts/build-windows-desktop-release.mjs', 'utf8');
  const hostSource = await fs.promises.readFile(
    'apps/capability-executor/src/desktop-capability-artifact-host.mjs', 'utf8');
  assert.match(buildSource, /packages', 'host-contract/u);
  assert.match(buildSource, /packages', 'agent-capabilities/u);
  assert.match(hostSource, /packages\/host-contract\/src\/capability-artifact-open\.mjs/u);
  assert.doesNotMatch(hostSource, /createHash|sha256CapabilityArtifact/u);
});
