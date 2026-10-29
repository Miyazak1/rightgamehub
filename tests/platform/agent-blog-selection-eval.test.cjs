const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
  'agent-blog-selection-eval-v1.json'), 'utf8'));

test('selection gate matches the frozen R1 boundary evaluation set', async () => {
  assert.equal(fixture.schemaVersion, 'agent-blog-selection-eval-v1');
  assert.ok(fixture.cases.length >= 7);
  const module = await import(pathToFileURL(path.join(root, 'apps', 'api', 'src',
    'agent-blog-foundation-generation.mjs')).href);
  for (const item of fixture.cases) {
    const report = module.evaluateBlogCandidateGate([item.candidate], {
      previousRepositoryUrls: item.previousRepositoryUrls,
    });
    const decision = report.decisions[0];
    assert.equal(decision.accepted, item.expected.accepted, item.id);
    assert.deepEqual(decision.reasonCodes, item.expected.reasonCodes, item.id);
    assert.deepEqual(decision.restrictionCodes, item.expected.restrictionCodes, item.id);
    assert.deepEqual(decision.eligibleModes, item.expected.eligibleModes, item.id);
  }
});

test('selection v2 scoring and reason codes remain closed and auditable', async () => {
  const module = await import(pathToFileURL(path.join(root, 'apps', 'api', 'src',
    'agent-blog-foundation-generation.mjs')).href);
  const valid = {
    mode: 'single', selectedIndexes: [1], angle: '普通用户如何用本地知识工具整理收藏',
    rationale: '官方资料提供完整安装、使用场景与限制说明，证据足以形成可验证的中文介绍。',
    interestSignals: ['可以快速体验'], comparisonAxes: [],
    scores: { readerValue: 85, handsOnPotential: 90, novelty: 72, explainability: 88, evidenceStrength: 91 },
    decisionReasonCodes: ['EVIDENCE_STRONG', 'USE_CASE_CONCRETE', 'HANDS_ON_TESTABLE'],
  };
  assert.deepEqual(module.validateBlogFoundationSelectionResponse(valid), valid);
  assert.throws(() => module.validateBlogFoundationSelectionResponse({ ...valid,
    scores: { ...valid.scores, readerValue: 101 } }), /AGENT_BLOG_SELECTION_SCHEMA_INVALID/u);
  assert.throws(() => module.validateBlogFoundationSelectionResponse({ ...valid,
    decisionReasonCodes: ['FUN'] }), /AGENT_BLOG_SELECTION_SCHEMA_INVALID/u);
  assert.throws(() => module.evaluateBlogCandidateGate(Array.from({ length: 33 }, () => fixture.cases[0].candidate)),
    /AGENT_BLOG_CANDIDATE_GATE_INPUT_INVALID/u);
});
