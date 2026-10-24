import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const WORKFLOW_KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const STAGE_KEY = /^[a-z][a-z0-9-]{1,79}$/u;
const CAPABILITY_KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const SCHEMA_KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const STAGE_KINDS = new Set(['deterministic', 'provider', 'tool', 'domain-write', 'interaction']);
const ACTION_KINDS = new Set(['provider', 'tool', 'domain-write', 'interaction']);
const RISK_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

export const RUN_TERMINAL_STATES = new Set(['succeeded', 'rejected', 'failed', 'cancelled', 'uncertain']);
export const STAGE_TERMINAL_STATES = new Set(['succeeded', 'skipped', 'failed', 'cancelled', 'uncertain']);
export const ACTION_TERMINAL_STATES = new Set(['succeeded', 'rejected', 'failed', 'uncertain', 'cancelled']);

const TRANSITIONS = Object.freeze({
  run: Object.freeze({
    queued: new Set(['running', 'cancelled', 'failed']),
    running: new Set(['waiting', 'succeeded', 'rejected', 'failed', 'cancelled', 'uncertain']),
    waiting: new Set(['running', 'failed', 'cancelled', 'uncertain']),
  }),
  stage: Object.freeze({
    blocked: new Set(['queued', 'skipped', 'cancelled']),
    queued: new Set(['leased', 'cancelled', 'failed']),
    leased: new Set(['running', 'queued', 'succeeded', 'failed', 'cancelled', 'uncertain']),
    running: new Set(['waiting', 'queued', 'succeeded', 'failed', 'cancelled', 'uncertain']),
    waiting: new Set(['queued', 'failed', 'cancelled', 'uncertain']),
  }),
  action: Object.freeze({
    prepared: new Set(['authorized', 'rejected', 'cancelled']),
    authorized: new Set(['reserved', 'rejected', 'failed', 'cancelled']),
    reserved: new Set(['sending', 'failed', 'cancelled']),
    sending: new Set(['sent', 'failed', 'uncertain']),
    sent: new Set(['acknowledged', 'failed', 'uncertain']),
    acknowledged: new Set(['succeeded', 'failed', 'uncertain']),
  }),
});

export class AgentRuntimeContractError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'AgentRuntimeContractError';
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail) => { throw new AgentRuntimeContractError(code, detail); };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const integer = (value, min, max, code) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
};
const key = (value, pattern, code) => {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code);
  return value;
};
const uniqueStrings = (value, pattern, code) => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !pattern.test(item))) fail(code);
  if (new Set(value).size !== value.length) fail(code);
  return [...value];
};

function validateBudget(value) {
  if (!plainObject(value)) fail('AGENT_WORKFLOW_BUDGET_INVALID');
  const limits = {
    providerCalls: [0, 1000], toolCalls: [0, 10000], inputTokens: [0, 10_000_000],
    outputTokens: [0, 2_000_000], wallClockSeconds: [1, 604800],
  };
  const result = {};
  for (const [name, [min, max]] of Object.entries(limits)) result[name] = integer(value[name], min, max, 'AGENT_WORKFLOW_BUDGET_INVALID');
  if (Object.keys(value).some(name => !Object.hasOwn(limits, name))) fail('AGENT_WORKFLOW_BUDGET_UNKNOWN_FIELD');
  return result;
}

