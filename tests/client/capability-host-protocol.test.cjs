const test = require('node:test');
const assert = require('node:assert/strict');

const runId = 'bf9af255-0b8f-49bb-9884-6a3dbf076a9f';
const artifactId = '9a59180c-598e-4d63-9e6c-cfbdb315ab8d';
const now = '2026-10-29T02:00:00.000Z';
const profile = host => ({
  schemaVersion: 'capability-host-profile-v1', host,
  hostVersion: '1.0.0', surface: host === 'mcp-app' ? 'mcp-app' : 'sidebar',
  connection: 'control-plane',
  features: { submit: true, cancel: true, resume: true, artifacts: true,
    fileConsent: true, background: true },
});
const running = state => ({
  schemaVersion: 'capability-host-run-v1', runId,
  capabilityId: 'mooyu.research.paper.layout', capabilityVersion: '1.0.0',
  contractKey: 'research.paper.layout@1', state,
  progress: { phase: state, completed: state === 'succeeded' ? 3 : 1, total: 3, unit: 'pages' },
  artifactCount: state === 'succeeded' ? 1 : 0, resumable: state === 'running',
  createdAt: now, updatedAt: now, errorCode: state === 'failed' ? 'OCR_FAILED' : null,
});

test('one protocol client drives Codex, Harness and Cursor without host-specific run semantics', async () => {
  const { createCapabilityExecutionHostClient } = await import('../../packages/host-contract/src/index.mjs');
  for (const host of ['mcp-app', 'harness', 'cursor']) {
    const calls = [];
    const transport = { async request(operation, payload) {
      calls.push([operation, payload]);
      if (operation === 'capability.host.snapshot') return { profile: profile(host), runs: [] };
      if (operation === 'capability.runs.submit') return running('queued');
      if (operation === 'capability.runs.get') return running('running');
      if (operation === 'capability.runs.cancel') return running('cancelled');
      if (operation === 'capability.runs.artifacts') return [{ schemaVersion: 'capability-host-artifact-v1',
        artifactId, runId, name: 'layout.json', mediaType: 'application/json', sizeBytes: 42,
        sha256: 'a'.repeat(64), openMode: 'host-preview' }];
      if (operation === 'capability.artifacts.open') return { opened: true, cancelled: false };
      throw new Error(operation);
    } };
    const client = createCapabilityExecutionHostClient({ profile: profile(host), transport });
    assert.equal((await client.snapshot()).profile.host, host);
    assert.equal((await client.submit({ capabilityId: 'mooyu.research.paper.layout',
      capabilityVersion: '1.0.0', contractKey: 'research.paper.layout@1', input: { fileGrantId: 'grant' },
      idempotencyKey: 'request-123456789' })).state, 'queued');
    assert.equal((await client.get(runId)).state, 'running');
    assert.equal((await client.cancel(runId)).state, 'cancelled');
    assert.equal((await client.artifacts(runId))[0].artifactId, artifactId);
    assert.deepEqual(await client.openArtifact(artifactId), { opened: true, cancelled: false });
    assert.deepEqual(calls.map(item => item[0]), ['capability.host.snapshot',
      'capability.runs.submit', 'capability.runs.get', 'capability.runs.cancel',
      'capability.runs.artifacts', 'capability.artifacts.open']);
  }
});

test('artifact save cancellation is a valid no-op rather than a failed host operation', async () => {
  const { createCapabilityExecutionHostClient } = await import('../../packages/host-contract/src/index.mjs');
  const client = createCapabilityExecutionHostClient({ profile: profile('cursor'), transport: {
    async request(operation) {
      assert.equal(operation, 'capability.artifacts.open');
      return { opened: false, cancelled: true };
    },
  } });
  assert.deepEqual(await client.openArtifact(artifactId), { opened: false, cancelled: true });
});

test('event stream ignores replayed progress and validates every accepted event', async () => {
  const { createCapabilityExecutionHostClient } = await import('../../packages/host-contract/src/index.mjs');
  let receiver;
  const client = createCapabilityExecutionHostClient({ profile: profile('cursor'), transport: {
    async request() { throw new Error('not used'); }, subscribe(listener) { receiver = listener; return () => { receiver = null; }; },
  } });
  const received = [];
  const unsubscribe = client.subscribe(event => received.push(event.sequence));
  receiver({ schemaVersion: 'capability-host-event-v1', sequence: 2, emittedAt: now, run: running('running') });
  receiver({ schemaVersion: 'capability-host-event-v1', sequence: 1, emittedAt: now, run: running('running') });
  assert.deepEqual(received, [2]);
  unsubscribe(); assert.equal(receiver, null);
});

test('protocol fails closed on invalid host combinations and forged completed runs', async () => {
  const contract = await import('../../packages/host-contract/src/index.mjs');
  assert.throws(() => contract.normalizeCapabilityHostProfileV1({ ...profile('mcp-app'), connection: 'local-pipe' }),
    { code: 'CAPABILITY_HOST_CONNECTION_INVALID' });
  assert.throws(() => contract.normalizeCapabilityHostRunV1({ ...running('running'), artifactCount: 1 }),
    { code: 'CAPABILITY_HOST_RUN_INVALID' });
  assert.throws(() => contract.normalizeCapabilityHostRunV1({ ...running('failed'), errorCode: null }),
    { code: 'CAPABILITY_HOST_RUN_INVALID' });
});
