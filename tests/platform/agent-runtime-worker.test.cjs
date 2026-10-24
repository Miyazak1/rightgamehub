const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/agent-runtime-worker.mjs'));

function repositoryFixture({ handlerFailure = false } = {}) {
  const calls = [];
  let outboxClaimed = false;
  const stage = {
    id: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222',
    stageKey: 'prepare', kind: 'deterministic', attempt: 1, timeoutSeconds: 30,
    leaseToken: '33333333-3333-4333-8333-333333333333', leasedBy: 'worker-test',
  };
  return {
    calls,
    repository: {
      async registerWorker(input) { calls.push(['register', input]); return { status: 'idle' }; },
      async recoverExpiredStages() { calls.push(['recover-stages']); return { examined: 0, requeued: 0, failed: 0, uncertain: 0 }; },
      async recoverExpiredOutbox() { calls.push(['recover-outbox']); return { examined: 0, requeued: 0, failed: 0 }; },
      async claimNextOutbox() {
        calls.push(['claim-outbox']);
        if (outboxClaimed) return null;
        outboxClaimed = true;
        return { id: '44444444-4444-4444-8444-444444444444', eventType: 'stage.available', leaseToken: '55555555-5555-4555-8555-555555555555', attempts: 1 };
      },
      async deliverOutbox(input) { calls.push(['deliver-outbox', input]); },
      async failOutbox(input) { calls.push(['fail-outbox', input]); },
      async claimNextStage(workerId, leaseSeconds, routes) { calls.push(['claim-stage', workerId, leaseSeconds, routes]); return stage; },
      async heartbeatWorker(input) { calls.push(['heartbeat', input.status]); return input; },
      async startStage(input) { calls.push(['start-stage', input]); return stage; },
      async loadStageExecutionContext() {
        calls.push(['context']);
        return { run: { id: stage.runId, workflowKey: 'foundation.worker' }, stage, manifest: {}, prerequisites: [] };
      },
      async renewStageLease() { calls.push(['renew']); },
      async completeStage(input) { calls.push(['complete-stage', input]); return { stage: { ...stage, status: 'succeeded' }, run: { status: 'succeeded' }, unlocked: [] }; },
      async failStage(input) {
        calls.push(['fail-stage', input]);
        return { stage: { ...stage, status: handlerFailure ? 'queued' : 'failed' }, retryScheduled: handlerFailure };
      },
      async stopWorker(input) { calls.push(['stop', input]); return { status: 'offline' }; },
    },
  };
}

test('runtime worker dispatches outbox and atomically completes a registered stage route', async () => {
  const { createAgentRuntimeWorker } = await import(moduleUrl.href);
  const fixture = repositoryFixture();
  const outputId = '66666666-6666-4666-8666-666666666666';
  const worker = createAgentRuntimeWorker({
    repository: fixture.repository, workerId: 'worker-test', instanceId: '77777777-7777-4777-8777-777777777777',
    leaseSeconds: 30, heartbeatSeconds: 5, outboxBatch: 2,
    handlers: { 'foundation.worker:prepare': async (context, execution) => {
      assert.equal(context.run.id, '22222222-2222-4222-8222-222222222222');
      assert.equal(execution.signal.aborted, false);
      return { outputRef: { prepared: true }, runOutput: { type: 'foundation.result', id: outputId } };
    } },
  });
  const result = await worker.runOnce();
  assert.equal(result.status, 'completed');
  assert.equal(result.run.status, 'succeeded');
  assert(fixture.calls.some(call => call[0] === 'deliver-outbox'));
  const claim = fixture.calls.find(call => call[0] === 'claim-stage');
  assert.deepEqual(claim[3], ['foundation.worker:prepare']);
  const completed = fixture.calls.find(call => call[0] === 'complete-stage')[1];
  assert.deepEqual(completed.runOutput, { type: 'foundation.result', id: outputId });
});
test('runtime worker converts explicit retryable handler failures into durable retry scheduling', async () => {
  const { createAgentRuntimeWorker, AgentRuntimeWorkerError } = await import(moduleUrl.href);
  const fixture = repositoryFixture({ handlerFailure: true });
  const worker = createAgentRuntimeWorker({
    repository: fixture.repository, workerId: 'worker-test', instanceId: '88888888-8888-4888-8888-888888888888',
    leaseSeconds: 30, heartbeatSeconds: 5, outboxBatch: 1,
    handlers: { 'foundation.worker:prepare': async () => { throw new AgentRuntimeWorkerError('FIXTURE_RETRY', { retryable: true }); } },
  });
  const result = await worker.runOnce();
  assert.equal(result.status, 'retry-scheduled');
  const failure = fixture.calls.find(call => call[0] === 'fail-stage')[1];
  assert.equal(failure.errorCode, 'FIXTURE_RETRY');
  assert.equal(failure.retryable, true);
  assert.equal(failure.uncertain, false);
});

test('runtime worker configuration fails closed on unsafe heartbeat and disabled values', async () => {
  const { loadAgentRuntimeWorkerConfig } = await import(moduleUrl.href);
  assert.equal(loadAgentRuntimeWorkerConfig({}).enabled, false);
  assert.throws(() => loadAgentRuntimeWorkerConfig({ AGENT_RUNTIME_WORKER_ENABLED: 'yes' }), /AGENT_RUNTIME_WORKER_ENABLED_INVALID/u);
  assert.throws(() => loadAgentRuntimeWorkerConfig({ AGENT_RUNTIME_LEASE_SECONDS: '30', AGENT_RUNTIME_HEARTBEAT_SECONDS: '15' }), /AGENT_RUNTIME_HEARTBEAT_INTERVAL_UNSAFE/u);
});

