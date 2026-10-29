const test = require('node:test');
const assert = require('node:assert/strict');

const runId = '11111111-1111-4111-8111-111111111111';
const artifactId = '22222222-2222-4222-8222-222222222222';
const profile = host => ({ schemaVersion: 'capability-host-profile-v1', host,
  hostVersion: '1.0.0', surface: host === 'mcp-app' ? 'mcp-app' : 'sidebar',
  connection: 'control-plane', features: { submit: true, cancel: true, resume: true,
    artifacts: true, fileConsent: true, background: true } });
const run = (state = 'running', updatedAt = '2026-10-29T02:00:00.000Z') => ({
  schemaVersion: 'capability-host-run-v1', runId, capabilityId: 'research.paper.layout',
  capabilityVersion: '1.0.0', contractKey: 'research.paper.layout@1', state,
  progress: { phase: state, completed: state === 'succeeded' ? 1 : 0, total: 1, unit: 'items' },
  artifactCount: state === 'succeeded' ? 1 : 0, resumable: state === 'running',
  createdAt: '2026-10-29T01:59:00.000Z', updatedAt,
  errorCode: state === 'failed' ? 'FIXTURE_FAILURE' : null,
});

function fixture(host) {
  let listener;
  const calls = [];
  const client = {
    profile: profile(host),
    snapshot: async () => ({ profile: profile(host), runs: [run()] }),
    cancel: async id => { calls.push(['cancel', id]); return run('cancelled', '2026-10-29T02:01:00.000Z'); },
    artifacts: async id => { calls.push(['artifacts', id]); return [{ artifactId }]; },
    openArtifact: async id => { calls.push(['open', id]); return { opened: true, cancelled: false }; },
    subscribe: next => { listener = next; return () => { listener = null; }; },
  };
  return { client, calls, emit: value => listener?.({ run: value }) };
}

test('Codex, Harness and Cursor receive the same task surface semantics', async () => {
  const { createCapabilityTaskSurface } = await import('../../packages/host-contract/src/index.mjs');
  const results = [];
  for (const host of ['mcp-app', 'harness', 'cursor']) {
    const item = fixture(host);
    const surface = createCapabilityTaskSurface({ client: item.client,
      clock: () => new Date('2026-10-29T02:02:00.000Z') });
    await surface.start();
    const value = surface.getSnapshot();
    results.push({ ...value, host: '*', surface: '*' });
    assert.equal(value.tasks[0].actions.canCancel, true);
    assert.equal(value.tasks[0].actions.canListArtifacts, false);
    surface.dispose();
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});

test('task surface merges live completion, exposes artifacts and never cancels on dispose', async () => {
  const { createCapabilityTaskSurface } = await import('../../packages/host-contract/src/index.mjs');
  const item = fixture('cursor');
  const surface = createCapabilityTaskSurface({ client: item.client,
    clock: () => new Date('2026-10-29T02:02:00.000Z') });
  const observed = [];
  surface.subscribe(value => observed.push(value.status));
  await surface.start();
  item.emit(run('succeeded', '2026-10-29T02:03:00.000Z'));
  const completed = surface.getSnapshot().tasks[0];
  assert.equal(completed.active, false);
  assert.equal(completed.actions.canCancel, false);
  assert.equal(completed.actions.canListArtifacts, true);
  assert.deepEqual(await surface.artifacts(runId), [{ artifactId }]);
  assert.deepEqual(await surface.openArtifact(artifactId), { opened: true, cancelled: false });
  surface.dispose();
  assert.deepEqual(item.calls, [['artifacts', runId], ['open', artifactId]],
    'closing a sidebar must not cancel a background run');
  assert.deepEqual(observed, ['idle', 'loading', 'ready', 'ready']);
});

test('task surface rejects stale events and applies explicit cancellation', async () => {
  const { createCapabilityTaskSurface } = await import('../../packages/host-contract/src/index.mjs');
  const item = fixture('harness');
  const surface = createCapabilityTaskSurface({ client: item.client,
    clock: () => new Date('2026-10-29T02:02:00.000Z') });
  await surface.start();
  item.emit(run('queued', '2026-10-29T01:58:00.000Z'));
  assert.equal(surface.getSnapshot().tasks[0].state, 'running');
  item.emit(run('queued', '2026-10-29T02:00:00.000Z'));
  assert.equal(surface.getSnapshot().tasks[0].state, 'running',
    'an equal timestamp cannot regress a state even if it arrives in a later envelope');
  assert.equal((await surface.cancel(runId)).state, 'cancelled');
  assert.deepEqual(item.calls, [['cancel', runId]]);
});

test('live completion is not overwritten by a stale snapshot resolving later', async () => {
  const { createCapabilityTaskSurface } = await import('../../packages/host-contract/src/index.mjs');
  let resolveSnapshot;
  let listener;
  const client = {
    profile: profile('mcp-app'),
    snapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }),
    cancel: async () => run('cancelled'),
    artifacts: async () => [],
    openArtifact: async () => ({ opened: true, cancelled: false }),
    subscribe: next => { listener = next; return () => { listener = null; }; },
  };
  const surface = createCapabilityTaskSurface({ client,
    clock: () => new Date('2026-10-29T02:04:00.000Z') });
  const started = surface.start();
  listener({ run: run('succeeded', '2026-10-29T02:03:00.000Z') });
  resolveSnapshot({ profile: profile('mcp-app'), runs: [run('running')] });
  await started;
  assert.equal(surface.getSnapshot().tasks[0].state, 'succeeded');
  surface.dispose();
});
