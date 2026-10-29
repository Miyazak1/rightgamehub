const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const id = () => crypto.randomUUID();

test('paper analysis tool is bounded, local and agent-scoped', async () => {
  const { PAPER_ANALYSIS_READ_TOOL, createPaperAnalysisReadAdapter,
    validatePaperAnalysisReadInput } = await load('agent-paper-analysis-tool.mjs');
  const agentUserId = id(), analysisId = id(), paperVersionId = id();
  let request;
  const output = { schemaVersion: 'paper-article-evidence-v1', analysisId,
    analysisSha256: 'a'.repeat(64), paperVersionId,
    paper: { title: 'Verified paper', authors: ['Author'], year: 2026, venue: 'arXiv',
      sourceUrl: 'https://arxiv.org/pdf/2601.12345v1.pdf' },
    findings: [{ key: 'result', text: '受控实验报告了可观察结果。',
      relations: [{ evidenceId: id(), evidenceIndex: 1, relation: 'supports' }] }],
    limitations: [], followUpQuestions: ['问题一？', '问题二？', '问题三？'], evidence: [],
    accessedAt: '2026-10-29T02:00:00.000Z' };
  output.evidence.push({ index: 1, id: output.findings[0].relations[0].evidenceId,
    quoteText: '受控实验报告了可观察结果。',
    quoteHash: crypto.createHash('sha256').update(JSON.stringify('受控实验报告了可观察结果。')).digest('hex'),
    evidenceKind: 'paper-text', locator: { pages: [7] }, allowedUses: ['analysis', 'citation'] });
  const adapter = createPaperAnalysisReadAdapter({ agentUserId,
    repository: { loadArticleEvidence: async value => { request = value; return output; } },
    clock: () => '2026-10-29T02:00:00.000Z' });
  const receipt = await adapter({ request: { analysisId } });
  assert.equal(PAPER_ANALYSIS_READ_TOOL.executionClass, 'in-process');
  assert.equal(PAPER_ANALYSIS_READ_TOOL.effectClass, 'read-only');
  assert.deepEqual(PAPER_ANALYSIS_READ_TOOL.networkPolicy.allowedOrigins, []);
  assert.deepEqual(request, { agentUserId, analysisId, accessedAt: '2026-10-29T02:00:00.000Z' });
  assert.equal(receipt.output.evidence[0].locator.pages[0], 7);
  assert.equal(receipt.usage.networkRequests, 0);
  assert.throws(() => validatePaperAnalysisReadInput({ analysisId, extra: true }),
    error => error.code === 'AGENT_PAPER_ANALYSIS_TOOL_INPUT_INVALID');
});
