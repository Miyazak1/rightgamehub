const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root, 'apps/api/src/agent-paper-intake-security.mjs'));

test('R1.6 normalizes DOI identity without accepting unsafe locators', async () => {
  const { normalizeDoi } = await import(moduleUrl);
  assert.equal(normalizeDoi(' https://doi.org/10.1000/ABC.Def '), '10.1000/abc.def');
  assert.equal(normalizeDoi('doi:10.5555/12345678'), '10.5555/12345678');
  assert.throws(() => normalizeDoi('https://example.com/10.1000/nope'), /PAPER_DOI_INVALID/u);
  assert.throws(() => normalizeDoi('10.1000/a b'), /PAPER_DOI_INVALID/u);
});

test('R1.6 PDF gate checks magic, EOF, active content and byte hash before parsing', async () => {
  const { scanPrivatePaperPdf } = await import(moduleUrl);
  const safe = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
  const report = scanPrivatePaperPdf(safe);
  assert.equal(report.verdict, 'passed');
  assert.equal(report.sniffedMediaType, 'application/pdf');
  assert.match(report.sha256, /^[a-f0-9]{64}$/u);
  assert.throws(() => scanPrivatePaperPdf(Buffer.from('PK not a pdf %%EOF')), /PDF_MAGIC_INVALID/u);
  assert.throws(() => scanPrivatePaperPdf(Buffer.from('%PDF-1.7\n/JavaScript\n%%EOF')), /PDF_JAVASCRIPT/u);
  assert.throws(() => scanPrivatePaperPdf(Buffer.from('%PDF-1.7\nno trailer')), /PDF_EOF_MISSING/u);
});

test('R1.6 complex layout capability fails closed for scans and limits unsupported regions', async () => {
  const { buildPaperLayoutCapabilityReport } = await import(moduleUrl);
  const base = { policyVersion: 'paper-text-layer-gate-v1', parserVersion: 'fixture',
    permittedUses: ['analysis'], reasonCodes: [] };
  const mixed = buildPaperLayoutCapabilityReport({ qualityAssessment: { ...base, grade: 'limited-text' },
    pageSignals: [{ page: 1, scannedCandidate: false, multiColumn: true, tableRisk: true,
      formulaRisk: false, readingOrderRisk: false, imageCount: 0 }] });
  assert.equal(mixed.grade, 'mixed-limited');
  assert.equal(mixed.capabilities.tableSemantics, false);
  assert.equal(mixed.failClosed, true);
  const blocked = buildPaperLayoutCapabilityReport({ qualityAssessment: { ...base, grade: 'blocked', permittedUses: [] },
    pageSignals: [{ page: 1, scannedCandidate: true, multiColumn: false, tableRisk: false,
      formulaRisk: false, readingOrderRisk: false, imageCount: 1 }] });
  assert.equal(blocked.grade, 'blocked');
  assert.deepEqual(blocked.permittedUses, []);
});

test('R1.6 frozen private-intake layout corpus keeps capability decisions deterministic', async () => {
  const { buildPaperLayoutCapabilityReport } = await import(moduleUrl);
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-private-intake-eval-v1.json'), 'utf8'));
  assert.equal(corpus.schemaVersion, 'paper-private-intake-eval-v1');
  assert.equal(corpus.cases.length, 6);
  for (const fixture of corpus.cases) {
    const result = buildPaperLayoutCapabilityReport({
      qualityAssessment: { grade: fixture.qualityGrade, permittedUses: fixture.permittedUses },
      pageSignals: [{ page: 1, ...fixture.signal }],
    });
    assert.equal(result.grade, fixture.expectedGrade, fixture.id);
  }
});

test('R1.6 private intake routes and client methods remain admin-only and explicit', () => {
  const routes = fs.readFileSync(path.join(root, 'apps/api/src/agent-account-routes.mjs'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'packages/platform-api-client/src/index.mjs'), 'utf8');
  assert.match(routes, /\/v1\/admin\/agents\/:agentUserId\/paper-intakes\/doi/u);
  assert.match(routes, /\/v1\/admin\/agents\/:agentUserId\/paper-intakes\/pdf/u);
  assert.match(routes, /preHandler:requireAuth/u);
  assert.match(client, /uploadAdminAgentPaperPdf/u);
  assert.match(client, /Content-Type': 'application\/pdf/u);
  assert.match(client, /X-Paper-Rights/u);
});
