const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../packages/agent-capabilities/src/index.mjs')).href;
const requestId = '11111111-1111-4111-8111-111111111111';
const component = (componentId, role) => ({ componentId, role, version: '1.0.0',
  sha256: componentId.padEnd(64, 'a').slice(0, 64).replace(/[^a-f0-9]/gu, 'a'), sizeBytes: 10 });
const plan = () => ({
  schemaVersion: 'paper-layout-engine-plan-v1',
  contract: { key: 'research.paper.layout', version: 1 }, artifactSha256: 'a'.repeat(64),
  engine: { name: 'PP-StructureV3', version: '3.0.0', adapterVersion: '1.0.0',
    modelDigest: 'b'.repeat(64) }, languages: ['zh-Hans'],
  stages: [{ method: 'local-layout', pages: [1] }, { method: 'local-ocr', pages: [2] }],
  components: [component('pdfium-renderer', 'pdf-renderer'),
    component('pp-layout-model', 'layout-model'),
    component('pp-ocr-det-model', 'ocr-detection-model'),
    component('pp-ocr-rec-model', 'ocr-recognition-model')],
  modelDigest: 'b'.repeat(64),
  resources: { cpuCores: 2, memoryMiB: 3072, diskMiB: 4096, gpuMemoryMiB: 0 },
  limits: { maxPages: 500, maxPixelsPerPage: 50_000_000 },
});

function bindings(value) {
  return value.components.map((item, index) => index === 1 ? { ...item, format: 'zip-bundle',
    localPath: 'C:\\models\\layout', content: { kind: 'zip-bundle',
      manifestSha256: 'c'.repeat(64), fileCount: 1, expandedSizeBytes: 7 },
    files: [{ path: 'model.bin', sha256: 'd'.repeat(64), sizeBytes: 7, executable: false }] }
    : { ...item, localPath: `C:\\models\\${item.componentId}.bin` });
}

test('engine process request freezes plan, local components and bounded output channels', async () => {
  const api = await import(moduleUrl), value = plan();
  const request = api.createPaperLayoutEngineProcessRequest({ requestId, plan: value,
    artifactSourcePath: 'C:\\input\\paper.pdf', componentBindings: bindings(value),
    output: { resultPath: 'C:\\work\\result.json', progressPath: 'C:\\work\\progress.jsonl',
      cancellationPath: 'C:\\work\\cancel' } });
  assert.equal(request.schemaVersion, 'paper-layout-engine-process-request-v1');
  assert.equal(request.components[1].format, 'zip-bundle');
  assert.equal(request.components[1].content.fileCount, 1);
  assert.equal(request.limits.maxResultBytes, 256 * 1024 ** 2);
  const changed = structuredClone(request);
  changed.components[1].files[0].sizeBytes = 6;
  await assert.rejects(async () => api.validatePaperLayoutEngineProcessRequestV1(changed),
    error => error.code === 'PAPER_LAYOUT_ENGINE_PROCESS_COMPONENT_INVALID');
});

test('engine progress is request-bound, monotonic and phase-ordered', async () => {
  const api = await import(moduleUrl), value = plan();
  const request = api.createPaperLayoutEngineProcessRequest({ requestId, plan: value,
    artifactSourcePath: 'C:\\input\\paper.pdf', componentBindings: bindings(value),
    output: { resultPath: 'C:\\work\\result.json', progressPath: 'C:\\work\\progress.jsonl',
      cancellationPath: 'C:\\work\\cancel' } });
  const first = { schemaVersion: 'paper-layout-engine-process-progress-v1', requestId,
    sequence: 1, phase: 'rendering', completedPages: 0, totalPages: 2, currentPage: 1,
    timestamp: '2026-10-29T01:00:00.000Z' };
  const second = { ...first, sequence: 2, phase: 'layout', completedPages: 1, currentPage: 2,
    timestamp: '2026-10-29T01:00:01.000Z' };
  assert.equal(api.validatePaperLayoutEngineProcessProgressV1(second,
    { request, previous: first }).sequence, 2);
  await assert.rejects(async () => api.validatePaperLayoutEngineProcessProgressV1({
    ...second, sequence: 3, phase: 'rendering' }, { request, previous: second }),
  error => error.code === 'PAPER_LAYOUT_ENGINE_PROCESS_PROGRESS_INVALID');
});

test('engine result accepts exact requested pages and rejects partial success', async () => {
  const api = await import(moduleUrl), value = plan();
  const request = api.createPaperLayoutEngineProcessRequest({ requestId, plan: value,
    artifactSourcePath: 'C:\\input\\paper.pdf', componentBindings: bindings(value),
    output: { resultPath: 'C:\\work\\result.json', progressPath: 'C:\\work\\progress.jsonl',
      cancellationPath: 'C:\\work\\cancel' } });
  const block = (id, order) => ({ id, type: 'paragraph', text: '可核验文本',
    bbox: { x: 100, y: 100, width: 8000, height: 500 }, confidenceBp: 9200,
    readingOrder: order });
  const result = { schemaVersion: 'paper-layout-engine-process-result-v1', requestId,
    status: 'succeeded', pages: [
      { page: 1, width: 1000, height: 1400, method: 'local-layout', blocks: [block('p1', 0)] },
      { page: 2, width: 1000, height: 1400, method: 'local-ocr', blocks: [block('p2', 0)] },
    ], diagnostics: { startedAt: '2026-10-29T01:00:00.000Z',
      finishedAt: '2026-10-29T01:00:02.000Z', pageCount: 2, peakMemoryMiB: 900,
      cpuTimeMs: 1700, warnings: [] }, error: null };
  assert.equal(api.validatePaperLayoutEngineProcessResultV1(result, { request }).status, 'succeeded');
  const partial = structuredClone(result);
  partial.pages.pop(); partial.diagnostics.pageCount = 1;
  await assert.rejects(async () => api.validatePaperLayoutEngineProcessResultV1(partial, { request }),
    error => error.code === 'PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
  const cancelled = { ...structuredClone(result), status: 'cancelled', pages: [],
    diagnostics: { ...result.diagnostics, pageCount: 0 },
    error: { code: 'ENGINE_CANCELLED', message: '用户取消', retryable: false } };
  assert.equal(api.validatePaperLayoutEngineProcessResultV1(cancelled, { request }).status,
    'cancelled');
});
