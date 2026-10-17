const clone = value => value === undefined ? undefined : structuredClone(value);
const digestPattern=/^sha256:[a-f0-9]{64}$/u;
const sha256Constants=[
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];

const rotateRight=(value,bits)=>(value>>>bits)|(value<<(32-bits));
const canonicalJson=value=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(canonicalJson).join(',')}]`;
  return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};

function sha256Hex(value){
  const source=new TextEncoder().encode(value),paddedLength=Math.ceil((source.length+9)/64)*64,bytes=new Uint8Array(paddedLength),view=new DataView(bytes.buffer),bitLength=source.length*8;
  bytes.set(source);bytes[source.length]=0x80;view.setUint32(paddedLength-8,Math.floor(bitLength/0x100000000),false);view.setUint32(paddedLength-4,bitLength>>>0,false);
  const hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],words=new Uint32Array(64);
  for(let offset=0;offset<paddedLength;offset+=64){
    for(let index=0;index<16;index+=1)words[index]=view.getUint32(offset+index*4,false);
    for(let index=16;index<64;index+=1){const a=words[index-15],b=words[index-2],s0=rotateRight(a,7)^rotateRight(a,18)^(a>>>3),s1=rotateRight(b,17)^rotateRight(b,19)^(b>>>10);words[index]=(words[index-16]+s0+words[index-7]+s1)>>>0;}
    let [a,b,c,d,e,f,g,h]=hash;
    for(let index=0;index<64;index+=1){const s1=rotateRight(e,6)^rotateRight(e,11)^rotateRight(e,25),choice=(e&f)^(~e&g),temporary1=(h+s1+choice+sha256Constants[index]+words[index])>>>0,s0=rotateRight(a,2)^rotateRight(a,13)^rotateRight(a,22),majority=(a&b)^(a&c)^(b&c),temporary2=(s0+majority)>>>0;h=g;g=f;f=e;e=(d+temporary1)>>>0;d=c;c=b;b=a;a=(temporary1+temporary2)>>>0;}
    hash[0]=(hash[0]+a)>>>0;hash[1]=(hash[1]+b)>>>0;hash[2]=(hash[2]+c)>>>0;hash[3]=(hash[3]+d)>>>0;hash[4]=(hash[4]+e)>>>0;hash[5]=(hash[5]+f)>>>0;hash[6]=(hash[6]+g)>>>0;hash[7]=(hash[7]+h)>>>0;
  }
  return hash.map(value=>value.toString(16).padStart(8,'0')).join('');
}

const digest=value=>`sha256:${sha256Hex(canonicalJson(value))}`;

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
    replay:null,
  };
}

function publicState(state) {
  const { replay: _replay, ...visible } = state;
  return visible;
}

function appendHistory(history, item) {
  if (history.length >= 10000) fail('MISSION_REPLAY_COMMAND_LIMIT_EXCEEDED', 'Mission replay cannot contain more than 10,000 commands.');
  return [...history, item];
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

export function createMissionModule({ mission, bindings, releaseDigest=null }) {
  const definition = validateDefinition(mission);
  const metricBindings = compileBindings(bindings);
  if (bindings.missionId !== definition.id) fail('MISSION_BINDING_INVALID', 'Capability bindings target a different mission.');
  if(releaseDigest!==null&&!digestPattern.test(releaseDigest))fail('MISSION_REPLAY_INVALID','Mission replay releaseDigest must be a SHA-256 digest.');
  return {
    createState:() => initialState(definition),
    reduce:({ state, command, context }) => {
      if (command.name === 'mission.reset') return initialState(definition);
      if (command.name === 'mission.start') {
        const fresh = initialState(definition);
        const replay={ commandOffset:context.replay.commands().length,initialSnapshot:context.replay.snapshot(fresh) };
        return { ...fresh, status:'running', history:[{ sequence:0, name:'mission.start', payload:{} }],replay };
      }
      if (state.status !== 'running') return state;
      if (command.name === 'mission.advance') {
        const clockId = String(command.payload.clockId ?? definition.clocks[0].id);
        const amount = Number(command.payload.amount ?? 0);
        if (!Number.isFinite(amount) || amount < 0) fail('MISSION_COMMAND_INVALID', 'Mission advance amount must be non-negative.');
        const clocks = spend(state, { [clockId]:amount }, definition.clocks, 'clocks');
        const sequence = state.sequence + 1;
        const advanced = { ...state, clocks, sequence, history:appendHistory(state.history, { sequence, name:command.name, payload:{ clockId, amount } }) };
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
        history:appendHistory(state.history, { sequence, name:command.name, payload:{ actionId } }),
      };
      const transitionReader = makeReader({ state:next, context, metricBindings });
      if (requestedTransition && conditionsPass(requestedTransition.when, transitionReader)) next = { ...next,activeNodeId:requestedTransition.to };
      return resolveOutcome(next, definition, context, metricBindings);
    },
    observe:({ state, query, context }) => {
      if (query?.kind === 'definition') return publicDefinition(definition);
      if (query?.kind === 'replay') {
        if(!releaseDigest)fail('MISSION_REPLAY_METADATA_REQUIRED','Mission replay requires the immutable release digest.');
        if(!state.replay)fail('MISSION_REPLAY_NOT_STARTED','Start the mission before exporting its replay.');
        const commands=context.replay.commands().slice(state.replay.commandOffset);
        if(commands.length>10000)fail('MISSION_REPLAY_COMMAND_LIMIT_EXCEEDED','Mission replay cannot contain more than 10,000 commands.');
        return { format:'mooyu.mission-replay',schemaVersion:1,missionId:definition.id,missionVersion:definition.version,releaseDigest,initialSnapshot:clone(state.replay.initialSnapshot),commands:commands.map((item,sequence)=>({ sequence,...clone(item) })),finalStateDigest:digest(publicState(state)) };
      }
      const node = definition.nodes.find(item => item.id === state.activeNodeId);
      const reader = makeReader({ state, context, metricBindings });
      const metrics = Object.fromEntries([...metricBindings.keys()].map(id => [id, reader({ source:'metric', id })]));
      return { ...clone(publicState(state)), node:node ? { id:node.id,kind:node.kind,title:clone(node.title),actions:node.actions.map(action => ({ id:action.id,title:clone(action.title) })) } : null, metrics };
    },
  };
}

export function evaluateLearningEvidence(model, evidence) {
  if (!model || model.format !== 'mooyu.learning-evidence-model' || model.schemaVersion !== 1) fail('LEARNING_EVIDENCE_MODEL_INVALID', 'Learning evidence model is invalid.');
  const observations = Array.isArray(evidence) ? evidence : [];
  const claims = model.claims.map(claim => {
    const matching = observations.filter(item => item?.claimId === claim.id && item?.kind === claim.kind);
    const strength = matching.reduce((maximum, item) => Math.max(maximum, Number(item.strength) || 0), 0);
    const observed = matching.length > 0;
    return { id:claim.id,objectiveId:claim.objectiveId,strength,minimumStrength:claim.minimumStrength,observed,satisfied:observed && strength >= claim.minimumStrength,required:claim.required === true,weight:claim.weight };
  });
  const objectives = model.objectiveIds.map(objectiveId => {
    const related = claims.filter(claim => claim.objectiveId === objectiveId);
    const totalWeight = related.reduce((sum, claim) => sum + claim.weight, 0);
    const earnedWeight = related.reduce((sum, claim) => sum + (claim.observed ? claim.weight * (claim.minimumStrength <= 0 ? 1 : Math.min(1, claim.strength / claim.minimumStrength)) : 0), 0);
    return { id:objectiveId,score:totalWeight === 0 ? 0 : earnedWeight / totalWeight,mastered:related.length > 0 && related.filter(claim => claim.required).every(claim => claim.satisfied) && related.some(claim => claim.satisfied) };
  });
  return { claims,objectives,mastered:objectives.length > 0 && objectives.every(objective => objective.mastered) };
}

export { compare as evaluateMissionCondition };
