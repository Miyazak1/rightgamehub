import crypto from 'node:crypto';

export const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Rules state must be JSON serializable.');
  return encoded;
};

export const hashRulesState = state => crypto.createHash('sha256').update(canonicalJson(state)).digest('hex');

const adapterKey = ({ workId,modeKey,rulesetVersion }) => `${workId}:${modeKey}:${rulesetVersion}`;
const requiredFunctions = ['createInitialState','getTurn','getPlayerView','getSpectatorView','serializeState','deserializeState','hashState','validateCommand','applyCommand','handleTimeout'];

export function validateRulesAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Rules adapter must be an object.');
  for (const field of ['workId','modeKey','rulesetVersion']) if (typeof adapter[field] !== 'string' || !adapter[field]) throw new TypeError(`Rules adapter ${field} is required.`);
  for (const method of requiredFunctions) if (typeof adapter[method] !== 'function') throw new TypeError(`Rules adapter ${method}() is required.`);
  return adapter;
}

export function createRulesRegistry(adapters = []) {
  const entries = new Map();
  for (const adapter of adapters) {
    validateRulesAdapter(adapter);
    const key = adapterKey(adapter);
    if (entries.has(key)) throw new TypeError(`Duplicate rules adapter: ${key}`);
    entries.set(key, Object.freeze(adapter));
  }
  return Object.freeze({
    get(identity) { return entries.get(adapterKey(identity)) ?? null; },
    list() { return [...entries.values()]; },
  });
}
