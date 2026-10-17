const clone = value => value === undefined ? undefined : structuredClone(value);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

function unique(items, label) {
  const ids = items.map(item => item.id);
  if (new Set(ids).size !== ids.length) fail('MISSION_DEFINITION_INVALID', `${label} IDs must be unique.`);
}

function validateDefinition(definition) {
  if (!definition || definition.format !== 'mooyu.learning-mission' || definition.schemaVersion !== 1) {
    fail('MISSION_DEFINITION_INVALID', 'Mission definition must use mooyu.learning-mission schemaVersion 1.');
  }
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) fail('MISSION_DEFINITION_INVALID', 'Mission requires at least one node.');
  if (!Array.isArray(definition.clocks) || definition.clocks.length === 0) fail('MISSION_DEFINITION_INVALID', 'Mission requires at least one authoritative clock.');
  unique(definition.nodes, 'Node');
  unique(definition.clocks, 'Clock');
  unique(definition.resources ?? [], 'Resource');
  unique(definition.outcomes ?? [], 'Outcome');
  const nodes = new Set(definition.nodes.map(node => node.id));
  if (!nodes.has(definition.initialNodeId)) fail('MISSION_DEFINITION_INVALID', `Initial node ${definition.initialNodeId} does not exist.`);
  for (const meter of [...definition.clocks, ...(definition.resources ?? [])]) {
    if (![meter.initial, meter.minimum, meter.maximum].every(Number.isFinite) || meter.minimum > meter.maximum || meter.initial < meter.minimum || meter.initial > meter.maximum) {
      fail('MISSION_DEFINITION_INVALID', `Meter ${meter.id} has an invalid range.`);
    }
  }
  for (const node of definition.nodes) {
    if (!Array.isArray(node.actions) || node.actions.length === 0) fail('MISSION_DEFINITION_INVALID', `Node ${node.id} requires an action.`);
    unique(node.actions, `Action in ${node.id}`);
    for (const action of node.actions) {
      for (const transition of [action.onSuccess, action.onFailure].filter(Boolean)) {
        if (!nodes.has(transition.to)) fail('MISSION_DEFINITION_INVALID', `Action ${action.id} targets missing node ${transition.to}.`);
      }
    }
  }
  return clone(definition);
}

function readPath(value, path) {
  return path.split('.').reduce((current, key) => current === null || current === undefined ? undefined : current[key], value);
}

function compileBindings(bindingDocument) {
  if (!bindingDocument || bindingDocument.format !== 'mooyu.mission-capability-binding' || bindingDocument.schemaVersion !== 1) {
    fail('MISSION_BINDING_INVALID', 'Capability bindings must use mooyu.mission-capability-binding schemaVersion 1.');
  }
  const metrics = new Map();
  for (const binding of bindingDocument.bindings ?? []) {
    for (const metric of binding.metrics ?? []) {
      if (metrics.has(metric.id)) fail('MISSION_BINDING_INVALID', `Metric ${metric.id} is bound more than once.`);
      metrics.set(metric.id, { moduleId:binding.moduleId, query:clone(binding.query ?? null), path:metric.path });
    }
  }
  return metrics;
}

function compare(actual, condition) {
  switch (condition.operator) {
    case 'eq': return actual === condition.value;
    case 'neq': return actual !== condition.value;
    case 'gt': return actual > condition.value;
    case 'gte': return actual >= condition.value;
    case 'lt': return actual < condition.value;
    case 'lte': return actual <= condition.value;
    case 'between': return actual >= condition.values[0] && actual <= condition.values[1];
    case 'truthy': return Boolean(actual);
    case 'falsy': return !actual;
    default: fail('MISSION_CONDITION_INVALID', `Unsupported condition operator ${condition.operator}.`);
  }
}

function completedValue(state, id) {
  if (id.startsWith('completed.')) return state.completedNodeIds.includes(id.slice('completed.'.length));
  return state[id];
}

