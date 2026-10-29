const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const contractUrl = pathToFileURL(path.resolve(__dirname,
  '../../packages/agent-capabilities/src/index.mjs')).href;
const ids = {
  success: '21111111-1111-4111-8111-111111111111',
  rewrite: '21111111-1111-4111-8111-111111111112',
  flood: '21111111-1111-4111-8111-111111111113',
  cancel: '21111111-1111-4111-8111-111111111114',
  timeout: '21111111-1111-4111-8111-111111111115',
  invalid: '21111111-1111-4111-8111-111111111116',
};

const component = (componentId, role) => ({ componentId, role, version: '1.0.0',
  sha256: 'a'.repeat(64), sizeBytes: 10 });
const plan = () => ({ schemaVersion: 'paper-layout-engine-plan-v1',
  contract: { key: 'research.paper.layout', version: 1 }, artifactSha256: 'b'.repeat(64),
  engine: { name: 'test-engine', version: '1.0.0', adapterVersion: '1.0.0',
    modelDigest: 'c'.repeat(64) }, languages: ['zh-Hans'],
  stages: [{ method: 'local-layout', pages: [1] }],
  components: [component('pdf-renderer', 'pdf-renderer'),
    component('layout-model', 'layout-model')], modelDigest: null,
  resources: { cpuCores: 1, memoryMiB: 512, diskMiB: 512, gpuMemoryMiB: 0 },
  limits: { maxPages: 10, maxPixelsPerPage: 10_000_000 } });

async function fixture(t, id, managerOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-engine-manager-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'runs');
  const { createPaperLayoutEngineProcessManager } = await import(executorUrl);
  const { createPaperLayoutEngineProcessRequest } = await import(contractUrl);
  const manager = createPaperLayoutEngineProcessManager({ rootDirectory: root,
    pollIntervalMs: 10, cancellationGraceMs: 500, ...managerOptions });
  const paths = manager.pathsFor(id), value = plan();
  const request = createPaperLayoutEngineProcessRequest({ requestId: id, plan: value,
    artifactSourcePath: path.join(directory, 'paper.pdf'),
    componentBindings: value.components.map(item => ({ ...item,
      localPath: path.join(directory, `${item.componentId}.bin`) })), output: {
      resultPath: paths.resultPath, progressPath: paths.progressPath,
      cancellationPath: paths.cancellationPath,
    },
    maxResultBytes: 1024 * 1024, maxProgressBytes: 64 * 1024 });
  const adapter = path.join(directory, 'adapter.mjs');
  await fs.writeFile(adapter, `
import fs from 'node:fs';
const request = JSON.parse(fs.readFileSync(process.argv.at(-1), 'utf8'));
const now = () => new Date().toISOString();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const progress = (sequence, phase, completedPages, currentPage) => ({
  schemaVersion: 'paper-layout-engine-process-progress-v1', requestId: request.requestId,
  sequence, phase, completedPages, totalPages: 1, currentPage, timestamp: now(),
});
const result = status => ({ schemaVersion: 'paper-layout-engine-process-result-v1',
  requestId: request.requestId, status,
  pages: status === 'succeeded' ? [{ page: 1, width: 1000, height: 1400,
    method: 'local-layout', blocks: [{ id: 'block-1', type: 'paragraph', text: '本地结果',
      bbox: { x: 10, y: 10, width: 100, height: 100 }, confidenceBp: 9000,
      readingOrder: 0 }] }] : [],
  diagnostics: { startedAt: new Date(Date.now() - 10).toISOString(), finishedAt: now(),
    pageCount: status === 'succeeded' ? 1 : 0, peakMemoryMiB: 20, cpuTimeMs: 10,
    warnings: [] }, error: status === 'cancelled'
      ? { code: 'ENGINE_CANCELLED', message: 'cancelled', retryable: false } : null,
});
const atomic = value => { const temporary = request.output.resultPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, request.output.resultPath); };
if (process.env.MODE === 'success') {
  fs.appendFileSync(request.output.progressPath, JSON.stringify(progress(1, 'rendering', 0, 1)) + '\\n');
  await delay(35);
  fs.appendFileSync(request.output.progressPath, JSON.stringify(progress(2, 'finalizing', 1, null)) + '\\n');
  atomic(result('succeeded')); console.log('adapter complete');
} else if (process.env.MODE === 'rewrite') {
  fs.writeFileSync(request.output.progressPath, JSON.stringify(progress(1, 'rendering', 0, 1)) + '\\n');
  await delay(80);
  fs.writeFileSync(request.output.progressPath, JSON.stringify(progress(2, 'layout', 0, 1)) + '\\n');
  await delay(200);
} else if (process.env.MODE === 'flood') {
  console.log('x'.repeat(4096)); await delay(200);
} else if (process.env.MODE === 'cancel') {
  while (!fs.existsSync(request.output.cancellationPath)) await delay(10);
  atomic(result('cancelled'));
} else if (process.env.MODE === 'timeout') {
  await new Promise(resolve => setInterval(resolve, 60_000));
} else if (process.env.MODE === 'invalid') {
  atomic({ ...result('succeeded'), unexpected: true });
}
`, 'utf8');
  return { manager, request, adapter };
}

