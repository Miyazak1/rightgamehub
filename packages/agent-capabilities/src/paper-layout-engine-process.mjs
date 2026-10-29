import { PAPER_LAYOUT_CONTRACT } from './paper-layout.mjs';
import { validatePaperLayoutEnginePlanV1 } from './paper-layout-engine.mjs';

export const PAPER_LAYOUT_ENGINE_PROCESS_REQUEST_SCHEMA_VERSION =
  'paper-layout-engine-process-request-v1';
export const PAPER_LAYOUT_ENGINE_PROCESS_PROGRESS_SCHEMA_VERSION =
  'paper-layout-engine-process-progress-v1';
export const PAPER_LAYOUT_ENGINE_PROCESS_RESULT_SCHEMA_VERSION =
  'paper-layout-engine-process-result-v1';

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,119}$/u;
const SAFE_RELATIVE = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*[\\])[^\0]+$/u;
const ROLES = new Set(['pdf-renderer', 'layout-model', 'ocr-detection-model',
  'ocr-recognition-model', 'table-model', 'formula-model']);
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'list', 'table', 'formula', 'figure', 'caption']);
const PHASES = ['starting', 'rendering', 'layout', 'ocr', 'finalizing'];
const ERROR_CODES = new Set(['ENGINE_COMPONENT_MISSING', 'ENGINE_INPUT_INVALID',
  'ENGINE_RENDER_FAILED', 'ENGINE_INFERENCE_FAILED', 'ENGINE_RESULT_INVALID',
  'ENGINE_RESOURCE_EXHAUSTED', 'ENGINE_TIMEOUT', 'ENGINE_CANCELLED', 'ENGINE_INTERNAL']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const integer = (value, minimum, maximum) => Number.isSafeInteger(value)
  && value >= minimum && value <= maximum;
const text = (value, minimum, maximum, pattern = null) => typeof value === 'string'
  && value.trim() === value && value.length >= minimum && value.length <= maximum
  && (!pattern || pattern.test(value));
const clone = value => structuredClone(value);

export class PaperLayoutEngineProcessContractError extends Error {
  constructor(code) {
    super(code); this.name = 'PaperLayoutEngineProcessContractError';
    this.code = code; this.retryable = false;
  }
}
const fail = code => { throw new PaperLayoutEngineProcessContractError(code); };

function validateOutputPaths(value) {
  if (!exact(value, ['resultPath', 'progressPath', 'cancellationPath'])
    || Object.values(value).some(item => !text(item, 1, 4096))) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_OUTPUT_INVALID');
  }
}

function validateBundleContent(value) {
  if (!exact(value, ['kind', 'manifestSha256', 'fileCount', 'expandedSizeBytes'])
    || value.kind !== 'zip-bundle' || !text(value.manifestSha256, 64, 64, SHA256)
    || !integer(value.fileCount, 1, 4096)
    || !integer(value.expandedSizeBytes, 1, 20 * 1024 ** 3)) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
  }
}

function validateComponent(value) {
  const base = ['componentId', 'role', 'version', 'sha256', 'sizeBytes', 'format', 'sourcePath'];
  if (!object(value) || !base.every(key => Object.hasOwn(value, key))
    || !text(value.componentId, 3, 120) || !ROLES.has(value.role)
    || !text(value.version, 1, 120, VERSION) || !text(value.sha256, 64, 64, SHA256)
    || !integer(value.sizeBytes, 1, 20 * 1024 ** 3) || !text(value.sourcePath, 1, 4096)) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
  }
  if (value.format === 'file') {
    if (!exact(value, base)) fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
    return;
  }
  if (value.format !== 'zip-bundle' || !exact(value, [...base, 'content', 'files'])
    || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 4096) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
  }
  validateBundleContent(value.content);
  let previous = '', expanded = 0;
  for (const file of value.files) {
    if (!exact(file, ['path', 'sha256', 'sizeBytes', 'executable'])
      || !text(file.path, 1, 500, SAFE_RELATIVE) || file.path <= previous
      || !text(file.sha256, 64, 64, SHA256) || !integer(file.sizeBytes, 0, 20 * 1024 ** 3)
      || typeof file.executable !== 'boolean') {
      fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
    }
    previous = file.path; expanded += file.sizeBytes;
  }
  if (value.files.length !== value.content.fileCount
    || expanded !== value.content.expandedSizeBytes) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
  }
}

