const test = require('node:test');
const assert = require('node:assert/strict');

const artifactId = '9a59180c-598e-4d63-9e6c-cfbdb315ab8d';
const runId = 'bf9af255-0b8f-49bb-9884-6a3dbf076a9f';
const content = { z: 1, nested: { b: true, a: 'text' } };

test('artifact open verification accepts canonical content and rejects tampering or expiry', async () => {
  const { sha256CapabilityArtifact, verifyCapabilityArtifactOpenPayload } = await import(
    '../../packages/host-contract/src/index.mjs');
  const sha256 = await sha256CapabilityArtifact(content);
  const expiresAt = new Date(Date.now() + 120000).toISOString();
  const directive = { schemaVersion: 'capability-artifact-open-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256,
    openMode: 'host-preview', locator: `mooyu-artifact://host-preview/${artifactId}`, expiresAt };
  const artifact = { schemaVersion: 'capability-artifact-content-v1', artifactId, runId,
    name: 'verified.result', mediaType: 'application/json', sizeBytes: 39, sha256, content };
  const verified = await verifyCapabilityArtifactOpenPayload({ directive, artifact });
  assert.deepEqual(verified.artifact.content, content);
  await assert.rejects(verifyCapabilityArtifactOpenPayload({ directive,
    artifact: { ...artifact, content: { ...content, z: 2 } } }),
  { code: 'CAPABILITY_HOST_ARTIFACT_INTEGRITY' });
  await assert.rejects(verifyCapabilityArtifactOpenPayload({
    directive: { ...directive, expiresAt: new Date(Date.now() - 1).toISOString() }, artifact,
  }), { code: 'CAPABILITY_HOST_OPEN_DIRECTIVE_INVALID' });
});
