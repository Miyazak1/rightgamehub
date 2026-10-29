import { PAPER_LAYOUT_CONTRACT, validatePaperLayoutDecisionV1 } from './paper-layout.mjs';

export const PAPER_LAYOUT_ENGINE_DESCRIPTOR_SCHEMA_VERSION = 'paper-layout-engine-descriptor-v1';
export const PAPER_LAYOUT_ENGINE_PLAN_SCHEMA_VERSION = 'paper-layout-engine-plan-v1';

const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,119}$/u;
const ID = /^[a-z][a-z0-9._-]{2,119}$/u;
const METHODS = ['local-layout', 'local-ocr'];
const ROLES = new Set(['pdf-renderer', 'layout-model', 'ocr-detection-model',
  'ocr-recognition-model', 'table-model', 'formula-model']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const integer = (value, minimum, maximum) => Number.isSafeInteger(value)
  && value >= minimum && value <= maximum;
const text = (value, minimum, maximum, pattern = null) => typeof value === 'string'
  && value.trim() === value && value.length >= minimum && value.length <= maximum
  && (!pattern || pattern.test(value));
const clone = value => structuredClone(value);

export class PaperLayoutEngineContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PaperLayoutEngineContractError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new PaperLayoutEngineContractError(code); };
const orderedUnique = (values, order = null) => Array.isArray(values)
  && new Set(values).size === values.length
  && (!order || values.every((value, index) => order.indexOf(value)
    > (index === 0 ? -1 : order.indexOf(values[index - 1]))));

function validateComponent(value) {
  if (!exact(value, ['componentId', 'role', 'version', 'sha256', 'sizeBytes'])
    || !text(value.componentId, 3, 120, ID) || !ROLES.has(value.role)
    || !text(value.version, 1, 120, VERSION) || !text(value.sha256, 64, 64, SHA256)
    || !integer(value.sizeBytes, 1, 20 * 1024 ** 3)) fail('PAPER_LAYOUT_ENGINE_COMPONENT_INVALID');
}