export function validatePaperLayoutEngineProcessRequestV1(value) {
  if (!exact(value, ['schemaVersion', 'requestId', 'contract', 'artifact', 'engine', 'languages',
    'stages', 'components', 'output', 'resources', 'limits'])
    || value.schemaVersion !== PAPER_LAYOUT_ENGINE_PROCESS_REQUEST_SCHEMA_VERSION
    || !text(value.requestId, 36, 36, UUID)
    || !exact(value.contract, ['key', 'version']) || value.contract.key !== PAPER_LAYOUT_CONTRACT.key
    || value.contract.version !== PAPER_LAYOUT_CONTRACT.version
    || !exact(value.artifact, ['sourceSha256', 'sourcePath'])
    || !text(value.artifact.sourceSha256, 64, 64, SHA256)
    || !text(value.artifact.sourcePath, 1, 4096)
    || !exact(value.engine, ['name', 'version', 'adapterVersion', 'modelDigest'])
    || !text(value.engine.name, 2, 120) || !text(value.engine.version, 1, 120, VERSION)
    || !text(value.engine.adapterVersion, 1, 120, VERSION)
    || !(value.engine.modelDigest === null || text(value.engine.modelDigest, 64, 64, SHA256))
    || !Array.isArray(value.languages) || value.languages.length < 1 || value.languages.length > 64
    || new Set(value.languages).size !== value.languages.length
    || value.languages.some(language => !text(language, 2, 35, /^[A-Za-z0-9-]+$/u))
    || !Array.isArray(value.stages) || value.stages.length < 1 || value.stages.length > 2
    || !Array.isArray(value.components) || value.components.length < 1 || value.components.length > 64
    || !exact(value.resources, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || !integer(value.resources.cpuCores, 1, 64)
    || !integer(value.resources.memoryMiB, 256, 262144)
    || !integer(value.resources.diskMiB, 128, 1048576)
    || !integer(value.resources.gpuMemoryMiB, 0, 262144)
    || !exact(value.limits, ['maxPages', 'maxPixelsPerPage', 'maxResultBytes',
      'maxProgressBytes'])
    || !integer(value.limits.maxPages, 1, 5000)
    || !integer(value.limits.maxPixelsPerPage, 1_000_000, 1_000_000_000)
    || !integer(value.limits.maxResultBytes, 1024, 1024 ** 3)
    || !integer(value.limits.maxProgressBytes, 1024, 16 * 1024 ** 2)) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_REQUEST_INVALID');
  }
  validateOutputPaths(value.output);
  const methods = [], pages = new Set();
  for (const stage of value.stages) {
    if (!exact(stage, ['method', 'pages']) || !['local-layout', 'local-ocr'].includes(stage.method)
      || methods.includes(stage.method) || !Array.isArray(stage.pages) || stage.pages.length < 1
      || stage.pages.some(page => !integer(page, 1, value.limits.maxPages) || pages.has(page))) {
      fail('PAPER_LAYOUT_ENGINE_PROCESS_REQUEST_INVALID');
    }
    methods.push(stage.method); stage.pages.forEach(page => pages.add(page));
  }
  value.components.forEach(validateComponent);
  if (new Set(value.components.map(item => item.componentId)).size !== value.components.length) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
  }
  return clone(value);
}

export function createPaperLayoutEngineProcessRequest({ requestId, plan: planValue,
  artifactSourcePath, componentBindings, output, maxResultBytes = 256 * 1024 ** 2,
  maxProgressBytes = 1024 * 1024 } = {}) {
  const plan = validatePaperLayoutEnginePlanV1(planValue);
  if (!Array.isArray(componentBindings) || componentBindings.length !== plan.components.length) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
  }
  const components = componentBindings.map(binding => {
    const planned = plan.components.find(item => item.componentId === binding?.componentId);
    if (!planned || ['role', 'version', 'sha256', 'sizeBytes']
      .some(key => binding[key] !== planned[key])) fail('PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
    return binding.format === 'zip-bundle'
      ? { ...clone(planned), format: 'zip-bundle', sourcePath: binding.localPath,
        content: clone(binding.content), files: clone(binding.files) }
      : { ...clone(planned), format: 'file', sourcePath: binding.localPath };
  });
  return validatePaperLayoutEngineProcessRequestV1({
    schemaVersion: PAPER_LAYOUT_ENGINE_PROCESS_REQUEST_SCHEMA_VERSION, requestId,
    contract: clone(plan.contract),
    artifact: { sourceSha256: plan.artifactSha256, sourcePath: artifactSourcePath },
    engine: clone(plan.engine), languages: clone(plan.languages), stages: clone(plan.stages),
    components, output: clone(output), resources: clone(plan.resources),
    limits: { ...clone(plan.limits), maxResultBytes, maxProgressBytes },
  });
}

export function validatePaperLayoutEngineProcessProgressV1(value,
  { request = null, previous = null } = {}) {
  if (!exact(value, ['schemaVersion', 'requestId', 'sequence', 'phase', 'completedPages',
    'totalPages', 'currentPage', 'timestamp'])
    || value.schemaVersion !== PAPER_LAYOUT_ENGINE_PROCESS_PROGRESS_SCHEMA_VERSION
    || !text(value.requestId, 36, 36, UUID) || !integer(value.sequence, 1, Number.MAX_SAFE_INTEGER)
    || !PHASES.includes(value.phase) || !integer(value.completedPages, 0, 5000)
    || !integer(value.totalPages, 1, 5000) || value.completedPages > value.totalPages
    || !(value.currentPage === null || integer(value.currentPage, 1, 5000))
    || !text(value.timestamp, 20, 40) || !Number.isFinite(Date.parse(value.timestamp))) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_PROGRESS_INVALID');
  }
  if (request) {
    const normalized = validatePaperLayoutEngineProcessRequestV1(request);
    const requestedPages = new Set(normalized.stages.flatMap(stage => stage.pages));
    if (value.requestId !== normalized.requestId || value.totalPages !== requestedPages.size
      || value.currentPage !== null && !requestedPages.has(value.currentPage)) {
      fail('PAPER_LAYOUT_ENGINE_PROCESS_PROGRESS_INVALID');
    }
  }
  if (previous) {
    const normalized = validatePaperLayoutEngineProcessProgressV1(previous, { request });
    if (value.requestId !== normalized.requestId || value.sequence !== normalized.sequence + 1
      || value.completedPages < normalized.completedPages
      || PHASES.indexOf(value.phase) < PHASES.indexOf(normalized.phase)
      || Date.parse(value.timestamp) < Date.parse(normalized.timestamp)) {
      fail('PAPER_LAYOUT_ENGINE_PROCESS_PROGRESS_INVALID');
    }
  }
  return clone(value);
}