function makeReader({ state, context, metricBindings }) {
  const moduleCache = new Map();
  return condition => {
    if (condition.source === 'resource') return state.resources[condition.id];
    if (condition.source === 'clock') return state.clocks[condition.id];
    if (condition.source === 'state') return completedValue(state, condition.id);
    if (condition.source === 'evidence') return state.evidence.some(item => item.claimId === condition.id);
    const binding = metricBindings.get(condition.id);
    if (!binding) fail('MISSION_METRIC_UNBOUND', `Metric ${condition.id} has no capability binding.`, { metricId:condition.id });
    const key = `${binding.moduleId}:${JSON.stringify(binding.query)}`;
    if (!moduleCache.has(key)) moduleCache.set(key, context.observe(binding.moduleId, binding.query));
    return readPath(moduleCache.get(key), binding.path);
  };
}

function conditionsPass(conditions, reader) {
  return (conditions ?? []).every(condition => compare(reader(condition), condition));
}

function initialState(definition) {
  return {
    status:'ready',
    activeNodeId:definition.initialNodeId,
    clocks:Object.fromEntries(definition.clocks.map(item => [item.id, item.initial])),
    resources:Object.fromEntries((definition.resources ?? []).map(item => [item.id, item.initial])),
    completedNodeIds:[],
    evidence:[],
    outcomeId:null,
    sequence:0,
    lastAction:null,
    history:[],
  };
}

function clampMeter(value, definition) {
  return Math.max(definition.minimum, Math.min(definition.maximum, value));
}

function spend(state, costs, definitions, field) {
  const next = { ...state[field] };
  for (const [id, amount] of Object.entries(costs ?? {})) {
    const definition = definitions.find(item => item.id === id);
    if (!definition) fail('MISSION_COST_INVALID', `Unknown ${field} meter ${id}.`, { meterId:id });
    next[id] = clampMeter(next[id] - amount, definition);
  }
  return next;
}

function resolveOutcome(state, definition, context, metricBindings) {
  const reader = makeReader({ state, context, metricBindings });
  const priority = { failure:0, partial:1, success:2 };
  const outcome = [...definition.outcomes].sort((a, b) => priority[a.kind] - priority[b.kind]).find(item => conditionsPass(item.when, reader));
  if (!outcome) return state;
  return { ...state, status:outcome.kind === 'success' ? 'succeeded' : outcome.kind === 'partial' ? 'partial' : 'failed', outcomeId:outcome.id };
}

function publicDefinition(definition) {
  return {
    id:definition.id,
    version:definition.version,
    title:clone(definition.title),
    initialNodeId:definition.initialNodeId,
    nodes:definition.nodes.map(({ id, kind, title, capabilitySlots=[] }) => ({ id, kind, title:clone(title), capabilitySlots:[...capabilitySlots] })),
    outcomes:definition.outcomes.map(({ id, kind, title }) => ({ id, kind, title:clone(title) })),
  };
}

