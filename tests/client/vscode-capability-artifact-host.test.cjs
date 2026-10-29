const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const artifactId = '9a59180c-598e-4d63-9e6c-cfbdb315ab8d';
const runId = 'bf9af255-0b8f-49bb-9884-6a3dbf076a9f';
const now = Date.parse('2026-10-29T04:00:00.000Z');
const content = { z: 1, nested: { b: true, a: 'text' } };
const canonical = '{"nested":{"a":"text","b":true},"z":1}';
const sha256 = crypto.createHash('sha256').update(canonical).digest('hex');

const payload = (openMode = 'host-preview', overrides = {}) => ({
  directive: {
    schemaVersion: 'capability-artifact-open-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256,
    openMode, locator: `mooyu-artifact://${openMode}/${artifactId}`,
    expiresAt: new Date(now + 120000).toISOString(),
    ...overrides.directive,
  },
  artifact: {
    schemaVersion: 'capability-artifact-content-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256, content,
    ...overrides.artifact,
  },
});

function fixture() {
  const documents = []; const shown = []; const writes = [];
  let saveTarget;
  const vscode = {
    Uri: { file: fsPath => ({ fsPath }) },
    window: {
      showSaveDialog: async () => saveTarget,
      showTextDocument: async (document, options) => { shown.push({ document, options }); },
    },
    workspace: {
      openTextDocument: async options => { const document = { ...options }; documents.push(document); return document; },
      fs: { writeFile: async (target, bytes) => { writes.push({ target, bytes: Buffer.from(bytes) }); } },
    },
  };
  return { vscode, documents, shown, writes, setSaveTarget(value) { saveTarget = value; } };
}

test('VS Code host revalidates and repeatedly opens independent read-only previews across restart', async () => {
  const { createCapabilityArtifactHost } = require('../../extensions/vscode/capability-artifact-host.cjs');
  const f = fixture();
  const first = createCapabilityArtifactHost({ vscode: f.vscode, now: () => now });
  assert.deepEqual(await first.open(payload()), { opened: true, cancelled: false });
  assert.deepEqual(await first.open(payload()), { opened: true, cancelled: false });
  const restarted = createCapabilityArtifactHost({ vscode: f.vscode, now: () => now });
  assert.deepEqual(await restarted.open(payload()), { opened: true, cancelled: false });
  assert.equal(f.documents.length, 3);
  assert.equal(f.shown.length, 3);
  assert.equal(f.documents.every(item => item.language === 'json'), true);
  assert.equal(f.shown.every(item => item.options.preview === true), true);
  assert.equal(f.writes.length, 0);
});

test('VS Code native save cancellation writes nothing and a later retry writes verified bytes once', async () => {
  const { createCapabilityArtifactHost } = require('../../extensions/vscode/capability-artifact-host.cjs');
  const f = fixture();
  const host = createCapabilityArtifactHost({ vscode: f.vscode, now: () => now });
  assert.deepEqual(await host.open(payload('download')), { opened: false, cancelled: true });
  assert.equal(f.writes.length, 0);
  const target = { fsPath: 'C:/Users/test/verified.result.json' };
  f.setSaveTarget(target);
  assert.deepEqual(await host.open(payload('download')), { opened: true, cancelled: false });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].target, target);
  assert.deepEqual(JSON.parse(f.writes[0].bytes.toString('utf8')), content);
});

test('VS Code host rejects expired and altered payloads before preview or write', async () => {
  const { createCapabilityArtifactHost } = require('../../extensions/vscode/capability-artifact-host.cjs');
  const f = fixture();
  const host = createCapabilityArtifactHost({ vscode: f.vscode, now: () => now });
  await assert.rejects(host.open(payload('host-preview', {
    directive: { expiresAt: new Date(now - 1).toISOString() },
  })), { code: 'CAPABILITY_HOST_ARTIFACT_INTEGRITY' });
  await assert.rejects(host.open(payload('download', {
    artifact: { content: { ...content, z: 2 } },
  })), { code: 'CAPABILITY_HOST_ARTIFACT_INTEGRITY' });
  await assert.rejects(host.open(payload('host-preview', {
    directive: { name: '../unsafe' }, artifact: { name: '../unsafe' },
  })), { code: 'CAPABILITY_HOST_ARTIFACT_INTEGRITY' });
  await assert.rejects(host.open(payload('host-preview', {
    directive: { sizeBytes: 1048577 }, artifact: { sizeBytes: 1048577 },
  })), { code: 'CAPABILITY_HOST_ARTIFACT_INTEGRITY' });
  assert.equal(f.documents.length, 0);
  assert.equal(f.writes.length, 0);
});
