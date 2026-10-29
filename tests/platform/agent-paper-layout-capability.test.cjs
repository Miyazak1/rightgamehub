const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root, 'packages/agent-capabilities/src/paper-layout.mjs')).href;
const packageContractsUrl = pathToFileURL(path.join(root,
  'apps/capability-executor/src/package-contracts.mjs')).href;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,
  'fixtures/paper-layout-admission-eval-v1.json'), 'utf8'));
const sha = 'a'.repeat(64);
const policy = overrides => ({ maxPages: 500, maxBytes: 512 * 1024 * 1024,
  ocrPageLimit: 50, allowOcr: true, allowLayout: true, ...overrides });
const input = item => ({ schemaVersion: 'research-paper-layout-input-v1',
  artifact: { sha256: sha, mimeType: 'application/pdf', ...item.artifact },
  pageSignals: item.pages, policy: policy({ ocrPageLimit: item.ocrPageLimit ?? 50 }) });

test('frozen paper layout admission routes only necessary pages to local OCR', async () => {
  const { decidePaperLayoutRoute } = await import(moduleUrl);
  assert.equal(fixture.schemaVersion, 'paper-layout-admission-eval-v1');
  assert.equal(fixture.cases.length, 6);
  for (const item of fixture.cases) {
    const decision = decidePaperLayoutRoute(input(item));
    assert.equal(decision.route, item.expected.route, item.id);
    assert.deepEqual(decision.textLayerPages, item.expected.text, item.id);
    assert.deepEqual(decision.localLayoutPages, item.expected.layout, item.id);
    assert.deepEqual(decision.localOcrPages, item.expected.ocr, item.id);
  }
  const clean = decidePaperLayoutRoute(input(fixture.cases[0]));
  assert.throws(() => decidePaperLayoutRoute({ ...input(fixture.cases[0]),
    pageSignals: input(fixture.cases[0]).pageSignals.slice(0, 1) }), /PAPER_LAYOUT_PAGE_SIGNAL_INVALID/u);
  const { validatePaperLayoutDecisionV1 } = await import(moduleUrl);
  assert.throws(() => validatePaperLayoutDecisionV1({ ...clean, route: 'local-ocr' }),
    /PAPER_LAYOUT_DECISION_INVALID/u);
});

test('paper layout contracts reject forged fields and unproven OCR output', async () => {
  const { decidePaperLayoutRoute, validatePaperLayoutInputV1,
    validatePaperLayoutResultV1 } = await import(moduleUrl);
  const clean = input(fixture.cases[0]);
  assert.throws(() => validatePaperLayoutInputV1({ ...clean, cloudUpload: true }),
    /PAPER_LAYOUT_INPUT_INVALID/u);
  const scannedDecision = decidePaperLayoutRoute(input(fixture.cases[1]));
  const result = { schemaVersion: 'research-paper-layout-result-v1',
    contract: { key: 'research.paper.layout', version: 1 }, artifact: { sourceSha256: sha },
    engine: { name: 'fixture-engine', version: '1', modelDigest: null },
    pages: scannedDecision.localOcrPages.map(page => ({ page, width: 1000, height: 1400,
      method: 'local-ocr', blocks: [{ id: `p${page}-b1`, type: 'paragraph', text: '证据文本',
        bbox: { x: 100, y: 100, width: 8000, height: 500 }, confidenceBp: 9000,
        readingOrder: 0 }] })), quality: { coverageBp: 10000, minConfidenceBp: 9000,
      coordinateSystem: 'normalized-basis-points', grade: 'trusted', reasonCodes: [] } };
  assert.throws(() => validatePaperLayoutResultV1(result, { decision: scannedDecision }),
    /PAPER_LAYOUT_OCR_PROVENANCE_REQUIRED/u);
  result.engine.modelDigest = 'b'.repeat(64);
  assert.equal(validatePaperLayoutResultV1(result, { decision: scannedDecision }).pages.length, 2);
  assert.throws(() => validatePaperLayoutResultV1({ ...result,
    quality: { ...result.quality, minConfidenceBp: 9999 } }, { decision: scannedDecision }),
  /PAPER_LAYOUT_QUALITY_INVALID/u);
  result.pages[0].blocks[0].bbox.width = 10000;
  assert.throws(() => validatePaperLayoutResultV1(result, { decision: scannedDecision }),
    /PAPER_LAYOUT_BLOCK_INVALID/u);
});

