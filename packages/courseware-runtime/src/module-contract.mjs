export const COURSEWARE_MODULE_FORMAT = 'mooyu.courseware-module';
export const COURSEWARE_MODULE_SCHEMA_VERSION = 1;
export const COURSEWARE_MODULE_API_VERSION = 1;

export const COURSEWARE_MODULE_KINDS = Object.freeze([
  'domain', 'scenario', 'construction', 'challenge', 'component', 'instrument', 'journey', 'embed',
]);

export const COURSEWARE_HOT_SWAP_MODES = Object.freeze(['live', 'paused', 'session']);

const idPattern = /^[a-z][a-z0-9._-]{0,127}$/u;
const semverPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const integrityPattern = /^sha256:[a-f0-9]{64}$/u;
const allowedRootFields = new Set([
  'format', 'schemaVersion', 'id', 'version', 'kind', 'apiVersion', 'entry', 'integrity',
  'hotSwap', 'stateSchemaVersion', 'capabilities', 'commands', 'dependencies',
]);
const allowedDependencyFields = new Set(['id', 'apiVersion', 'capabilities', 'optional']);
const hotSwapByKind = Object.freeze({
  domain: new Set(['paused', 'session']),
  scenario: new Set(['paused', 'session']),
  construction: new Set(['paused', 'session']),
  challenge: new Set(['paused', 'session']),
  component: new Set(['live', 'paused', 'session']),
  instrument: new Set(['live', 'paused', 'session']),
  journey: new Set(['paused', 'session']),
  embed: new Set(['session']),
});

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

function exactFields(value, allowed, pointer) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', `${pointer} must be an object.`, { pointer });
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', `${pointer} contains unknown field ${key}.`, { pointer: `${pointer}/${key}` });
}

function ids(value, pointer, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 128 || new Set(value).size !== value.length || value.some(item => !idPattern.test(item))) {
    fail('COURSEWARE_MODULE_MANIFEST_INVALID', `${pointer} must be a bounded list of unique stable identifiers.`, { pointer });
  }
  return [...value];
}

function safeEntry(value) {
  return typeof value === 'string'
    && /^\.\/[a-zA-Z0-9._/-]+\.mjs$/u.test(value)
    && !value.split('/').some(part => part === '..' || part === '');
}

export function validateCoursewareModuleManifest(value) {
  exactFields(value, allowedRootFields, '/');
  for (const field of ['format', 'schemaVersion', 'id', 'version', 'kind', 'apiVersion', 'entry', 'integrity', 'hotSwap', 'stateSchemaVersion', 'capabilities', 'commands', 'dependencies']) {
    if (!(field in value)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', `Module manifest is missing ${field}.`, { pointer: `/${field}` });
  }
  if (value.format !== COURSEWARE_MODULE_FORMAT || value.schemaVersion !== COURSEWARE_MODULE_SCHEMA_VERSION) fail('COURSEWARE_MODULE_FORMAT_UNSUPPORTED', 'Unsupported courseware module format.', { pointer: '/format' });
  if (!idPattern.test(value.id)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'Module id is invalid.', { pointer: '/id' });
  if (!semverPattern.test(value.version)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'Module version must be semantic versioning.', { pointer: '/version' });
  if (!COURSEWARE_MODULE_KINDS.includes(value.kind)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'Module kind is invalid.', { pointer: '/kind' });
  if (!Number.isInteger(value.apiVersion) || value.apiVersion < 1) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'apiVersion must be a positive integer.', { pointer: '/apiVersion' });
  if (!safeEntry(value.entry)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'entry must be a safe local .mjs path.', { pointer: '/entry' });
  if (!integrityPattern.test(value.integrity)) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'integrity must be a SHA-256 release digest.', { pointer: '/integrity' });
  if (!hotSwapByKind[value.kind].has(value.hotSwap)) fail('COURSEWARE_MODULE_HOT_SWAP_INVALID', `${value.kind} modules cannot use ${value.hotSwap} hot swap.`, { pointer: '/hotSwap' });
  if (!Number.isInteger(value.stateSchemaVersion) || value.stateSchemaVersion < 1) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'stateSchemaVersion must be a positive integer.', { pointer: '/stateSchemaVersion' });
  const capabilities = ids(value.capabilities, '/capabilities');
  const commands = ids(value.commands, '/commands');
  if (!Array.isArray(value.dependencies) || value.dependencies.length > 64) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'dependencies must be a bounded array.', { pointer: '/dependencies' });
  const dependencies = value.dependencies.map((dependency, index) => {
    const pointer = `/dependencies/${index}`;
    exactFields(dependency, allowedDependencyFields, pointer);
    if (!idPattern.test(dependency.id) || dependency.id === value.id) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'Dependency id is invalid.', { pointer: `${pointer}/id` });
    if (!Number.isInteger(dependency.apiVersion) || dependency.apiVersion < 1) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'Dependency apiVersion must be a positive integer.', { pointer: `${pointer}/apiVersion` });
    if (dependency.optional !== undefined && typeof dependency.optional !== 'boolean') fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'Dependency optional must be boolean.', { pointer: `${pointer}/optional` });
    return Object.freeze({ id: dependency.id, apiVersion: dependency.apiVersion, capabilities: Object.freeze(ids(dependency.capabilities ?? [], `${pointer}/capabilities`)), optional: dependency.optional === true });
  });
  if (new Set(dependencies.map(item => item.id)).size !== dependencies.length) fail('COURSEWARE_MODULE_MANIFEST_INVALID', 'Dependency ids must be unique.', { pointer: '/dependencies' });
  return Object.freeze({
    format: value.format,
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    kind: value.kind,
    apiVersion: value.apiVersion,
    entry: value.entry,
    integrity: value.integrity,
    hotSwap: value.hotSwap,
    stateSchemaVersion: value.stateSchemaVersion,
    capabilities: Object.freeze(capabilities),
    commands: Object.freeze(commands),
    dependencies: Object.freeze(dependencies),
  });
}

export function defineCoursewareModule(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) fail('COURSEWARE_MODULE_DEFINITION_INVALID', 'Module definition must be an object.');
  const allowed = new Set(['manifest', 'createState', 'reduce', 'observe', 'activate', 'deactivate', 'dispose', 'migrateState']);
  for (const key of Object.keys(definition)) if (!allowed.has(key)) fail('COURSEWARE_MODULE_DEFINITION_INVALID', `Module definition contains unknown field ${key}.`);
  const manifest = validateCoursewareModuleManifest(definition.manifest);
  for (const hook of ['createState', 'reduce', 'observe', 'activate', 'deactivate', 'dispose', 'migrateState']) {
    if (definition[hook] !== undefined && typeof definition[hook] !== 'function') fail('COURSEWARE_MODULE_DEFINITION_INVALID', `${hook} must be a function.`, { moduleId: manifest.id });
  }
  if (manifest.commands.length && typeof definition.reduce !== 'function') fail('COURSEWARE_MODULE_DEFINITION_INVALID', 'A module that declares commands must implement reduce().', { moduleId: manifest.id });
  return Object.freeze({ ...definition, manifest });
}
