import { COURSEWARE_MODULE_API_VERSION, validateCoursewareModuleManifest } from './module-contract.mjs';

export const COURSEWARE_MODULE_LOCK_FORMAT = 'mooyu.courseware-module-lock';
export const COURSEWARE_MODULE_LOCK_SCHEMA_VERSION = 1;

const pathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const integrityPattern = /^sha256:[a-f0-9]{64}$/u;
const idPattern = /^[a-z][a-z0-9._-]{0,127}$/u;
const allowedRootFields = new Set(['format', 'schemaVersion', 'runtimeApiVersion', 'roots', 'modules']);
const allowedRecordFields = new Set(['manifest', 'entry', 'manifestIntegrity', 'module']);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

function exactObject(value, allowed, pointer) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('COURSEWARE_MODULE_LOCK_INVALID', `${pointer} must be an object.`, { pointer });
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('COURSEWARE_MODULE_LOCK_INVALID', `${pointer} contains unknown field ${key}.`, { pointer:`${pointer}/${key}` });
}

function safePath(value, pointer, extension) {
  if (typeof value !== 'string' || value.length > 255 || !pathPattern.test(value) || (extension && !value.endsWith(extension))) {
    fail('COURSEWARE_MODULE_LOCK_INVALID', `${pointer} must be a safe package-relative ${extension ?? ''} path.`, { pointer });
  }
  return value;
}

export function validateCoursewareModuleLock(value) {
  exactObject(value, allowedRootFields, '/');
  for (const field of ['format', 'schemaVersion', 'runtimeApiVersion', 'roots', 'modules']) {
    if (!(field in value)) fail('COURSEWARE_MODULE_LOCK_INVALID', `Module lock is missing ${field}.`, { pointer:`/${field}` });
  }
  if (value.format !== COURSEWARE_MODULE_LOCK_FORMAT || value.schemaVersion !== COURSEWARE_MODULE_LOCK_SCHEMA_VERSION) {
    fail('COURSEWARE_MODULE_LOCK_UNSUPPORTED', 'Unsupported courseware module lock format.', { pointer:'/format' });
  }
  if (value.runtimeApiVersion !== COURSEWARE_MODULE_API_VERSION) fail('COURSEWARE_MODULE_LOCK_UNSUPPORTED', 'Module lock runtime API version is unsupported.', { pointer:'/runtimeApiVersion' });
  if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > 64 || new Set(value.roots).size !== value.roots.length || value.roots.some(id => !idPattern.test(id))) {
    fail('COURSEWARE_MODULE_LOCK_INVALID', 'roots must be a bounded list of unique module ids.', { pointer:'/roots' });
  }
  if (!Array.isArray(value.modules) || value.modules.length === 0 || value.modules.length > 256) fail('COURSEWARE_MODULE_LOCK_INVALID', 'modules must be a bounded non-empty array.', { pointer:'/modules' });
  const modules = value.modules.map((record, index) => {
    const pointer = `/modules/${index}`;
    exactObject(record, allowedRecordFields, pointer);
    for (const field of ['manifest', 'entry', 'manifestIntegrity', 'module']) if (!(field in record)) fail('COURSEWARE_MODULE_LOCK_INVALID', `Module record is missing ${field}.`, { pointer:`${pointer}/${field}` });
    const manifest = safePath(record.manifest, `${pointer}/manifest`, '.json');
    const entry = safePath(record.entry, `${pointer}/entry`, '.mjs');
    if (!integrityPattern.test(record.manifestIntegrity)) fail('COURSEWARE_MODULE_LOCK_INVALID', 'manifestIntegrity must be a SHA-256 digest.', { pointer:`${pointer}/manifestIntegrity` });
    const module = validateCoursewareModuleManifest(record.module);
    return Object.freeze({ manifest, entry, manifestIntegrity:record.manifestIntegrity, module });
  });
  const ids = modules.map(record => record.module.id);
  if (new Set(ids).size !== ids.length) fail('COURSEWARE_MODULE_LOCK_INVALID', 'Module ids must be unique.', { pointer:'/modules' });
  if (value.roots.some(id => !ids.includes(id))) fail('COURSEWARE_MODULE_LOCK_INVALID', 'Every root must identify a locked module.', { pointer:'/roots' });
  const byId = new Map(modules.map(record => [record.module.id, record.module]));
  for (const record of modules) for (const dependency of record.module.dependencies) {
    const target = byId.get(dependency.id);
    if (!target) {
      if (!dependency.optional) fail('COURSEWARE_MODULE_DEPENDENCY_MISSING', `Locked module ${record.module.id} requires ${dependency.id}.`, { moduleId:record.module.id,dependencyId:dependency.id });
      continue;
    }
    if (target.apiVersion !== dependency.apiVersion || dependency.capabilities.some(capability => !target.capabilities.includes(capability))) {
      fail('COURSEWARE_MODULE_DEPENDENCY_INCOMPATIBLE', `Locked module ${record.module.id} has an incompatible dependency on ${dependency.id}.`, { moduleId:record.module.id,dependencyId:dependency.id });
    }
  }
  const visiting = new Set(); const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail('COURSEWARE_MODULE_DEPENDENCY_CYCLE', `Locked module dependency cycle contains ${id}.`, { moduleId:id });
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) if (byId.has(dependency.id)) visit(dependency.id);
    visiting.delete(id); visited.add(id);
  };
  ids.forEach(visit);
  return Object.freeze({
    format:value.format,
    schemaVersion:value.schemaVersion,
    runtimeApiVersion:value.runtimeApiVersion,
    roots:Object.freeze([...value.roots]),
    modules:Object.freeze(modules),
  });
}

export function defineCoursewareModuleLock(value) {
  return validateCoursewareModuleLock(value);
}