export function createMissionModule({ mission, bindings }) {
  const definition = validateDefinition(mission);
  const metricBindings = compileBindings(bindings);
  if (bindings.missionId !== definition.id) fail('MISSION_BINDING_INVALID', 'Capability bindings target a different mission.');
  return {
    createState:() => initialState(definition),
    reduce:({ state, command, context }) => {
      if (command.name === 'mission.reset') return initialState(definition);
      if (command.name === 'mission.start') {
        const fresh = initialState(definition);
        return { ...fresh, status:'running', history:[{ sequence:0, name:'mission.start', payload:{} }] };
      }
      if (state.status !== 'running') return state;
      if (command.name === 'mission.advance') {
        const clockId = String(command.payload.clockId ?? definition.clocks[0].id);
        const amount = Number(command.payload.amount ?? 0);
        if (!Number.isFinite(amount) || amount < 0) fail('MISSION_COMMAND_INVALID', 'Mission advance amount must be non-negative.');
        const clocks = spend(state, { [clockId]:amount }, definition.clocks, 'clocks');
        const sequence = state.sequence + 1;
        const advanced = { ...state, clocks, sequence, history:[...state.history, { sequence, name:command.name, payload:{ clockId, amount } }].slice(-1000) };
        return resolveOutcome(advanced, definition, context, metricBindings);
      }
      if (command.name !== 'mission.act') return state;
      const node = definition.nodes.find(item => item.id === state.activeNodeId);
      const actionId = String(command.payload.actionId ?? '');
      const action = node?.actions.find(item => item.id === actionId);
      if (!action) fail('MISSION_ACTION_INVALID', `Action ${actionId} is unavailable in node ${state.activeNodeId}.`, { actionId, nodeId:state.activeNodeId });
      const reader = makeReader({ state, context, metricBindings });
      const success = conditionsPass(action.success, reader);
      const requestedTransition = success ? action.onSuccess : action.onFailure;
      const sequence = state.sequence + 1;
      const completedNodeIds = success && !state.completedNodeIds.includes(node.id) ? [...state.completedNodeIds, node.id] : state.completedNodeIds;
      const evidence = success ? [...state.evidence, ...(action.evidence ?? []).map(item => ({ ...clone(item), nodeId:node.id, actionId, sequence }))] : state.evidence;
      let next = {
        ...state,
        clocks:spend(state, action.clockCosts, definition.clocks, 'clocks'),
        resources:spend(state, action.resourceCosts, definition.resources ?? [], 'resources'),
        activeNodeId:state.activeNodeId,
        completedNodeIds,
        evidence,
        sequence,
        lastAction:{ id:actionId, nodeId:node.id, success },
        history:[...state.history, { sequence, name:command.name, payload:{ actionId } }].slice(-1000),
      };
      const transitionReader = makeReader({ state:next, context, metricBindings });
      if (requestedTransition && conditionsPass(requestedTransition.when, transitionReader)) next = { ...next,activeNodeId:requestedTransition.to };
      return resolveOutcome(next, definition, context, metricBindings);
    },
    observe:({ state, query, context }) => {
      if (query?.kind === 'definition') return publicDefinition(definition);
      if (query?.kind === 'replay') return { missionId:definition.id, missionVersion:definition.version, commands:clone(state.history) };
      const node = definition.nodes.find(item => item.id === state.activeNodeId);
      const reader = makeReader({ state, context, metricBindings });
      const metrics = Object.fromEntries([...metricBindings.keys()].map(id => [id, reader({ source:'metric', id })]));
      return { ...clone(state), node:node ? { id:node.id,kind:node.kind,title:clone(node.title),actions:node.actions.map(action => ({ id:action.id,title:clone(action.title) })) } : null, metrics };
    },
  };
}

export function evaluateLearningEvidence(model, evidence) {
  if (!model || model.format !== 'mooyu.learning-evidence-model' || model.schemaVersion !== 1) fail('LEARNING_EVIDENCE_MODEL_INVALID', 'Learning evidence model is invalid.');
  const observations = Array.isArray(evidence) ? evidence : [];
  const claims = model.claims.map(claim => {
    const strength = observations.filter(item => item.claimId === claim.id).reduce((maximum, item) => Math.max(maximum, Number(item.strength) || 0), 0);
    return { id:claim.id,objectiveId:claim.objectiveId,strength,minimumStrength:claim.minimumStrength,satisfied:strength >= claim.minimumStrength,required:claim.required === true,weight:claim.weight };
  });
  const objectives = model.objectiveIds.map(objectiveId => {
    const related = claims.filter(claim => claim.objectiveId === objectiveId);
    const totalWeight = related.reduce((sum, claim) => sum + claim.weight, 0);
    const earnedWeight = related.reduce((sum, claim) => sum + claim.weight * (claim.minimumStrength <= 0 ? 1 : Math.min(1, claim.strength / claim.minimumStrength)), 0);
    return { id:objectiveId,score:totalWeight === 0 ? 0 : earnedWeight / totalWeight,mastered:related.length > 0 && related.filter(claim => claim.required).every(claim => claim.satisfied) && related.some(claim => claim.satisfied) };
  });
  return { claims,objectives,mastered:objectives.length > 0 && objectives.every(objective => objective.mastered) };
}

export { compare as evaluateMissionCondition };