export function validatePaperLayoutEngineDescriptorV1(value) {
  if (!exact(value, ['schemaVersion', 'engine', 'methods', 'languages', 'components',
    'resources', 'limits'])
    || value.schemaVersion !== PAPER_LAYOUT_ENGINE_DESCRIPTOR_SCHEMA_VERSION
    || !exact(value.engine, ['name', 'version', 'adapterVersion', 'modelDigest'])
    || !text(value.engine.name, 2, 120) || !text(value.engine.version, 1, 120, VERSION)
    || !text(value.engine.adapterVersion, 1, 120, VERSION)
    || !(value.engine.modelDigest === null || text(value.engine.modelDigest, 64, 64, SHA256))
    || !orderedUnique(value.methods, METHODS) || value.methods.length < 1
    || value.methods.some(method => !METHODS.includes(method))
    || !orderedUnique(value.languages) || value.languages.length < 1 || value.languages.length > 64
    || value.languages.some(language => !text(language, 2, 35, /^[A-Za-z0-9-]+$/u))
    || !Array.isArray(value.components) || value.components.length < 1
    || value.components.length > 64
    || !exact(value.resources, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || !integer(value.resources.cpuCores, 1, 64)
    || !integer(value.resources.memoryMiB, 256, 262144)
    || !integer(value.resources.diskMiB, 128, 1048576)
    || !integer(value.resources.gpuMemoryMiB, 0, 262144)
    || !exact(value.limits, ['maxPages', 'maxPixelsPerPage'])
    || !integer(value.limits.maxPages, 1, 5000)
    || !integer(value.limits.maxPixelsPerPage, 1_000_000, 1_000_000_000)) {
    fail('PAPER_LAYOUT_ENGINE_DESCRIPTOR_INVALID');
  }
  value.components.forEach(validateComponent);
  if (new Set(value.components.map(item => item.componentId)).size !== value.components.length) {
    fail('PAPER_LAYOUT_ENGINE_COMPONENT_INVALID');
  }
  const roles = new Set(value.components.map(item => item.role));
  if (value.methods.includes('local-layout') && !roles.has('layout-model')
    || value.methods.includes('local-ocr')
      && (!roles.has('ocr-detection-model') || !roles.has('ocr-recognition-model')
        || value.engine.modelDigest === null)) {
    fail('PAPER_LAYOUT_ENGINE_COMPONENT_SET_INCOMPLETE');
  }
  return clone(value);
}

export function createPaperLayoutEnginePlan({ decision: decisionValue,
  descriptor: descriptorValue, languages = ['zh-Hans', 'en'] } = {}) {
  const decision = validatePaperLayoutDecisionV1(decisionValue);
  const descriptor = validatePaperLayoutEngineDescriptorV1(descriptorValue);
  if (decision.route === 'blocked') fail('PAPER_LAYOUT_ENGINE_DECISION_BLOCKED');
  const stages = [
    { method: 'local-layout', pages: decision.localLayoutPages },
    { method: 'local-ocr', pages: decision.localOcrPages },
  ].filter(stage => stage.pages.length > 0);
  if (stages.length === 0) fail('PAPER_LAYOUT_ENGINE_NOT_REQUIRED');
  if (stages.some(stage => !descriptor.methods.includes(stage.method))) {
    fail('PAPER_LAYOUT_ENGINE_METHOD_UNSUPPORTED');
  }
  if (!orderedUnique(languages) || languages.length < 1
    || languages.some(language => !descriptor.languages.includes(language))) {
    fail('PAPER_LAYOUT_ENGINE_LANGUAGE_UNSUPPORTED');
  }
  const components = descriptor.components.map(clone);
  const usesOcr = stages.some(stage => stage.method === 'local-ocr');
  return validatePaperLayoutEnginePlanV1({
    schemaVersion: PAPER_LAYOUT_ENGINE_PLAN_SCHEMA_VERSION,
    contract: PAPER_LAYOUT_CONTRACT,
    artifactSha256: decision.artifactSha256,
    engine: clone(descriptor.engine),
    languages: [...languages],
    stages: stages.map(stage => ({ method: stage.method, pages: [...stage.pages] })),
    components,
    modelDigest: usesOcr ? descriptor.engine.modelDigest : null,
    resources: clone(descriptor.resources),
    limits: clone(descriptor.limits),
  });
}

export function validatePaperLayoutEnginePlanV1(value) {
  if (!exact(value, ['schemaVersion', 'contract', 'artifactSha256', 'engine', 'languages',
    'stages', 'components', 'modelDigest', 'resources', 'limits'])
    || value.schemaVersion !== PAPER_LAYOUT_ENGINE_PLAN_SCHEMA_VERSION
    || !exact(value.contract, ['key', 'version']) || value.contract.key !== PAPER_LAYOUT_CONTRACT.key
    || value.contract.version !== PAPER_LAYOUT_CONTRACT.version
    || !text(value.artifactSha256, 64, 64, SHA256)
    || !exact(value.engine, ['name', 'version', 'adapterVersion', 'modelDigest'])
    || !text(value.engine.name, 2, 120) || !text(value.engine.version, 1, 120, VERSION)
    || !text(value.engine.adapterVersion, 1, 120, VERSION)
    || !(value.engine.modelDigest === null || text(value.engine.modelDigest, 64, 64, SHA256))
    || !orderedUnique(value.languages) || value.languages.length < 1
    || value.languages.some(language => !text(language, 2, 35, /^[A-Za-z0-9-]+$/u))
    || !Array.isArray(value.stages) || value.stages.length < 1 || value.stages.length > 2
    || !Array.isArray(value.components) || value.components.length < 1
    || !exact(value.resources, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || !exact(value.limits, ['maxPages', 'maxPixelsPerPage'])) {
    fail('PAPER_LAYOUT_ENGINE_PLAN_INVALID');
  }
  const methods = value.stages.map(stage => stage?.method);
  if (!orderedUnique(methods, METHODS) || value.stages.some(stage => !exact(stage, ['method', 'pages'])
    || !METHODS.includes(stage.method) || !orderedUnique(stage.pages)
    || stage.pages.length < 1 || stage.pages.some(page => !integer(page, 1, 5000)))) {
    fail('PAPER_LAYOUT_ENGINE_PLAN_INVALID');
  }
  const allPages = value.stages.flatMap(stage => stage.pages);
  if (new Set(allPages).size !== allPages.length) fail('PAPER_LAYOUT_ENGINE_PLAN_INVALID');
  value.components.forEach(validateComponent);
  if (new Set(value.components.map(item => item.componentId)).size !== value.components.length) {
    fail('PAPER_LAYOUT_ENGINE_PLAN_INVALID');
  }
  const roles = new Set(value.components.map(item => item.role));
  if (!roles.has('pdf-renderer') || methods.includes('local-layout') && !roles.has('layout-model')
    || methods.includes('local-ocr')
      && (!roles.has('ocr-detection-model') || !roles.has('ocr-recognition-model'))) {
    fail('PAPER_LAYOUT_ENGINE_PLAN_COMPONENT_SET_INCOMPLETE');
  }
  const usesOcr = methods.includes('local-ocr');
  if (usesOcr ? value.modelDigest !== value.engine.modelDigest || value.modelDigest === null
    : value.modelDigest !== null) {
    fail('PAPER_LAYOUT_ENGINE_PLAN_PROVENANCE_INVALID');
  }
  if (!integer(value.resources.cpuCores, 1, 64)
    || !integer(value.resources.memoryMiB, 256, 262144)
    || !integer(value.resources.diskMiB, 128, 1048576)
    || !integer(value.resources.gpuMemoryMiB, 0, 262144)
    || !integer(value.limits.maxPages, 1, 5000)
    || !integer(value.limits.maxPixelsPerPage, 1_000_000, 1_000_000_000)) {
    fail('PAPER_LAYOUT_ENGINE_PLAN_INVALID');
  }
  return clone(value);
}