const command = (adapter, mode) => ({ executable: process.execPath, arguments: [adapter],
  environment: { MODE: mode } });

test('process manager consumes append-only progress and one atomic validated result', async t => {
  const { manager, request, adapter } = await fixture(t, ids.success);
  const observed = [];
  const run = await manager.run({ request, command: command(adapter, 'success'),
    onProgress: value => observed.push(value.sequence) });
  assert.equal(run.result.status, 'succeeded');
  assert.deepEqual(run.progress.map(item => item.sequence), [1, 2]);
  assert.deepEqual(observed, [1, 2]);
  assert.match(run.diagnostics.stdout, /adapter complete/u);
  assert.equal(run.diagnostics.exitCode, 0);
  await run.cleanup();
  await assert.rejects(fs.stat(run.workspace), error => error.code === 'ENOENT');
});

test('process manager rejects rewritten progress instead of accepting a forged history', async t => {
  const { manager, request, adapter } = await fixture(t, ids.rewrite);
  await assert.rejects(manager.run({ request, command: command(adapter, 'rewrite') }),
    error => error.code === 'PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
});

test('process manager kills output flooding before it can consume unbounded memory', async t => {
  const { manager, request, adapter } = await fixture(t, ids.flood,
    { maxStdoutBytes: 1024 });
  await assert.rejects(manager.run({ request, command: command(adapter, 'flood') }),
    error => error.code === 'PAPER_LAYOUT_ENGINE_STDOUT_LIMIT_EXCEEDED');
});

test('process manager exposes cooperative cancellation through a local cancellation file', async t => {
  const { manager, request, adapter } = await fixture(t, ids.cancel);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const run = await manager.run({ request, command: command(adapter, 'cancel'),
    signal: controller.signal });
  assert.equal(run.result.status, 'cancelled');
  assert.equal(run.result.error.code, 'ENGINE_CANCELLED');
});

test('process manager terminates an uncooperative adapter on timeout', async t => {
  const { manager, request, adapter } = await fixture(t, ids.timeout);
  await assert.rejects(manager.run({ request, command: command(adapter, 'timeout'),
    timeoutMs: 120 }), error => error.code === 'PAPER_LAYOUT_ENGINE_PROCESS_TIMEOUT');
});

test('process manager validates the result contract after process completion', async t => {
  const { manager, request, adapter } = await fixture(t, ids.invalid);
  await assert.rejects(manager.run({ request, command: command(adapter, 'invalid') }),
    error => error.code === 'PAPER_LAYOUT_ENGINE_PROCESS_RESULT_INVALID');
});
