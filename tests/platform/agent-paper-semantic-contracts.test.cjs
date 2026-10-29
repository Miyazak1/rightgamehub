const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-semantic-eval-v1.json'), 'utf8'));

test('paper semantic contract preserves claim kinds and binds every supported finding to evidence', async () => {
  const { validatePaperSemanticExtractionV1, verifyPaperSemanticExtraction } =
    await load('agent-paper-semantic-contracts.mjs');
  assert.deepEqual(validatePaperSemanticExtractionV1(fixture.extraction), fixture.extraction);
  const verified = verifyPaperSemanticExtraction({ extraction: fixture.extraction, evidence: fixture.evidence });
  assert.equal(verified.approved, true);
  assert.equal(verified.findings[0].relations[0].evidenceId, fixture.evidence[0].id);
  assert.equal(verified.findings[2].kind, 'xiaomoyu_inference');
  assert.equal(verified.findings[3].kind, 'unknown');
  assert.match(verified.analysisSha256, /^[a-f0-9]{64}$/);
});

test('paper semantic contract fails closed on invented evidence and unlabeled inference', async () => {
  const { verifyPaperSemanticExtraction, validatePaperSemanticExtractionV1 } =
    await load('agent-paper-semantic-contracts.mjs');
  const invented = structuredClone(fixture.extraction);
  invented.findings[0].evidenceIndexes = [96];
  invented.findings[0].relations = [{ evidenceIndex: 96, relation: 'supports' }];
  assert.throws(() => verifyPaperSemanticExtraction({ extraction: invented, evidence: fixture.evidence }),
    error => error.code === 'AGENT_PAPER_SEMANTIC_EVIDENCE_INDEX_INVALID');
  const unlabeled = structuredClone(fixture.extraction);
  unlabeled.findings[2].kind = 'inference';
  assert.throws(() => validatePaperSemanticExtractionV1(unlabeled),
    error => error.code === 'AGENT_PAPER_SEMANTIC_FINDING_INVALID');
});

test('follow-up answers either cite evidence or explicitly admit insufficiency', async () => {
  const { validatePaperSemanticFollowUpAnswerV1 } = await load('agent-paper-semantic-contracts.mjs');
  assert.equal(validatePaperSemanticFollowUpAnswerV1({
    schemaVersion: 'paper-semantic-follow-up-answer-v1', answer: '现有证据支持这一结论。',
    findingKeys: ['method-claim'], evidenceIndexes: [1], uncertainty: 'bounded',
  }).uncertainty, 'bounded');
  assert.throws(() => validatePaperSemanticFollowUpAnswerV1({
    schemaVersion: 'paper-semantic-follow-up-answer-v1', answer: '不知道。', findingKeys: [],
    evidenceIndexes: [1], uncertainty: 'insufficient-evidence',
  }), error => error.code === 'AGENT_PAPER_SEMANTIC_FOLLOW_UP_INVALID');
});
