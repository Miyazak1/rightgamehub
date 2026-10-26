import { normalizeModelPolicy } from './agent-provider-gateway-repository.mjs';

export class AgentProviderGatewayError extends Error {
  constructor(code, { cause = null, retryable = false, uncertain = false } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentProviderGatewayError';
    this.code = code;
    this.retryable = retryable;
    this.uncertain = uncertain;
  }
}

const fail = (code, options) => { throw new AgentProviderGatewayError(code, options); };
const registry = (input, code) => {
  const entries = input instanceof Map ? [...input.entries()] : Object.entries(input ?? {});
  const map = new Map();
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || typeof value !== 'function' || map.has(key)) fail(code);
    map.set(key, value);
  }
  return map;
};

const schemaKey = value => `${value.key}@${value.version}`;
const errorText = error => String(error?.message ?? error ?? 'Provider call failed.').slice(0, 500);
const errorCode = error => String(error?.code ?? 'AGENT_PROVIDER_FAILED').slice(0, 120);

export function createAgentProviderGateway({
  runtimeRepository, governanceRepository, policyService, secretVault,
  adapters = {}, responseSchemas = {},
} = {}) {
  if (!runtimeRepository || !governanceRepository || !policyService || !secretVault) fail('AGENT_PROVIDER_GATEWAY_DEPENDENCY_REQUIRED');
  const providerAdapters = registry(adapters, 'AGENT_PROVIDER_ADAPTER_INVALID');
  const validators = registry(responseSchemas, 'AGENT_PROVIDER_RESPONSE_SCHEMA_INVALID');

  return {
    async invoke({
      runId, stageId, workerId, leaseToken, action, idempotencyKey, resource = {}, modelPolicy: inputPolicy,
      promptTemplate, responseSchema, request, tokenCeiling, timeoutSeconds, estimatedInputTokens = 0,
    }) {
      const modelPolicy = normalizeModelPolicy(inputPolicy);
      const validate = validators.get(schemaKey(responseSchema));
      if (!validate) fail('AGENT_PROVIDER_RESPONSE_SCHEMA_NOT_REGISTERED');
      const decision = await policyService.decide({ runId, stageId, action, resource });
      const prepared = await runtimeRepository.createAction({
        runId, stageId, action, idempotencyKey,
        request: { modelPolicy, promptTemplate, responseSchema, tokenCeiling, timeoutSeconds, input: request },
        policyDecision: decision,
      });
      if (prepared.existing) {
        const replay = await governanceRepository.getProviderCallByAction(prepared.id);
        if (replay?.status === 'succeeded') {
          if (!replay.output || typeof replay.output !== 'object' || Array.isArray(replay.output)) {
            fail('AGENT_PROVIDER_OUTPUT_ARTIFACT_MISSING');
          }
          return { status: 'succeeded', replayed: true, ...replay };
        }
        if (replay?.status === 'uncertain') fail('AGENT_PROVIDER_OUTCOME_UNCERTAIN', { uncertain: true });
        fail('AGENT_PROVIDER_ACTION_IN_PROGRESS');
      }
      if (decision.decision === 'deny') {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'prepared', to: 'rejected',
          errorCode: 'AGENT_POLICY_DENIED', errorMessage: decision.reasonCodes.join(',') });
        fail('AGENT_POLICY_DENIED');
      }
      if (decision.decision === 'require-confirmation') {
        await runtimeRepository.waitForActionConfirmation({ actionId: prepared.id, stageId, workerId, leaseToken });
        return { status: 'waiting-confirmation', actionId: prepared.id, decision };
      }
      await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'prepared', to: 'authorized' });
      let model;
      try {
        model = await governanceRepository.resolveModel(modelPolicy);
      } catch (error) {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'authorized', to: 'failed',
          errorCode: errorCode(error), errorMessage: errorText(error) });
        throw error;
      }
      const adapter = providerAdapters.get(model.provider);
      if (!adapter) {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'authorized', to: 'failed',
          errorCode: 'AGENT_PROVIDER_ADAPTER_UNAVAILABLE', errorMessage: 'No provider adapter is registered.' });
        fail('AGENT_PROVIDER_ADAPTER_UNAVAILABLE');
      }
      let secretRecord;
      try {
        secretRecord = await governanceRepository.loadSecret(decision.agentUserId, model.provider);
      } catch (error) {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'authorized', to: 'failed',
          errorCode: errorCode(error), errorMessage: errorText(error) });
        throw error;
      }
      const estimatedCost = model.estimatedCostMicrousd;
      let reservation;
      try {
        reservation = await governanceRepository.reserveProviderCall({
          actionId: prepared.id, model, request, promptTemplate, responseSchema, tokenCeiling, timeoutSeconds,
          estimatedUsage: {
            providerCalls: 1, inputTokens: estimatedInputTokens,
            outputTokens: tokenCeiling, costMicrousd: estimatedCost,
          },
        });
      } catch (error) {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'authorized', to: 'failed',
          errorCode: errorCode(error), errorMessage: errorText(error) });
        throw error;
      }
      let apiKey;
      try {
        apiKey = secretVault.decrypt(decision.agentUserId, model.provider, secretRecord);
      } catch (error) {
        await governanceRepository.failBeforeAcknowledgement(reservation.callId, {
          notDispatched: true, errorCode: errorCode(error), errorMessage: errorText(error),
        });
        throw error;
      }
      await governanceRepository.markSending(reservation.callId);
      let receipt;
      try {
        receipt = await adapter({
          apiKey, provider: model.provider, modelId: model.modelId, modelConfig: model.config,
          request: structuredClone(request), tokenCeiling, timeoutSeconds,
          responseSchema: structuredClone(responseSchema), idempotencyKey,
        });
      } catch (error) {
        if (error?.acknowledged === true && error?.providerRequestId) {
          await governanceRepository.acknowledge(reservation.callId, {
            providerRequestId: error.providerRequestId, responseRef: error.responseRef ?? {},
          });
          await governanceRepository.finish(reservation.callId, {
            status: 'failed', actualUsage: error.usage ?? {}, errorCode: errorCode(error), errorMessage: errorText(error),
            circuitFailure: error?.retryable === true,
          });
        } else {
          await governanceRepository.failBeforeAcknowledgement(reservation.callId, {
            notDispatched: error?.notDispatched === true,
            errorCode: errorCode(error), errorMessage: errorText(error), circuitFailure: error?.retryable === true,
          });
        }
        fail(errorCode(error), { cause: error, retryable: error?.retryable === true,
          uncertain: error?.acknowledged !== true && error?.notDispatched !== true });
      } finally {
        apiKey = null;
      }
      if (!receipt || typeof receipt.providerRequestId !== 'string') {
        await governanceRepository.failBeforeAcknowledgement(reservation.callId, {
          notDispatched: false, errorCode: 'AGENT_PROVIDER_RECEIPT_INVALID', errorMessage: 'Provider receipt is missing.',
        });
        fail('AGENT_PROVIDER_RECEIPT_INVALID', { uncertain: true });
      }
      await governanceRepository.acknowledge(reservation.callId, {
        providerRequestId: receipt.providerRequestId, responseRef: receipt.responseRef ?? {},
      });
      let output;
      try {
        output = await validate(structuredClone(receipt.output));
      } catch (error) {
        await governanceRepository.finish(reservation.callId, {
          status: 'failed', actualUsage: receipt.usage ?? {}, responseRef: receipt.responseRef ?? {},
          errorCode: 'AGENT_PROVIDER_OUTPUT_INVALID', errorMessage: errorText(error),
        });
        fail('AGENT_PROVIDER_OUTPUT_INVALID', { cause: error });
      }
      let settled;
      try {
        settled = await governanceRepository.finish(reservation.callId, {
          status: 'succeeded', actualUsage: receipt.usage ?? {}, responseRef: receipt.responseRef ?? {},
          output, responseSchema,
        });
      } catch (error) {
        fail(errorCode(error), { cause: error, uncertain: true });
      }
      return {
        status: 'succeeded', replayed: false, actionId: prepared.id, callId: reservation.callId,
        provider: model.provider, modelId: model.modelId, output, usage: settled.usage,
        chargedUsage: settled.chargedUsage, providerRequestId: receipt.providerRequestId,
        outputArtifactId: settled.outputArtifactId, outputSha256: settled.outputSha256,
      };
    },
  };
}
