const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');

test('R2 paper contracts freeze identity, version, layout and evidence without enabling acquisition', async () => {
  const module = await import(pathToFileURL(path.join(root, 'apps', 'api', 'src',
    'agent-paper-research-contracts.mjs')).href);
  const versionId = '11111111-1111-4111-8111-111111111111';
  const identity = { artifactType: 'academic-paper', canonicalId: 'doi:10.1000/example',
    identifiers: { doi: '10.1000/example', arxiv: null }, title: 'A test paper',
    authors: ['Author One'], year: 2026, venue: 'Example Conference', identityConfidence: 'confirmed' };
  const version = { artifactVersionId: versionId, identityCanonicalId: identity.canonicalId,
    versionKind: 'conference', sourceUrl: 'https://example.org/paper.pdf',
    fetchedAt: '2026-10-27T00:00:00.000Z', contentSha256: 'a'.repeat(64),
    accessLevel: 'fulltext-open', parentVersionId: null, versionRelation: 'initial' };
  const layout = { artifactVersionId: versionId, pageCount: 1, parserVersion: 'paper-layout-v1',
    pages: [{ page: 1, width: 612, height: 792, readingOrder: ['block-1'], blocks: [{
      id: 'block-1', kind: 'paragraph', bbox: [72, 110, 286, 320], text: 'Evidence text.',
      confidence: 0.99, extractionMethod: 'text-layer' }]}] };
  const quoteText = 'Evidence text.';
  const evidence = { artifactVersionId: versionId, locator: { kind: 'paper.layout', pages: [1],
    sectionPath: ['Introduction'], blockIds: ['block-1'], objectLabel: null }, quoteText,
    quoteHash: (await import(pathToFileURL(path.join(root, 'apps', 'api', 'src',
      'researcher-qa-protocol', 'stable-json.mjs')).href)).stableHash(quoteText),
    extractionMethod: 'text-layer', confidence: 0.99 };
  assert.deepEqual(module.validatePaperIdentityV1(identity), identity);
  assert.deepEqual(module.validatePaperVersionV1(version), version);
  assert.deepEqual(module.validatePaperLayoutManifestV1(layout), layout);
  assert.deepEqual(module.validatePaperEvidenceSpanV1(evidence), evidence);
  assert.equal(Object.keys(module.AGENT_PAPER_RESEARCH_RESPONSE_SCHEMAS).length, 4);
});

test('paper contracts fail closed for access, version lineage, reading order and evidence hash', async () => {
  const module = await import(pathToFileURL(path.join(root, 'apps', 'api', 'src',
    'agent-paper-research-contracts.mjs')).href);
  const versionId = '11111111-1111-4111-8111-111111111111';
  const version = { artifactVersionId: versionId, identityCanonicalId: 'doi:10.1000/example',
    versionKind: 'conference', sourceUrl: 'http://example.org/paper.pdf',
    fetchedAt: '2026-10-27T00:00:00.000Z', contentSha256: 'a'.repeat(64),
    accessLevel: 'fulltext-open', parentVersionId: null, versionRelation: 'initial' };
  assert.throws(() => module.validatePaperVersionV1(version), /AGENT_PAPER_VERSION_INVALID/u);
  const layout = { artifactVersionId: versionId, pageCount: 1, parserVersion: 'paper-layout-v1',
    pages: [{ page: 1, width: 612, height: 792, readingOrder: [], blocks: [{ id: 'block-1',
      kind: 'paragraph', bbox: [72, 110, 286, 320], text: 'Evidence text.', confidence: 0.99,
      extractionMethod: 'text-layer' }]}] };
  assert.throws(() => module.validatePaperLayoutManifestV1(layout),
    /AGENT_PAPER_LAYOUT_READING_ORDER_INVALID/u);
  assert.throws(() => module.validatePaperEvidenceSpanV1({ artifactVersionId: versionId,
    locator: { kind: 'paper.layout', pages: [1], sectionPath: [], blockIds: ['block-1'], objectLabel: null },
    quoteText: 'Evidence text.', quoteHash: 'b'.repeat(64), extractionMethod: 'text-layer', confidence: 1 }),
  /AGENT_PAPER_EVIDENCE_SPAN_INVALID/u);
});