test('paper layout execution manifest is desktop-only, offline and never uploads', async () => {
  const { createPaperLayoutExecutionManifest } = await import(moduleUrl);
  const manifest = createPaperLayoutExecutionManifest({ packageRelease: {
    url: 'https://downloads.mooyu.fun/capabilities/paper-layout-1.0.0.zip', sha256: sha,
    signature: 'c'.repeat(64), keyId: 'mooyu-capability-release', sizeBytes: 1234,
  } });
  assert.deepEqual(manifest.selectionPolicy.preference, ['desktop']);
  assert.equal(manifest.selectionPolicy.cloudFallback, 'never');
  assert.deepEqual(manifest.placements[0].permissions.networkDomains, []);
  assert.deepEqual(manifest.placements[0].dataPolicy, { localOnly: true, upload: 'never' });
  assert.equal(manifest.placements[0].offline, true);
});

test('reference capability package is self-contained, normalized and runnable', async t => {
  if (process.platform !== 'win32') return t.skip('Windows package includes the current node.exe runtime');
  const output = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'paper-layout-package-')), 'package');
  t.after(() => fs.promises.rm(path.dirname(output), { recursive: true, force: true }));
  const build = spawnSync(process.execPath, [path.join(root, 'scripts/build-paper-layout-capability-package.mjs'),
    '--output', output], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const manifest = JSON.parse(await fs.promises.readFile(path.join(output, 'capability.json'), 'utf8'));
  const { normalizePackageManifest } = await import(packageContractsUrl);
  assert.equal(normalizePackageManifest(manifest).contract.key, 'research.paper.layout');

  const pdf = path.join(output, 'fixture.pdf'), pdfBytes = Buffer.from('%PDF-1.7\nfixture');
  await fs.promises.writeFile(pdf, pdfBytes);
  const runRoot = path.join(output, 'run'), out = path.join(runRoot, 'output');
  await fs.promises.mkdir(out, { recursive: true });
  const request = { schemaVersion: 'capability-native-request-v1', runId: crypto.randomUUID(),
    contract: { key: 'research.paper.layout', version: 1 }, input: {
      schemaVersion: 'research-paper-layout-input-v1', artifact: {
        sha256: crypto.createHash('sha256').update(pdfBytes).digest('hex'), mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length, pageCount: 1 }, pageSignals: [{ page: 1, textChars: 500,
        replacementChars: 0, positionedGlyphs: 480, imageCoverageBp: 0, multiColumn: false,
        tableRisk: false, formulaRisk: false }], policy: policy() }, prerequisites: [],
    fileGrants: [{ grantId: crypto.randomUUID(), scope: 'user-selected', sourcePath: pdf,
      access: 'read', displayName: 'fixture.pdf' }] };
  const requestFile = path.join(runRoot, 'request.json'), resultFile = path.join(runRoot, 'result.json');
  await fs.promises.writeFile(requestFile, JSON.stringify(request));
  const worker = spawnSync(path.join(output, 'bin/node.exe'), [path.join(output, 'app/worker.mjs')], {
    encoding: 'utf8', cwd: runRoot, env: { ...process.env, MOOYU_CAPABILITY_REQUEST: requestFile,
      MOOYU_CAPABILITY_RESULT: resultFile, MOOYU_CAPABILITY_OUTPUT_DIR: out },
  });
  assert.equal(worker.status, 0, worker.stderr);
  const nativeResult = JSON.parse(await fs.promises.readFile(resultFile, 'utf8'));
  assert.equal(nativeResult.artifact.metadata.route, 'text-layer');
  const decision = JSON.parse(await fs.promises.readFile(path.join(out,
    nativeResult.artifact.path), 'utf8'));
  assert.deepEqual(decision.textLayerPages, [1]);
});
