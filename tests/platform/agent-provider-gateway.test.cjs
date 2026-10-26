const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);

function request() {
  return {
    runId: 'run', stageId: 'stage', workerId: 'worker', leaseToken: 'lease',
    action: { actionKey: 'generate', actionKind: 'provider', capabilityKey: 'research.paper.read', contractVersion: 1, riskLevel: 'L1' },
    idempotencyKey: 'provider-action-fixture', resource: { type: 'paper', owner: 'public' },
    modelPolicy: { taskClass: 'structured-generation', requiresJsonSchema: true, maxInputTokens: 100,
      maxOutputTokens: 50, maxCostMicrousd: 1000, latencyClass: 'batch' },
    promptTemplate: { key: 'paper.summary', version: 1 }, responseSchema: { key: 'paper-summary', version: 1 },
    request: { evidenceIds: ['fixture'] }, tokenCeiling: 50, timeoutSeconds: 10, estimatedInputTokens: 40,
  };
}

test('provider gateway enforces policy, budget, send watermark and settlement order', async () => {
  const { createAgentProviderGateway } = await load('agent-provider-gateway.mjs');
  const calls = [];
  let finishInput;
  const runtimeRepository = {
    createAction: async () => (calls.push('prepare'), { id: 'action', status: 'prepared', existing: false }),
    transitionAction: async input => (calls.push(input.to), { status: input.to }),
  };
  const governanceRepository = {
    resolveModel: async policy => (calls.push('resolve'), { provider: 'fixture', modelId: 'json', catalogVersion: 1,
      estimatedCostMicrousd: 100, config: {}, modelPolicy: policy }),
    loadSecret: async () => (calls.push('load-secret'), { ciphertext: Buffer.from('cipher') }),
    reserveProviderCall: async () => (calls.push('reserve'), { callId: 'call', reservationId: 'budget' }),
    markSending: async () => { calls.push('sending'); },
    acknowledge: async () => { calls.push('acknowledge'); },
    finish: async (_callId, input) => {
      calls.push('settle');
      finishInput = input;
      return { usage: { providerCalls: 1 }, chargedUsage: { providerCalls: 1 },
        outputArtifactId: 'provider-output', outputSha256: 'sha256' };
    },
  };
  const gateway = createAgentProviderGateway({
    runtimeRepository, governanceRepository,
    policyService: { decide: async () => (calls.push('policy'), { decision: 'allow', agentUserId: 'agent' }) },
    secretVault: { decrypt: () => (calls.push('decrypt'), 'secret') },
    adapters: { fixture: async input => (calls.push(`invoke:${input.apiKey}`), {
      providerRequestId: 'provider-request', output: { summary: 'ok' }, responseRef: { artifactId: 'artifact' }, usage: {},
    }) },
    responseSchemas: { 'paper-summary@1': output => (calls.push('validate'), output) },
  });
  const result = await gateway.invoke(request());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.outputArtifactId, 'provider-output');
  assert.deepEqual(finishInput.output, { summary: 'ok' });
  assert.deepEqual(finishInput.responseSchema, { key: 'paper-summary', version: 1 });
  assert.deepEqual(calls, ['policy', 'prepare', 'authorized', 'resolve', 'load-secret', 'reserve', 'decrypt',
    'sending', 'invoke:secret', 'acknowledge', 'validate', 'settle']);
});

test('provider gateway refuses to replay a succeeded action without its durable output artifact', async () => {
  const { createAgentProviderGateway, AgentProviderGatewayError } = await load('agent-provider-gateway.mjs');
  const gateway = createAgentProviderGateway({
    runtimeRepository: {
      createAction: async () => ({ id: 'action', status: 'succeeded', existing: true }),
    },
    governanceRepository: {
      getProviderCallByAction: async () => ({ status: 'succeeded', output: null }),
    },
    policyService: { decide: async () => ({ decision: 'allow', agentUserId: 'agent' }) },
    secretVault: {}, adapters: {}, responseSchemas: { 'paper-summary@1': output => output },
  });
  await assert.rejects(gateway.invoke(request()), error => error instanceof AgentProviderGatewayError
    && error.code === 'AGENT_PROVIDER_OUTPUT_ARTIFACT_MISSING');
});

test('provider gateway retains conservative budget when dispatch outcome is unknown', async () => {
  const { createAgentProviderGateway, AgentProviderGatewayError } = await load('agent-provider-gateway.mjs');
  let failure;
  const gateway = createAgentProviderGateway({
    runtimeRepository: {
      createAction: async () => ({ id: 'action', status: 'prepared', existing: false }),
      transitionAction: async () => ({}),
    },
    governanceRepository: {
      resolveModel: async policy => ({ provider: 'fixture', modelId: 'json', catalogVersion: 1, estimatedCostMicrousd: 1, config: {}, modelPolicy: policy }),
      loadSecret: async () => ({}), reserveProviderCall: async () => ({ callId: 'call', reservationId: 'budget' }),
      markSending: async () => {},
      failBeforeAcknowledgement: async (id, input) => { failure = { id, ...input }; },
    },
    policyService: { decide: async () => ({ decision: 'allow', agentUserId: 'agent' }) },
    secretVault: { decrypt: () => 'secret' },
    adapters: { fixture: async () => { const error = new Error('socket closed'); error.code = 'PROVIDER_SOCKET'; error.retryable = true; throw error; } },
    responseSchemas: { 'paper-summary@1': output => output },
  });
  await assert.rejects(gateway.invoke(request()), error => error instanceof AgentProviderGatewayError
    && error.code === 'PROVIDER_SOCKET' && error.retryable === true && error.uncertain === true);
  assert.deepEqual(failure, { id: 'call', notDispatched: false, errorCode: 'PROVIDER_SOCKET',
    errorMessage: 'socket closed', circuitFailure: true });
});

test('provider gateway parks confirmation-required work instead of dispatching it', async () => {
  const { createAgentProviderGateway } = await load('agent-provider-gateway.mjs');
  let waited = false;
  const gateway = createAgentProviderGateway({
    runtimeRepository: {
      createAction: async () => ({ id: 'action', status: 'prepared', existing: false }),
      waitForActionConfirmation: async () => { waited = true; },
    },
    governanceRepository: {},
    policyService: { decide: async () => ({ decision: 'require-confirmation', agentUserId: 'agent' }) },
    secretVault: {}, adapters: {}, responseSchemas: { 'paper-summary@1': output => output },
  });
  assert.equal((await gateway.invoke(request())).status, 'waiting-confirmation');
  assert.equal(waited, true);
});
