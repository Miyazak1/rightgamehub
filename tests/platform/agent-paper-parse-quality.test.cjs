const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root, 'apps/api/src/agent-paper-parse-quality.mjs'));
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname,
  'fixtures/paper-layout-quality-eval-v1.json'), 'utf8'));

test('frozen paper layout quality corpus produces deterministic reliability grades', async () => {
  const { analyzePaperTextLayerPage, assessPaperParseQuality } = await import(moduleUrl);
  assert.equal(corpus.schemaVersion, 'paper-layout-quality-eval-v1');
  assert.equal(corpus.cases.length, 6);
  for (const fixture of corpus.cases) {
    const pageSignals = fixture.pages.map(page => analyzePaperTextLayerPage({
      ...page,
      items: page.items.map(item => ({ str: item.str, width: item.width,
        transform: [1, 0, 0, 1, item.x, item.y] })),
    }));
    const result = assessPaperParseQuality({ parserVersion: 'fixture-parser-v1', pageSignals,
      evidencePages: fixture.evidencePages });
    assert.equal(result.grade, fixture.expectedGrade, fixture.id);
  }
});

test('quality assessment freezes uses and rejects forged upgrades', async () => {
  const { assessPaperParseQuality, validatePaperParseQualityV1 } = await import(moduleUrl);
  const trusted = assessPaperParseQuality({ parserVersion: 'fixture-parser-v1',
    pageSignals: [{ page: 1, charCount: 120, hasText: true, scannedCandidate: false,
      lowDensity: false, readingOrderRisk: false, multiColumn: false, tableRisk: false,
      formulaRisk: false, imageCount: 0 }], evidencePages: [1] });
  assert.deepEqual(trusted.permittedUses, ['analysis', 'citation', 'comparison']);
  assert.throws(() => validatePaperParseQualityV1({ ...trusted, grade: 'trusted-text',
    reasonCodes: ['IMAGE_CONTENT_UNREAD'] }), /AGENT_PAPER_PARSE_QUALITY_INVALID/u);
  const blocked = assessPaperParseQuality({ parserVersion: 'fixture-parser-v1',
    pageSignals: [{ page: 1, charCount: 120, hasText: true, scannedCandidate: false,
      lowDensity: false, readingOrderRisk: false, multiColumn: false, tableRisk: false,
      formulaRisk: false, imageCount: 0 }, { page: 2, charCount: 0, hasText: false,
      scannedCandidate: true, lowDensity: false, readingOrderRisk: false, multiColumn: false,
      tableRisk: false, formulaRisk: false, imageCount: 1 }], evidencePages: [1] });
  assert.equal(blocked.grade, 'blocked');
  assert.deepEqual(blocked.permittedUses, []);
});
