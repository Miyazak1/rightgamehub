'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runtimeDirectory, verifyArchive, verifyRuntime } = require('./install.cjs');
const runtime = require('./runtime.cjs');
const cone = require('./examples/cone.json');
const load = file => require(path.join(runtimeDirectory, 'src', file));

test('frozen archive, installed files and both upstream bundle gates agree', () => {
  verifyArchive(); assert.equal(verifyRuntime().version, '1.43.0');
  for (const script of ['verify-bundle.cjs', 'verify-capacity-bundle.cjs']) {
    const result = spawnSync(process.execPath, [path.join(runtimeDirectory, 'scripts', script)], { cwd: runtimeDirectory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); process.stdout.write(result.stdout);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moodlelike-math-lab-manifest-'));
  try {
    fs.writeFileSync(path.join(directory, 'RELEASE-FILES.sha256'), '0'.repeat(64) + ' src/meaning/solid.cjs\n');
    assert.throws(() => verifyRuntime(directory), /release_manifest_digest_mismatch/);
  } finally { fs.unlinkSync(path.join(directory, 'RELEASE-FILES.sha256')); fs.rmdirSync(directory); }
});

test('catalog binds all 36 cells and 141 exact scopes; API rejects arbitrary task overrides', () => {
  const { cells } = runtime.catalog();
  assert.equal(cells.length, 36); assert.equal(cells.reduce((sum, cell) => sum + cell.scopes.length, 0), 141);
  assert.equal(new Set(cells.map(cell => cell.topicCode)).size, 12);
  const scopes = cells.flatMap(cell => cell.scopes);
  assert.equal(scopes.filter(scope => scope.samplingMode === 'finite-stock-index').length, 60);
  assert.equal(scopes.filter(scope => scope.samplingMode === 'parameter-seed').length, 81);
  assert.ok(scopes.filter(scope => scope.samplingMode === 'parameter-seed').every(scope => scope.capacity === 0));
  assert.deepEqual(runtime.validateInput(cone), cone);
  for (const input of [{ ...cone, seed: -1 }, { ...cone, seed: 1.5 }, { ...cone, cellId: 'M-SET-001:basic' }, { ...cone, admissionVersion: null }, { ...cone, samplingVersion: 'legacy' }, { ...cone, seed: '1911' }]) {
    assert.throws(() => runtime.validateInput(input), /invalid/);
  }
});

test('real cone: exact answer, independent Oracle, typed facts, beforeStore and zero Provider', async () => {
  const preview = await runtime.generatePreview(cone);
  const r = preview.result;
  assert.equal(r.passed, true, r.reason); assert.equal(r.admission.status, 'eligible_before_history');
  assert.equal(r.admission.studentCalibrated, false); assert.equal(r.gate.productionReleaseEligible, false);
  assert.equal(r.gate.checks.solver, true); assert.equal(r.gate.checks.oracle, true);
  assert.equal(r.candidate.options.find(option => option.id === r.candidate.correctAnswer).text, '1527/200π cm^2');
  assert.equal(r.questionArtifact.nativeTypedGeneration, true);
  assert.equal(r.questionArtifact.scopeId, cone.scopeId);
  assert.deepEqual([preview.providerCalls, preview.costUsd, preview.databaseReads, preview.databaseWrites], [0, 0, 0, 0]);
  assert.equal(preview.studentPublicationAllowed, false);
  assert.deepEqual(Object.keys(preview.presentation).sort(), ['localizations', 'options', 'prompt']);
  assert.deepEqual(Object.keys(preview.presentation.localizations.zh).sort(), ['options', 'prompt']);
  for (const forbidden of ['correctAnswer', 'explanation', 'originalPrompts', 'generationSource', 'answerBinding', 'facts']) {
    assert.equal(JSON.stringify(preview.presentation).includes('"' + forbidden + '"'), false);
  }
  assert.equal(preview.presentation.prompt, r.candidate.prompt);
  const config = load('config.cjs').batchConfig({ cells: [cone.cellId], scopes: { [cone.cellId]: [cone.scopeId] }, count: 1, seed: cone.seed }, 1);
  const claim = { cell_id: cone.cellId, scope_id: cone.scopeId, seed: cone.seed, config };
  const tampered = structuredClone(r); tampered.questionArtifact.facts[0].predicate += '_tampered';
  assert.throws(() => load('admission-boundary.cjs').beforeStore(claim, tampered), /question_artifact_mismatch/);
  const badOracle = structuredClone(r); badOracle.gate.checks.oracle = false;
  const rejected = load('admission-boundary.cjs').beforeStore(claim, badOracle);
  assert.equal(rejected.passed, false); assert.equal(rejected.admission.status, 'rejected');
  const badHint = structuredClone(r); badHint.questionArtifact.hintHash = '0'.repeat(64);
  assert.throws(() => load('admission-boundary.cjs').beforeStore(claim, badHint), /question_artifact_mismatch/);
});

test('basic and medium previews use the same frozen admission path', async () => {
  const cells = runtime.catalog().cells;
  for (const id of ['M-SET-001:basic', 'M-GEO-002:medium']) {
    const cell = cells.find(item => item.id === id);
    const preview = await runtime.generatePreview({ cellId: id, scopeId: cell.scopes[0].id, seed: 0 });
    assert.equal(preview.result.passed, true, preview.result.reason);
    assert.equal(preview.result.admission.status, 'eligible_before_history');
  }
});