function validateBlock(value, ids, orders) {
  if (!exact(value, ['id', 'type', 'text', 'bbox', 'confidenceBp', 'readingOrder'])
    || !text(value.id, 1, 120) || ids.has(value.id) || !BLOCK_TYPES.has(value.type)
    || !text(value.text, 1, 200000) || !exact(value.bbox, ['x', 'y', 'width', 'height'])
    || !integer(value.bbox.x, 0, 10000) || !integer(value.bbox.y, 0, 10000)
    || !integer(value.bbox.width, 1, 10000) || !integer(value.bbox.height, 1, 10000)
    || value.bbox.x + value.bbox.width > 10000 || value.bbox.y + value.bbox.height > 10000
    || !integer(value.confidenceBp, 0, 10000)
    || !integer(value.readingOrder, 0, 1_000_000) || orders.has(value.readingOrder)) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
  }
  ids.add(value.id); orders.add(value.readingOrder);
}

export function validatePaperLayoutEngineProcessResultV1(value, { request = null } = {}) {
  if (!exact(value, ['schemaVersion', 'requestId', 'status', 'pages', 'diagnostics', 'error'])
    || value.schemaVersion !== PAPER_LAYOUT_ENGINE_PROCESS_RESULT_SCHEMA_VERSION
    || !text(value.requestId, 36, 36, UUID)
    || !['succeeded', 'failed', 'cancelled'].includes(value.status)
    || !Array.isArray(value.pages) || value.pages.length > 5000
    || !exact(value.diagnostics, ['startedAt', 'finishedAt', 'pageCount', 'peakMemoryMiB',
      'cpuTimeMs', 'warnings'])
    || !text(value.diagnostics.startedAt, 20, 40)
    || !text(value.diagnostics.finishedAt, 20, 40)
    || !Number.isFinite(Date.parse(value.diagnostics.startedAt))
    || !Number.isFinite(Date.parse(value.diagnostics.finishedAt))
    || Date.parse(value.diagnostics.finishedAt) < Date.parse(value.diagnostics.startedAt)
    || !integer(value.diagnostics.pageCount, 0, 5000)
    || !integer(value.diagnostics.peakMemoryMiB, 0, 262144)
    || !integer(value.diagnostics.cpuTimeMs, 0, 24 * 60 * 60_000)
    || !Array.isArray(value.diagnostics.warnings) || value.diagnostics.warnings.length > 100
    || value.diagnostics.warnings.some(item => !text(item, 1, 500))) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
  }
  const success = value.status === 'succeeded';
  if (success !== (value.error === null) || success && value.pages.length < 1
    || !success && value.pages.length !== 0
    || !success && (!exact(value.error, ['code', 'message', 'retryable'])
      || !ERROR_CODES.has(value.error.code) || !text(value.error.message, 1, 1000)
      || typeof value.error.retryable !== 'boolean')
    || value.status === 'cancelled' && value.error?.code !== 'ENGINE_CANCELLED') {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
  }
  const pageNumbers = new Set(), ids = new Set();
  for (const page of value.pages) {
    if (!exact(page, ['page', 'width', 'height', 'method', 'blocks'])
      || !integer(page.page, 1, 5000) || pageNumbers.has(page.page)
      || !Number.isFinite(page.width) || page.width <= 0
      || !Number.isFinite(page.height) || page.height <= 0
      || !['local-layout', 'local-ocr'].includes(page.method)
      || !Array.isArray(page.blocks) || page.blocks.length > 100000) {
      fail('PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
    }
    pageNumbers.add(page.page); const orders = new Set();
    page.blocks.forEach(block => validateBlock(block, ids, orders));
  }
  if (value.diagnostics.pageCount !== value.pages.length) {
    fail('PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
  }
  if (request) {
    const normalized = validatePaperLayoutEngineProcessRequestV1(request);
    const expected = new Map(normalized.stages.flatMap(stage => stage.pages
      .map(page => [page, stage.method])));
    if (value.requestId !== normalized.requestId
      || success && (value.pages.length !== expected.size
        || value.pages.some(page => expected.get(page.page) !== page.method))) {
      fail('PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
    }
  }
  return clone(value);
}
