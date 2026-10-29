import { normalizeActionDefinition } from './agent-runtime-contracts.mjs';

export class AgentToolGatewayError extends Error {
  constructor(code, { retryable = false, uncertain = false, backoffSeconds = null, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AgentToolGatewayError';
    this.code = code;
    this.retryable = retryable;
    this.uncertain = uncertain;
    this.backoffSeconds = backoffSeconds;
  }
}

const fail = (code, options) => { throw new AgentToolGatewayError(code, options); };
const schemaKey = value => `${value.key}@${value.version}`;
const toolKey = value => `${value.toolKey}@${value.contractVersion}`;
const registry = (value, code) => {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value ?? {});
  const result = new Map();
  for (const [key, handler] of entries) {
    if (typeof key !== 'string' || typeof handler !== 'function' || result.has(key)) fail(code);
    result.set(key, handler);
  }
  return result;
};
const errorCode = error => String(error?.code ?? 'AGENT_TOOL_FAILED').slice(0, 120);
const errorMessage = error => String(error?.message ?? error ?? 'Tool invocation failed.').slice(0, 500);

export function createAgentToolGateway({
  runtimeRepository, toolRepository, policyService, adapters = {}, inputSchemas = {}, outputSchemas = {},
} = {}) {
  if (!runtimeRepository || !toolRepository || !policyService) fail('AGENT_TOOL_GATEWAY_DEPENDENCY_REQUIRED');
  const toolAdapters = registry(adapters, 'AGENT_TOOL_ADAPTER_INVALID');
  const inputValidators = registry(inputSchemas, 'AGENT_TOOL_INPUT_SCHEMA_INVALID');
  const outputValidators = registry(outputSchemas, 'AGENT_TOOL_OUTPUT_SCHEMA_INVALID');
  return {
    async invoke({
      runId, stageId, workerId, leaseToken, action: inputAction, idempotencyKey,
      resource = {}, tool, request, responseRef = {},
    }) {
      const action = normalizeActionDefinition(inputAction);
      if (action.actionKind !== 'tool') fail('AGENT_TOOL_ACTION_INVALID');
      const contract = await toolRepository.resolveTool(tool ?? {});
      if (action.capabilityKey !== contract.capabilityKey || action.contractVersion !== contract.contractVersion
        || action.riskLevel !== contract.riskLevel) fail('AGENT_TOOL_ACTION_CONTRACT_MISMATCH');
      const adapter = toolAdapters.get(toolKey(contract));
      const validateInput = inputValidators.get(schemaKey(contract.inputSchema));
      const validateOutput = outputValidators.get(schemaKey(contract.outputSchema));
      if (!adapter) fail('AGENT_TOOL_ADAPTER_UNAVAILABLE');
      if (!validateInput || !validateOutput) fail('AGENT_TOOL_SCHEMA_NOT_REGISTERED');
      const normalizedRequest = await validateInput(structuredClone(request));
      const decision = await policyService.decide({ runId, stageId, action, resource });
      const prepared = await runtimeRepository.createAction({
        runId, stageId, action, idempotencyKey,
        request: { tool: { key: contract.toolKey, version: contract.contractVersion }, input: normalizedRequest },
        policyDecision: decision,
      });
      if (prepared.existing) {
        const replay = await toolRepository.getToolCallByAction(prepared.id);
        if (replay?.status === 'succeeded') return { status: 'succeeded', replayed: true, ...replay };
        if (replay?.status === 'uncertain') fail('AGENT_TOOL_OUTCOME_UNCERTAIN', { uncertain: true });
        fail('AGENT_TOOL_ACTION_IN_PROGRESS');
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
      let reserved;
      try {
        reserved = await toolRepository.reserveToolCall({ actionId: prepared.id, contract, request: normalizedRequest });
      } catch (error) {
        await runtimeRepository.transitionAction({ actionId: prepared.id, from: 'authorized', to: 'failed',
          errorCode: errorCode(error), errorMessage: errorMessage(error) });
        throw error;
      }
      await toolRepository.markSending(reserved.callId);
      let receipt;
      try {
        receipt = await adapter({
          request: structuredClone(normalizedRequest), contract: structuredClone(contract),
          timeoutSeconds: contract.timeoutSeconds,
        });
      } catch (error) {
        const failure = await toolRepository.failBeforeAcknowledgement(reserved.callId, {
          notDispatched: error?.notDispatched === true,
          errorCode: errorCode(error), errorMessage: errorMessage(error),
        });
        fail(errorCode(error), { cause: error, retryable: error?.retryable === true,
          uncertain: failure.status === 'uncertain', backoffSeconds: error?.backoffSeconds ?? null });
      }
      if (!receipt || typeof receipt.receiptId !== 'string' || !receipt.receiptId) {
        const failure = await toolRepository.failBeforeAcknowledgement(reserved.callId, {
          notDispatched: false, errorCode: 'AGENT_TOOL_RECEIPT_INVALID', errorMessage: 'Tool receipt is missing.',
        });
        fail('AGENT_TOOL_RECEIPT_INVALID', { uncertain: failure.status === 'uncertain' });
      }
      await toolRepository.acknowledge(reserved.callId, {
        receiptId: receipt.receiptId, responseRef: receipt.responseRef ?? responseRef,
      });
      let output;
      try {
        output = await validateOutput(structuredClone(receipt.output));
      } catch (error) {
        await toolRepository.failAfterAcknowledgement(reserved.callId, {
          errorCode: 'AGENT_TOOL_OUTPUT_INVALID', errorMessage: errorMessage(error),
        });
        fail('AGENT_TOOL_OUTPUT_INVALID', { cause: error });
      }
      if (!output || typeof output !== 'object') {
        await toolRepository.failAfterAcknowledgement(reserved.callId, {
          errorCode: 'AGENT_TOOL_OUTPUT_INVALID', errorMessage: 'Tool output must be a structured value.',
        });
        fail('AGENT_TOOL_OUTPUT_INVALID');
      }
      if (Buffer.byteLength(JSON.stringify(output)) > contract.outputLimitBytes) {
        await toolRepository.failAfterAcknowledgement(reserved.callId, {
          errorCode: 'AGENT_TOOL_OUTPUT_LIMIT_EXCEEDED', errorMessage: 'Tool output exceeded its contract limit.',
        });
        fail('AGENT_TOOL_OUTPUT_LIMIT_EXCEEDED');
      }
      const finished = await toolRepository.finish(reserved.callId, {
        output, responseRef: receipt.responseRef ?? responseRef,
        usage: receipt.usage ?? { toolCalls: 1 },
      });
      return {
        status: 'succeeded', replayed: false, actionId: prepared.id, callId: reserved.callId,
        toolKey: contract.toolKey, contractVersion: contract.contractVersion,
        output, artifactId: finished.artifactId, responseRef: finished.responseRef,
      };
    },
  };
}
