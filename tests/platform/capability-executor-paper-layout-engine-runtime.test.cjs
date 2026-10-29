const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const engineUrl = pathToFileURL(path.resolve(__dirname,
  '../../packages/agent-capabilities/src/paper-layout-engine.mjs')).href;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

const planFixture = () => ({
  schemaVersion: 'paper-layout-engine-plan-v1',
  contract: { key: 'research.paper.layout', version: 1 }, artifactSha256: 'a'.repeat(64),
  engine: { name: 'PP-StructureV3', version: '3.0.0', adapterVersion: '1.0.0',
    modelDigest: 'f'.repeat(64) }, languages: ['zh-Hans', 'en'],
  stages: [{ method: 'local-layout', pages: [1] }, { method: 'local-ocr', pages: [2] }],
  components: [
    ['pdfium-renderer', 'pdf-renderer'], ['pp-layout-model', 'layout-model'],
    ['pp-ocr-det-model', 'ocr-detection-model'], ['pp-ocr-rec-model', 'ocr-recognition-model'],
  ].map(([componentId, role]) => ({ componentId, role, version: '1.0.0',
    sha256: digest(Buffer.from(`${componentId}-bytes`)),
    sizeBytes: Buffer.byteLength(`${componentId}-bytes`) })),
  modelDigest: 'f'.repeat(64),
  resources: { cpuCores: 2, memoryMiB: 3072, diskMiB: 4096, gpuMemoryMiB: 0 },
  limits: { maxPages: 500, maxPixelsPerPage: 50_000_000 },
});

test('paper engine runtime materializes every signed-plan component as a verified local file', async () => {
  const executor = await import(executorUrl), engine = await import(engineUrl);
  const root = path.resolve('.runtime/paper-engine-runtime-tests');
  await fs.promises.mkdir(root, { recursive: true });
  const temporary = await fs.promises.mkdtemp(path.join(root, 'materialize-'));
  try {
    const roles = [['pdfium-renderer', 'pdf-renderer'], ['pp-layout-model', 'layout-model'],
      ['pp-ocr-det-model', 'ocr-detection-model'], ['pp-ocr-rec-model', 'ocr-recognition-model']];
    const components = [];
    for (const [componentId, role] of roles) {
      const bytes = Buffer.from(`${componentId}-bytes`), localPath = path.join(temporary, `${componentId}.bin`);
      await fs.promises.writeFile(localPath, bytes);
      components.push({ componentId, role, version: '1.0.0', sha256: digest(bytes),
        sizeBytes: bytes.length, localPath });
    }
    const plan = engine.validatePaperLayoutEnginePlanV1(planFixture());
    const calls = [];
    const runtime = executor.createPaperLayoutEngineRuntime({ componentManager: {
      async ensure(request) {
        calls.push(request);
        const match = components.find(item => item.componentId === request.component.componentId);
        return { component: request.component, absolutePath: match.localPath };
      },
    } });
    const materialized = await runtime.materialize({ catalog: { signed: true }, plan });
    assert.equal(materialized.schemaVersion, 'paper-layout-engine-runtime-v1');
    assert.equal(materialized.componentBindings.length, 4);
    assert.equal(calls.every(call => call.engine.name === 'PP-StructureV3'
      && call.languages[0] === 'zh-Hans'), true);
    assert.equal(materialized.componentBindings.every(item => path.isAbsolute(item.localPath)), true);

    await fs.promises.writeFile(components[0].localPath, Buffer.from('tampered'));
    await assert.rejects(runtime.materialize({ catalog: { signed: true }, plan }),
      error => error.code === 'PAPER_LAYOUT_ENGINE_COMPONENT_BINDING_INVALID');
  } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
});

