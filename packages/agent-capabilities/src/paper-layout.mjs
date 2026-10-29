import { validateCapabilityExecutionManifestV1 } from './execution.mjs';

export const PAPER_LAYOUT_CONTRACT = Object.freeze({ key: 'research.paper.layout', version: 1 });
export const PAPER_LAYOUT_INPUT_SCHEMA_VERSION = 'research-paper-layout-input-v1';
export const PAPER_LAYOUT_DECISION_SCHEMA_VERSION = 'research-paper-layout-decision-v1';
export const PAPER_LAYOUT_RESULT_SCHEMA_VERSION = 'research-paper-layout-result-v1';
export const PAPER_LAYOUT_QUALITY_POLICY = Object.freeze({
  policyVersion: 'paper-layout-quality-v1', trustedCoverageBp: 9500,
  trustedConfidenceBp: 8500, blockedCoverageBp: 7500, blockedConfidenceBp: 6000,
});

const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const METHODS = new Set(['text-layer', 'local-layout', 'local-ocr']);
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'list', 'table', 'formula', 'figure', 'caption']);
const GRADES = new Set(['trusted', 'restricted', 'blocked']);
const REASONS = new Set([
  'TEXT_LAYER_SUFFICIENT', 'COMPLEX_LAYOUT_SIGNAL', 'TEXT_LAYER_MISSING',
  'TEXT_LAYER_LOW_DENSITY', 'TEXT_LAYER_CORRUPTED', 'SCANNED_PAGE_SIGNAL',
  'PAGE_LIMIT_EXCEEDED', 'BYTE_LIMIT_EXCEEDED', 'OCR_PAGE_LIMIT_EXCEEDED',
  'OCR_DISABLED', 'LAYOUT_DISABLED', 'OUTPUT_COVERAGE_LOW', 'OUTPUT_CONFIDENCE_LOW',
]);

export class PaperLayoutContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PaperLayoutContractError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new PaperLayoutContractError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const string = (value, min, max, pattern = null) => typeof value === 'string'
  && value.trim() === value && value.length >= min && value.length <= max
  && (!pattern || pattern.test(value));
const unique = values => Array.isArray(values) && new Set(values).size === values.length;
const clone = value => structuredClone(value);

function validateArtifact(value) {
  if (!exact(value, ['sha256', 'mimeType', 'sizeBytes', 'pageCount'])
    || !string(value.sha256, 64, 64, SHA256) || value.mimeType !== 'application/pdf'
    || !integer(value.sizeBytes, 1, 4 * 1024 ** 3) || !integer(value.pageCount, 1, 5000)) {
    fail('PAPER_LAYOUT_ARTIFACT_INVALID');
  }
}

function validateSignal(value) {
  if (!exact(value, ['page', 'textChars', 'replacementChars', 'positionedGlyphs',
    'imageCoverageBp', 'multiColumn', 'tableRisk', 'formulaRisk'])
    || !integer(value.page, 1, 5000) || !integer(value.textChars, 0, 10_000_000)
    || !integer(value.replacementChars, 0, value.textChars)
    || !integer(value.positionedGlyphs, 0, 10_000_000)
    || !integer(value.imageCoverageBp, 0, 10000)
    || typeof value.multiColumn !== 'boolean' || typeof value.tableRisk !== 'boolean'
    || typeof value.formulaRisk !== 'boolean') fail('PAPER_LAYOUT_PAGE_SIGNAL_INVALID');
}

