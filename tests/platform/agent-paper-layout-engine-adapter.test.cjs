const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../packages/agent-capabilities/src/paper-layout-engine.mjs')).href;
const contract = { key: 'research.paper.layout', version: 1 };
const sha = 'a'.repeat(64);

const component = (componentId, role, hash) => ({ componentId, role, version: '1.0.0',
  sha256: hash.repeat(64), sizeBytes: 1024 });
const descriptor = (overrides = {}) => ({
  schemaVersion: 'paper-layout-engine-descriptor-v1',
  engine: { name: 'PP-StructureV3', version: '3.0.0', adapterVersion: '1.0.0',
    modelDigest: 'f'.repeat(64) },
  methods: ['local-layout', 'local-ocr'], languages: ['zh-Hans', 'en'],
  components: [component('pdfium-renderer', 'pdf-renderer', '1'),
    component('pp-layout-model', 'layout-model', '2'),
    component('pp-ocr-det-model', 'ocr-detection-model', '3'),
    component('pp-ocr-rec-model', 'ocr-recognition-model', '4')],
  resources: { cpuCores: 2, memoryMiB: 3072, diskMiB: 4096, gpuMemoryMiB: 0 },
  limits: { maxPages: 500, maxPixelsPerPage: 50_000_000 },
  ...overrides,
});
const mixedDecision = () => ({ schemaVersion: 'research-paper-layout-decision-v1', contract,
  artifactSha256: sha, route: 'mixed', textLayerPages: [1], localLayoutPages: [2],
  localOcrPages: [3], reasonCodes: ['TEXT_LAYER_SUFFICIENT', 'COMPLEX_LAYOUT_SIGNAL',
    'TEXT_LAYER_MISSING'], limits: { maxPages: 500, maxBytes: 536870912, ocrPageLimit: 50 } });

test('paper engine descriptor freezes methods, resources and complete OCR provenance', async () => {
  const api = await import(moduleUrl), value = descriptor();
  assert.deepEqual(api.validatePaperLayoutEngineDescriptorV1(value), value);
  assert.throws(() => api.validatePaperLayoutEngineDescriptorV1({ ...value, cloud: true }),
    /PAPER_LAYOUT_ENGINE_DESCRIPTOR_INVALID/u);
  assert.throws(() => api.validatePaperLayoutEngineDescriptorV1(descriptor({
    components: value.components.filter(item => item.role !== 'ocr-recognition-model'),
  })), /PAPER_LAYOUT_ENGINE_COMPONENT_SET_INCOMPLETE/u);
  assert.throws(() => api.validatePaperLayoutEngineDescriptorV1(descriptor({
    components: [...value.components, { ...value.components[0] }],
  })), /PAPER_LAYOUT_ENGINE_COMPONENT_INVALID/u);
});

test('paper engine plan deterministically binds pages, components and model digest', async () => {
  const api = await import(moduleUrl);
  const first = api.createPaperLayoutEnginePlan({ decision: mixedDecision(),
    descriptor: descriptor(), languages: ['zh-Hans', 'en'] });
  const second = api.createPaperLayoutEnginePlan({ decision: mixedDecision(),
    descriptor: descriptor(), languages: ['zh-Hans', 'en'] });
  assert.deepEqual(first, second);
  assert.deepEqual(first.stages, [{ method: 'local-layout', pages: [2] },
    { method: 'local-ocr', pages: [3] }]);
  assert.match(first.modelDigest, /^[a-f0-9]{64}$/u);
  assert.equal(first.artifactSha256, sha);
  assert.deepEqual(api.validatePaperLayoutEnginePlanV1(first), first);
  assert.throws(() => api.validatePaperLayoutEnginePlanV1({ ...first,
    modelDigest: 'b'.repeat(64) }), /PAPER_LAYOUT_ENGINE_PLAN_PROVENANCE_INVALID/u);
  assert.throws(() => api.validatePaperLayoutEnginePlanV1({ ...first,
    components: first.components.filter(item => item.role !== 'ocr-recognition-model') }),
  /PAPER_LAYOUT_ENGINE_PLAN_COMPONENT_SET_INCOMPLETE/u);
});

test('paper engine planning fails closed on unsupported work, language and blocked routing', async () => {
  const api = await import(moduleUrl), decision = mixedDecision();
  assert.throws(() => api.createPaperLayoutEnginePlan({ decision,
    descriptor: descriptor({ methods: ['local-layout'], components: descriptor().components
      .filter(item => !item.role.startsWith('ocr-')) }) }),
  /PAPER_LAYOUT_ENGINE_METHOD_UNSUPPORTED/u);
  assert.throws(() => api.createPaperLayoutEnginePlan({ decision,
    descriptor: descriptor(), languages: ['ja'] }), /PAPER_LAYOUT_ENGINE_LANGUAGE_UNSUPPORTED/u);
  assert.throws(() => api.createPaperLayoutEnginePlan({ decision: {
    ...decision, route: 'blocked', reasonCodes: [...decision.reasonCodes, 'OCR_DISABLED'],
  }, descriptor: descriptor() }), /PAPER_LAYOUT_ENGINE_DECISION_BLOCKED/u);
  assert.throws(() => api.createPaperLayoutEnginePlan({ decision: {
    ...decision, route: 'text-layer', localLayoutPages: [], localOcrPages: [],
    reasonCodes: ['TEXT_LAYER_SUFFICIENT'],
  }, descriptor: descriptor() }), /PAPER_LAYOUT_ENGINE_NOT_REQUIRED/u);
});

test('layout-only engine plans do not claim an OCR model digest', async () => {
  const api = await import(moduleUrl), value = mixedDecision();
  value.route = 'local-layout'; value.textLayerPages = []; value.localOcrPages = [];
  value.reasonCodes = ['COMPLEX_LAYOUT_SIGNAL'];
  const layoutDescriptor = descriptor({ methods: ['local-layout'],
    components: descriptor().components.filter(item => ['pdf-renderer', 'layout-model']
      .includes(item.role)) });
  const plan = api.createPaperLayoutEnginePlan({ decision: value,
    descriptor: layoutDescriptor, languages: ['zh-Hans'] });
  assert.equal(plan.modelDigest, null);
  assert.deepEqual(plan.stages, [{ method: 'local-layout', pages: [2] }]);
});