test('paper component resolver consumes one succeeded engine plan and a trusted local catalog', async () => {
  const executor = await import(executorUrl), plan = planFixture(), calls = [];
  const bindings = plan.components.map(component => ({ ...component,
    localPath: path.resolve('.runtime', `${component.componentId}.bin`) }));
  const resolver = executor.createPaperLayoutComponentResolver({
    catalogProvider: { async getCatalog(request) { calls.push(['catalog', request]);
      return { schemaVersion: 'capability-component-catalog-v1' }; } },
    engineRuntime: { async materialize(request) { calls.push(['materialize', request]); return {
      schemaVersion: 'paper-layout-engine-runtime-v1', plan: request.plan,
      componentBindings: bindings,
    }; } },
  });
  const signal = new AbortController().signal;
  const resolved = await resolver.resolve({ contract: plan.contract, signal, prerequisites: [{
    stageKey: executor.PAPER_LAYOUT_ENGINE_PLAN_STAGE_KEY, status: 'succeeded', outputRef: plan,
  }] });
  assert.deepEqual(resolved, bindings);
  assert.equal(calls[0][0], 'catalog');
  assert.deepEqual(calls[0][1].engine, plan.engine);
  assert.deepEqual(calls[0][1].components, plan.components);
  assert.equal(calls[1][1].catalog.schemaVersion, 'capability-component-catalog-v1');
  assert.deepEqual(await resolver.resolve({ contract: { key: 'research.other', version: 1 },
    prerequisites: [] }), []);
  for (const prerequisites of [[], [
    { stageKey: executor.PAPER_LAYOUT_ENGINE_PLAN_STAGE_KEY, status: 'succeeded', outputRef: plan },
    { stageKey: executor.PAPER_LAYOUT_ENGINE_PLAN_STAGE_KEY, status: 'succeeded', outputRef: plan },
  ]]) {
    await assert.rejects(resolver.resolve({ contract: plan.contract, prerequisites }),
      error => error.code === 'PAPER_LAYOUT_ENGINE_PREREQUISITE_INVALID'
        && error.safeFailure === true);
  }
});

test('paper engine runtime binds an installed multi-file model only after complete re-verification', async t => {
  const executor = await import(executorUrl);
  const zipUrl = pathToFileURL(path.resolve(__dirname,
    '../../apps/api/src/zip-buffer-writer.mjs')).href;
  const { createZipBuffer } = await import(zipUrl);
  const root = await fs.promises.mkdtemp(path.resolve('.runtime/paper-engine-bundle-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('layout weights'), file = { path: 'models/layout.bin',
    sha256: digest(bytes), sizeBytes: bytes.length, executable: false };
  const manifest = { schemaVersion: 'capability-component-bundle-v1', component: {
    componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0',
  }, files: [file] };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const archive = createZipBuffer([{ name: 'component.bundle.json', data: manifestBytes },
    { name: 'payload/models/layout.bin', data: bytes }]);
  const archivePath = path.join(root, 'layout.zip'), bundleDirectory = path.join(root, 'bundle');
  await fs.promises.writeFile(archivePath, archive);
  const component = { componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0',
    sha256: digest(archive), sizeBytes: archive.length };
  const content = { kind: 'zip-bundle', manifestSha256: digest(manifestBytes), fileCount: 1,
    expandedSizeBytes: bytes.length };
  const extracted = await executor.extractVerifiedCapabilityComponentBundle({ archivePath,
    destination: bundleDirectory, component, content });
  const plan = planFixture();
  plan.components = plan.components.map(item => item.role === 'layout-model' ? component : item);
  const singleFiles = new Map();
  for (const item of plan.components.filter(value => value.role !== 'layout-model')) {
    const filePath = path.join(root, `${item.componentId}.bin`);
    await fs.promises.writeFile(filePath, Buffer.from(`${item.componentId}-bytes`));
    singleFiles.set(item.componentId, filePath);
  }
  const runtime = executor.createPaperLayoutEngineRuntime({ componentManager: {
    async ensure(request) { return request.component.role === 'layout-model'
      ? { component, content, archivePath, absolutePath: extracted.rootDirectory }
      : { component: request.component, absolutePath: singleFiles.get(request.component.componentId) }; },
  } });
  const materialized = await runtime.materialize({ catalog: {}, plan });
  assert.deepEqual(materialized.componentBindings.find(item => item.role === 'layout-model'),
    { ...component, format: 'zip-bundle',
    archivePath, localPath: extracted.rootDirectory, content, files: [file] });
  await fs.promises.writeFile(extracted.files[0].absolutePath, 'tampered');
  await assert.rejects(runtime.materialize({ catalog: {}, plan }),
    error => error.code === 'PAPER_LAYOUT_ENGINE_COMPONENT_BINDING_INVALID');
});