function assertAcyclic(stages) {
  const byKey = new Map(stages.map(stage => [stage.key, stage]));
  for (const stage of stages) {
    for (const dependency of stage.dependsOn) if (!byKey.has(dependency)) fail('AGENT_WORKFLOW_DEPENDENCY_MISSING', { stage: stage.key, dependency });
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = stageKey => {
    if (visiting.has(stageKey)) fail('AGENT_WORKFLOW_CYCLE', { stage: stageKey });
    if (visited.has(stageKey)) return;
    visiting.add(stageKey);
    for (const dependency of byKey.get(stageKey).dependsOn) visit(dependency);
    visiting.delete(stageKey);
    visited.add(stageKey);
  };
  for (const stage of stages) visit(stage.key);
}

export function normalizeWorkflowManifest(input) {
  if (!plainObject(input)) fail('AGENT_WORKFLOW_INVALID');
  const manifest = structuredClone(input);
  if (manifest.schemaVersion !== 'agent-workflow-v1') fail('AGENT_WORKFLOW_SCHEMA_UNSUPPORTED');
  key(manifest.workflowKey, WORKFLOW_KEY, 'AGENT_WORKFLOW_KEY_INVALID');
  integer(manifest.workflowVersion, 1, 2147483647, 'AGENT_WORKFLOW_VERSION_INVALID');
  key(manifest.inputSchema, SCHEMA_KEY, 'AGENT_WORKFLOW_INPUT_SCHEMA_INVALID');
  key(manifest.outputSchema, SCHEMA_KEY, 'AGENT_WORKFLOW_OUTPUT_SCHEMA_INVALID');
  if (!Array.isArray(manifest.requiredCapabilities) || manifest.requiredCapabilities.length > 64) fail('AGENT_WORKFLOW_CAPABILITIES_INVALID');
  const capabilityKeys = new Set();
  manifest.requiredCapabilities = manifest.requiredCapabilities.map(item => {
    if (!plainObject(item)) fail('AGENT_WORKFLOW_CAPABILITIES_INVALID');
    const capability = {
      key: key(item.key, CAPABILITY_KEY, 'AGENT_WORKFLOW_CAPABILITY_KEY_INVALID'),
      version: integer(item.version, 1, 2147483647, 'AGENT_WORKFLOW_CAPABILITY_VERSION_INVALID'),
    };
    const composite = `${capability.key}@${capability.version}`;
    if (capabilityKeys.has(composite)) fail('AGENT_WORKFLOW_CAPABILITY_DUPLICATE');
    capabilityKeys.add(composite);
    if (Object.keys(item).some(name => !['key', 'version'].includes(name))) fail('AGENT_WORKFLOW_CAPABILITY_UNKNOWN_FIELD');
    return capability;
  });
  manifest.defaultBudget = validateBudget(manifest.defaultBudget);
  if (!Array.isArray(manifest.stages) || manifest.stages.length < 1 || manifest.stages.length > 64) fail('AGENT_WORKFLOW_STAGES_INVALID');
  const stageKeys = new Set();
  manifest.stages = manifest.stages.map(item => {
    if (!plainObject(item)) fail('AGENT_WORKFLOW_STAGE_INVALID');
    const stageKey = key(item.key, STAGE_KEY, 'AGENT_WORKFLOW_STAGE_KEY_INVALID');
    if (stageKeys.has(stageKey)) fail('AGENT_WORKFLOW_STAGE_DUPLICATE', { stage: stageKey });
    stageKeys.add(stageKey);
    if (!STAGE_KINDS.has(item.kind)) fail('AGENT_WORKFLOW_STAGE_KIND_INVALID', { stage: stageKey });
    const dependsOn = uniqueStrings(item.dependsOn, STAGE_KEY, 'AGENT_WORKFLOW_DEPENDENCIES_INVALID');
    if (dependsOn.includes(stageKey)) fail('AGENT_WORKFLOW_SELF_DEPENDENCY', { stage: stageKey });
    const normalized = {
      key: stageKey,
      kind: item.kind,
      dependsOn,
      maxAttempts: integer(item.maxAttempts, 1, 100, 'AGENT_WORKFLOW_STAGE_ATTEMPTS_INVALID'),
      timeoutSeconds: integer(item.timeoutSeconds, 1, 86400, 'AGENT_WORKFLOW_STAGE_TIMEOUT_INVALID'),
    };
    if (Object.hasOwn(item, 'capability')) {
      if (!plainObject(item.capability)) fail('AGENT_WORKFLOW_STAGE_CAPABILITY_INVALID');
      normalized.capability = {
        key: key(item.capability.key, CAPABILITY_KEY, 'AGENT_WORKFLOW_STAGE_CAPABILITY_INVALID'),
        version: integer(item.capability.version, 1, 2147483647, 'AGENT_WORKFLOW_STAGE_CAPABILITY_INVALID'),
      };
      if (!capabilityKeys.has(`${normalized.capability.key}@${normalized.capability.version}`)) fail('AGENT_WORKFLOW_STAGE_CAPABILITY_UNDECLARED', { stage: stageKey });
    }
    if (['provider', 'tool', 'domain-write', 'interaction'].includes(item.kind) && !normalized.capability) fail('AGENT_WORKFLOW_STAGE_CAPABILITY_REQUIRED', { stage: stageKey });
    if (Object.hasOwn(item, 'idempotencyMode')) {
      if (!['none', 'key', 'queryable'].includes(item.idempotencyMode)) fail('AGENT_WORKFLOW_STAGE_IDEMPOTENCY_INVALID');
      normalized.idempotencyMode = item.idempotencyMode;
    }
    if (item.kind === 'domain-write' && !['key', 'queryable'].includes(normalized.idempotencyMode)) fail('AGENT_WORKFLOW_WRITE_IDEMPOTENCY_REQUIRED', { stage: stageKey });
    const allowed = ['key', 'kind', 'dependsOn', 'maxAttempts', 'timeoutSeconds', 'capability', 'idempotencyMode'];
    if (Object.keys(item).some(name => !allowed.includes(name))) fail('AGENT_WORKFLOW_STAGE_UNKNOWN_FIELD', { stage: stageKey });
    return normalized;
  });
  assertAcyclic(manifest.stages);
  const dependedOn = new Set(manifest.stages.flatMap(stage => stage.dependsOn));
  if (!manifest.stages.some(stage => !dependedOn.has(stage.key))) fail('AGENT_WORKFLOW_TERMINAL_STAGE_REQUIRED');
  const allowedRoot = ['schemaVersion', 'workflowKey', 'workflowVersion', 'inputSchema', 'outputSchema', 'requiredCapabilities', 'defaultBudget', 'stages'];
  if (Object.keys(manifest).some(name => !allowedRoot.includes(name))) fail('AGENT_WORKFLOW_UNKNOWN_FIELD');
  return manifest;
}

export function workflowManifestDigest(input) {
  return stableHash(normalizeWorkflowManifest(input));
}

export function assertStateTransition(kind, from, to) {
  const transitions = TRANSITIONS[kind];
  if (!transitions || !transitions[from]?.has(to)) fail('AGENT_RUNTIME_STATE_TRANSITION_DENIED', { kind, from, to });
  return true;
}

export function normalizeActionDefinition(input) {
  if (!plainObject(input) || !ACTION_KINDS.has(input.actionKind) || !RISK_LEVELS.has(input.riskLevel)) fail('AGENT_ACTION_INVALID');
  return {
    actionKey: key(input.actionKey, STAGE_KEY, 'AGENT_ACTION_KEY_INVALID'),
    actionKind: input.actionKind,
    capabilityKey: key(input.capabilityKey, CAPABILITY_KEY, 'AGENT_ACTION_CAPABILITY_INVALID'),
    contractVersion: integer(input.contractVersion, 1, 2147483647, 'AGENT_ACTION_CONTRACT_INVALID'),
    riskLevel: input.riskLevel,
  };
}

export function scheduleRunIdempotencyKey(scheduleId, logicalFireTime) {
  if (typeof scheduleId !== 'string' || typeof logicalFireTime !== 'string') fail('AGENT_SCHEDULE_IDEMPOTENCY_INVALID');
  return `schedule:${stableHash({ scheduleId, logicalFireTime })}`;
}
