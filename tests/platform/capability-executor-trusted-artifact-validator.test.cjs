const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const apiUrl = pathToFileURL(path.join(root,
  'apps/capability-executor/src/index.mjs')).href;
const contract = { key: 'research.paper.layout', version: 1 };
const sha = 'a'.repeat(64);

async function tempRoot(prefix) {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
}

async function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  await fs.promises.writeFile(file, JSON.stringify(value), 'utf8');
  return file;
}

function decision() {
  return { schemaVersion: 'research-paper-layout-decision-v1', contract,
    artifactSha256: sha, route: 'mixed', textLayerPages: [1], localLayoutPages: [2],
    localOcrPages: [], reasonCodes: ['COMPLEX_LAYOUT_SIGNAL', 'TEXT_LAYER_SUFFICIENT'],
    limits: { maxPages: 500, maxBytes: 536870912, ocrPageLimit: 50 } };
}

function result() {
  return { schemaVersion: 'research-paper-layout-result-v1', contract,
    artifact: { sourceSha256: sha }, engine: {
      name: 'PP-StructureV3', version: '3.0.0', modelDigest: 'b'.repeat(64),
    }, pages: [{ page: 1, width: 1000, height: 1400, method: 'local-ocr', blocks: [{
      id: 'page-1-block-1', type: 'paragraph', text: '可信本地识别结果',
      bbox: { x: 100, y: 200, width: 7000, height: 800 }, confidenceBp: 9200,
      readingOrder: 0,
    }] }], quality: { coverageBp: 9800, minConfidenceBp: 9200,
      coordinateSystem: 'normalized-basis-points', grade: 'trusted', reasonCodes: [] } };
}

test('trusted artifact validator accepts an exact paper route decision and matching metadata',
  async t => {
    const api = await import(apiUrl), directory = await tempRoot('trusted-decision-');
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const sourcePath = await writeJson(directory, 'decision.json', decision());
    const validator = api.createTrustedCapabilityArtifactValidator();
    assert.deepEqual(await validator.validate({ sourcePath,
      mediaType: 'application/vnd.mooyu.paper-layout-decision+json', contract,
      metadata: { route: 'mixed', textLayerPages: 1, localLayoutPages: 1,
        localOcrPages: 0 } }), {
      kind: 'paper-layout-decision', schemaVersion: 'research-paper-layout-decision-v1',
    });
  });

test('trusted artifact validator rejects forged paper decisions and metadata before storage',
  async t => {
    const api = await import(apiUrl), directory = await tempRoot('trusted-forged-');
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const validator = api.createTrustedCapabilityArtifactValidator();
    const forged = decision();
    forged.localLayoutPages = [2, 2];
    const forgedPath = await writeJson(directory, 'forged.json', forged);
    await assert.rejects(validator.validate({ sourcePath: forgedPath,
      mediaType: 'application/vnd.mooyu.paper-layout-decision+json', contract,
      metadata: { route: 'mixed', textLayerPages: 1, localLayoutPages: 2,
        localOcrPages: 0 } }), error => error.code === 'CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID');

    const cleanPath = await writeJson(directory, 'clean.json', decision());
    await assert.rejects(validator.validate({ sourcePath: cleanPath,
      mediaType: 'application/vnd.mooyu.paper-layout-decision+json', contract,
      metadata: { route: 'local-layout', textLayerPages: 1, localLayoutPages: 1,
        localOcrPages: 0 } }), error => error.code === 'CAPABILITY_TRUSTED_ARTIFACT_METADATA_INVALID');
  });

test('trusted artifact validator accepts proven OCR output and rejects false quality claims',
  async t => {
    const api = await import(apiUrl), directory = await tempRoot('trusted-result-');
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const validator = api.createTrustedCapabilityArtifactValidator(), value = result();
    const sourcePath = await writeJson(directory, 'result.json', value);
    assert.deepEqual(await validator.validate({ sourcePath,
      mediaType: 'application/vnd.mooyu.paper-layout+json', contract,
      metadata: { grade: 'trusted', pageCount: 1, ocrPageCount: 1,
        engineName: 'PP-StructureV3' } }), {
      kind: 'paper-layout-result', schemaVersion: 'research-paper-layout-result-v1',
      grade: 'trusted',
    });

    value.quality.minConfidenceBp = 9999;
    const falseQualityPath = await writeJson(directory, 'false-quality.json', value);
    await assert.rejects(validator.validate({ sourcePath: falseQualityPath,
      mediaType: 'application/vnd.mooyu.paper-layout+json', contract,
      metadata: { grade: 'trusted', pageCount: 1, ocrPageCount: 1,
        engineName: 'PP-StructureV3' } }),
    error => error.code === 'CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID');
  });

test('trusted artifact validator fails closed for known-contract drift and ignores unknown contracts',
  async t => {
    const api = await import(apiUrl), directory = await tempRoot('trusted-contract-');
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const validator = api.createTrustedCapabilityArtifactValidator();
    const sourcePath = await writeJson(directory, 'decision.json', decision());
    assert.deepEqual(await validator.validate({ sourcePath: path.join(directory, 'missing.json'),
      mediaType: 'application/octet-stream', contract: { key: 'example.other', version: 1 },
      metadata: {} }), { kind: 'unregistered' });
    await assert.rejects(validator.validate({ sourcePath,
      mediaType: 'application/json', contract, metadata: {} }),
    error => error.code === 'CAPABILITY_TRUSTED_ARTIFACT_MEDIA_TYPE_INVALID');
    await assert.rejects(validator.validate({ sourcePath,
      mediaType: 'application/vnd.mooyu.paper-layout-decision+json',
      contract: { ...contract, version: 2 }, metadata: {} }),
    error => error.code === 'CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID');
  });