export function validatePaperLayoutInputV1(value) {
  if (!exact(value, ['schemaVersion', 'artifact', 'pageSignals', 'policy'])
    || value.schemaVersion !== PAPER_LAYOUT_INPUT_SCHEMA_VERSION || !Array.isArray(value.pageSignals)
    || value.pageSignals.length < 1 || value.pageSignals.length > 5000
    || !exact(value.policy, ['maxPages', 'maxBytes', 'ocrPageLimit', 'allowOcr', 'allowLayout'])
    || !integer(value.policy.maxPages, 1, 5000)
    || !integer(value.policy.maxBytes, 1, 4 * 1024 ** 3)
    || !integer(value.policy.ocrPageLimit, 0, 5000)
    || typeof value.policy.allowOcr !== 'boolean' || typeof value.policy.allowLayout !== 'boolean') {
    fail('PAPER_LAYOUT_INPUT_INVALID');
  }
  validateArtifact(value.artifact);
  value.pageSignals.forEach(validateSignal);
  const pages = value.pageSignals.map(item => item.page);
  if (!unique(pages) || pages.length !== value.artifact.pageCount
    || pages.some((page, index) => page !== index + 1)) {
    fail('PAPER_LAYOUT_PAGE_SIGNAL_INVALID');
  }
  return clone(value);
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function decidePaperLayoutRoute(inputValue) {
  const input = validatePaperLayoutInputV1(inputValue);
  const textLayerPages = [], localLayoutPages = [], localOcrPages = [], reasonCodes = [];
  if (input.artifact.pageCount > input.policy.maxPages) addReason(reasonCodes, 'PAGE_LIMIT_EXCEEDED');
  if (input.artifact.sizeBytes > input.policy.maxBytes) addReason(reasonCodes, 'BYTE_LIMIT_EXCEEDED');
  for (const signal of input.pageSignals) {
    const replacementRatioBp = signal.textChars === 0 ? 0
      : Math.round(signal.replacementChars / signal.textChars * 10000);
    const missing = signal.textChars === 0;
    const lowDensity = signal.textChars > 0 && signal.textChars < 40;
    const corrupted = replacementRatioBp > 500;
    const scanned = missing && signal.imageCoverageBp >= 5000;
    if (missing || lowDensity || corrupted) {
      localOcrPages.push(signal.page);
      addReason(reasonCodes, scanned ? 'SCANNED_PAGE_SIGNAL'
        : missing ? 'TEXT_LAYER_MISSING'
          : lowDensity ? 'TEXT_LAYER_LOW_DENSITY' : 'TEXT_LAYER_CORRUPTED');
    } else if (signal.multiColumn || signal.tableRisk || signal.formulaRisk) {
      localLayoutPages.push(signal.page);
      addReason(reasonCodes, 'COMPLEX_LAYOUT_SIGNAL');
    } else textLayerPages.push(signal.page);
  }
  if (textLayerPages.length > 0) addReason(reasonCodes, 'TEXT_LAYER_SUFFICIENT');
  if (localOcrPages.length > input.policy.ocrPageLimit) addReason(reasonCodes, 'OCR_PAGE_LIMIT_EXCEEDED');
  if (localOcrPages.length > 0 && !input.policy.allowOcr) addReason(reasonCodes, 'OCR_DISABLED');
  if (localLayoutPages.length > 0 && !input.policy.allowLayout) addReason(reasonCodes, 'LAYOUT_DISABLED');
  const blocked = reasonCodes.some(reason => ['PAGE_LIMIT_EXCEEDED', 'BYTE_LIMIT_EXCEEDED',
    'OCR_PAGE_LIMIT_EXCEEDED', 'OCR_DISABLED', 'LAYOUT_DISABLED'].includes(reason));
  const used = [textLayerPages, localLayoutPages, localOcrPages].filter(items => items.length > 0).length;
  const route = blocked ? 'blocked' : used > 1 ? 'mixed'
    : localOcrPages.length ? 'local-ocr' : localLayoutPages.length ? 'local-layout' : 'text-layer';
  return validatePaperLayoutDecisionV1({ schemaVersion: PAPER_LAYOUT_DECISION_SCHEMA_VERSION,
    contract: PAPER_LAYOUT_CONTRACT, artifactSha256: input.artifact.sha256, route,
    textLayerPages, localLayoutPages, localOcrPages, reasonCodes,
    limits: { maxPages: input.policy.maxPages, maxBytes: input.policy.maxBytes,
      ocrPageLimit: input.policy.ocrPageLimit } });
}

export function validatePaperLayoutDecisionV1(value) {
  if (!exact(value, ['schemaVersion', 'contract', 'artifactSha256', 'route', 'textLayerPages',
    'localLayoutPages', 'localOcrPages', 'reasonCodes', 'limits'])
    || value.schemaVersion !== PAPER_LAYOUT_DECISION_SCHEMA_VERSION
    || !exact(value.contract, ['key', 'version']) || value.contract.key !== PAPER_LAYOUT_CONTRACT.key
    || value.contract.version !== PAPER_LAYOUT_CONTRACT.version
    || !string(value.artifactSha256, 64, 64, SHA256)
    || !['text-layer', 'local-layout', 'local-ocr', 'mixed', 'blocked'].includes(value.route)
    || !unique(value.textLayerPages) || !unique(value.localLayoutPages) || !unique(value.localOcrPages)
    || [...value.textLayerPages, ...value.localLayoutPages, ...value.localOcrPages]
      .some(page => !integer(page, 1, 5000))
    || new Set([...value.textLayerPages, ...value.localLayoutPages, ...value.localOcrPages]).size
      !== value.textLayerPages.length + value.localLayoutPages.length + value.localOcrPages.length
    || !unique(value.reasonCodes) || value.reasonCodes.some(reason => !REASONS.has(reason))
    || !exact(value.limits, ['maxPages', 'maxBytes', 'ocrPageLimit'])
    || !integer(value.limits.maxPages, 1, 5000)
    || !integer(value.limits.maxBytes, 1, 4 * 1024 ** 3)
    || !integer(value.limits.ocrPageLimit, 0, 5000)
    || value.route === 'blocked' !== value.reasonCodes.some(reason => [
      'PAGE_LIMIT_EXCEEDED', 'BYTE_LIMIT_EXCEEDED', 'OCR_PAGE_LIMIT_EXCEEDED',
      'OCR_DISABLED', 'LAYOUT_DISABLED'].includes(reason))) fail('PAPER_LAYOUT_DECISION_INVALID');
  const sorted = list => list.every((page, index) => index === 0 || list[index - 1] < page);
  const blocked = value.route === 'blocked';
  const used = [value.textLayerPages, value.localLayoutPages, value.localOcrPages]
    .filter(items => items.length > 0).length;
  const expectedRoute = blocked ? 'blocked' : used > 1 ? 'mixed'
    : value.localOcrPages.length ? 'local-ocr'
      : value.localLayoutPages.length ? 'local-layout' : 'text-layer';
  const hasOcrReason = value.reasonCodes.some(reason => ['TEXT_LAYER_MISSING',
    'TEXT_LAYER_LOW_DENSITY', 'TEXT_LAYER_CORRUPTED', 'SCANNED_PAGE_SIGNAL'].includes(reason));
  if (!sorted(value.textLayerPages) || !sorted(value.localLayoutPages) || !sorted(value.localOcrPages)
    || value.route !== expectedRoute
    || value.reasonCodes.includes('TEXT_LAYER_SUFFICIENT') !== (value.textLayerPages.length > 0)
    || value.reasonCodes.includes('COMPLEX_LAYOUT_SIGNAL') !== (value.localLayoutPages.length > 0)
    || hasOcrReason !== (value.localOcrPages.length > 0)) fail('PAPER_LAYOUT_DECISION_INVALID');
  return clone(value);
}

function validateBlock(block, seenIds, seenOrder) {
  if (!exact(block, ['id', 'type', 'text', 'bbox', 'confidenceBp', 'readingOrder'])
    || !string(block.id, 1, 120) || seenIds.has(block.id) || !BLOCK_TYPES.has(block.type)
    || !string(block.text, 1, 200000)
    || !exact(block.bbox, ['x', 'y', 'width', 'height'])
    || !integer(block.bbox.x, 0, 10000) || !integer(block.bbox.y, 0, 10000)
    || !integer(block.bbox.width, 1, 10000) || !integer(block.bbox.height, 1, 10000)
    || block.bbox.x + block.bbox.width > 10000 || block.bbox.y + block.bbox.height > 10000
    || !integer(block.confidenceBp, 0, 10000) || !integer(block.readingOrder, 0, 1_000_000)
    || seenOrder.has(block.readingOrder)) fail('PAPER_LAYOUT_BLOCK_INVALID');
  seenIds.add(block.id); seenOrder.add(block.readingOrder);
}

export function validatePaperLayoutResultV1(value, { decision = null } = {}) {
  if (!exact(value, ['schemaVersion', 'contract', 'artifact', 'engine', 'pages', 'quality'])
    || value.schemaVersion !== PAPER_LAYOUT_RESULT_SCHEMA_VERSION
    || !exact(value.contract, ['key', 'version']) || value.contract.key !== PAPER_LAYOUT_CONTRACT.key
    || value.contract.version !== PAPER_LAYOUT_CONTRACT.version
    || !exact(value.artifact, ['sourceSha256']) || !string(value.artifact.sourceSha256, 64, 64, SHA256)
    || !exact(value.engine, ['name', 'version', 'modelDigest'])
    || !string(value.engine.name, 2, 120) || !string(value.engine.version, 1, 120)
    || !(value.engine.modelDigest === null || string(value.engine.modelDigest, 64, 64, SHA256))
    || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 100000
    || !exact(value.quality, ['coverageBp', 'minConfidenceBp', 'coordinateSystem', 'grade', 'reasonCodes'])
    || !integer(value.quality.coverageBp, 0, 10000)
    || !integer(value.quality.minConfidenceBp, 0, 10000)
    || value.quality.coordinateSystem !== 'normalized-basis-points'
    || !GRADES.has(value.quality.grade) || !unique(value.quality.reasonCodes)
    || value.quality.reasonCodes.some(reason => !REASONS.has(reason))) fail('PAPER_LAYOUT_RESULT_INVALID');
  const pages = new Set(), ids = new Set(); let hasOcr = false; const confidences = [];
  for (const page of value.pages) {
    if (!exact(page, ['page', 'width', 'height', 'method', 'blocks'])
      || !integer(page.page, 1, 5000) || pages.has(page.page)
      || !Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0
      || !METHODS.has(page.method) || !Array.isArray(page.blocks) || page.blocks.length > 100000) {
      fail('PAPER_LAYOUT_PAGE_INVALID');
    }
    pages.add(page.page); hasOcr ||= page.method === 'local-ocr';
    const orders = new Set(); page.blocks.forEach(block => {
      validateBlock(block, ids, orders); confidences.push(block.confidenceBp);
    });
  }
  if (hasOcr && value.engine.modelDigest === null) fail('PAPER_LAYOUT_OCR_PROVENANCE_REQUIRED');
  const actualMinimum = confidences.length === 0 ? 0 : Math.min(...confidences);
  if (value.quality.minConfidenceBp !== actualMinimum) fail('PAPER_LAYOUT_QUALITY_INVALID');
  const expectedReasons = [];
  if (value.quality.coverageBp < PAPER_LAYOUT_QUALITY_POLICY.trustedCoverageBp) {
    expectedReasons.push('OUTPUT_COVERAGE_LOW');
  }
  if (value.quality.minConfidenceBp < PAPER_LAYOUT_QUALITY_POLICY.trustedConfidenceBp) {
    expectedReasons.push('OUTPUT_CONFIDENCE_LOW');
  }
  const expectedGrade = value.quality.coverageBp < PAPER_LAYOUT_QUALITY_POLICY.blockedCoverageBp
    || value.quality.minConfidenceBp < PAPER_LAYOUT_QUALITY_POLICY.blockedConfidenceBp
    ? 'blocked' : expectedReasons.length ? 'restricted' : 'trusted';
  if (value.quality.grade !== expectedGrade
    || value.quality.reasonCodes.join(',') !== expectedReasons.join(',')) {
    fail('PAPER_LAYOUT_QUALITY_INVALID');
  }
  if (decision) {
    const frozen = validatePaperLayoutDecisionV1(decision);
    if (frozen.route === 'blocked' || frozen.artifactSha256 !== value.artifact.sourceSha256) {
      fail('PAPER_LAYOUT_RESULT_DECISION_MISMATCH');
    }
    const expected = new Map([
      ...frozen.textLayerPages.map(page => [page, 'text-layer']),
      ...frozen.localLayoutPages.map(page => [page, 'local-layout']),
      ...frozen.localOcrPages.map(page => [page, 'local-ocr']),
    ]);
    if (value.pages.length !== expected.size
      || value.pages.some(page => expected.get(page.page) !== page.method)) {
      fail('PAPER_LAYOUT_RESULT_DECISION_MISMATCH');
    }
  }
  return clone(value);
}

export function createPaperLayoutExecutionManifest({ packageRelease,
  capabilityVersion = '1.0.0' } = {}) {
  if (!exact(packageRelease, ['url', 'sha256', 'signature', 'keyId', 'sizeBytes'])) {
    fail('PAPER_LAYOUT_PACKAGE_RELEASE_INVALID');
  }
  return validateCapabilityExecutionManifestV1({
    format: 'mooyu.capability-execution', schemaVersion: 1,
    capabilityId: 'mooyu.research.paper.layout', capabilityVersion,
    contract: PAPER_LAYOUT_CONTRACT,
    placements: [{ target: 'desktop', adapter: 'native-package', priority: 100,
      platforms: ['windows-x64'], resources: { cpuCores: 2, memoryMiB: 3072,
        diskMiB: 4096, gpuMemoryMiB: 0 },
      permissions: { files: 'user-selected', networkDomains: [], devices: [] },
      dataPolicy: { localOnly: true, upload: 'never' }, offline: true, background: true,
      package: clone(packageRelease) }],
    selectionPolicy: { preference: ['desktop'], cloudFallback: 'never',
      requiresUserPresence: true, queueWhenOffline: true },
  });
}
