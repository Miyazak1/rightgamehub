const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/agent-runtime-read-service.mjs'));

test('runtime overview exposes canary readiness without enabling scheduling', async () => {
  const { createAgentRuntimeReadService } = await import(moduleUrl.href);
  const operatorId = crypto.randomUUID(), agentUserId = crypto.randomUUID();
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT user_id FROM agent_accounts/u.test(sql)) return { rows: [{ user_id: agentUserId }] };
    if (/agent_blog_canary_acceptance_reports/u.test(sql)) return { rows: [
      { verdict: 'passed', reason_codes: [], created_at: new Date('2026-10-26T02:00:00Z') },
      { verdict: 'passed', reason_codes: [], created_at: new Date('2026-10-25T02:00:00Z') },
      { verdict: 'failed', reason_codes: ['STAGE_RETRY_OBSERVED'], created_at: new Date('2026-10-24T02:00:00Z') },
    ] };
    if (/FROM agent_schedules/u.test(sql)) return { rows: [] };
    if (/WITH assessments AS/u.test(sql)) return { rows: [{ total: 3, trusted: 1, limited: 1,
      blocked: 1, semantic_total: 1, latest: { paperVersionId: crypto.randomUUID(), title: 'A bounded paper',
        grade: 'limited-text', reasonCodes: ['TABLE_STRUCTURE_UNSUPPORTED'],
        metrics: { pageCount: 8, textCoverageBp: 10000, evidenceCoverageBp: 10000 },
        parserVersion: 'pdfjs-test', policyVersion: 'paper-text-layer-gate-v1',
        assessmentSha256: 'a'.repeat(64), createdAt: '2026-10-26T03:00:00.000Z' },
      latest_semantic: { id: crypto.randomUUID(), paperVersionId: crypto.randomUUID(),
        runId: crypto.randomUUID(), title: 'A bounded paper', provider: 'deepseek',
        modelId: 'deepseek-flash', policyVersion: 'paper-semantic-evidence-gate-v1',
        promptVersion: 'paper-semantic-reader-v1', findingCount: 4, limitationCount: 1,
        followUpQuestionCount: 3, analysisSha256: 'b'.repeat(64),
        createdAt: '2026-10-26T04:00:00.000Z' } }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const service = createAgentRuntimeReadService({ pool,
    authorizeOperator: async actor => actor.userId === operatorId });
  const overview = await service.blogOverview({ userId: operatorId }, agentUserId);
  assert.equal(overview.schemaVersion, 'agent-blog-foundation-overview-v1');
  assert.equal(overview.acceptance.policyVersion, 2);
  assert.equal(overview.acceptance.consecutivePasses, 2);
  assert.equal(overview.acceptance.requiredConsecutivePasses, 3);
  assert.equal(overview.acceptance.readyForShadowScheduleReview, false);
  assert.equal(overview.acceptance.automaticScheduleChange, false);
  assert.equal(overview.schedule, null);
  assert.deepEqual(overview.paperResearch.counts, { total: 3, trusted: 1, limited: 1, blocked: 1 });
  assert.equal(overview.paperResearch.latest.grade, 'limited-text');
  assert.equal(overview.paperResearch.semantic.total, 1);
  assert.equal(overview.paperResearch.semantic.latest.findingCount, 4);
  assert.equal(overview.paperResearch.publicPublicationEnabled, false);
  assert.equal(calls[1].params[2], 3);
});

test('foundation draft preview is operator-scoped and read-only', async () => {
  const { createAgentRuntimeReadService } = await import(moduleUrl.href);
  const operatorId = crypto.randomUUID(), agentUserId = crypto.randomUUID(), articleId = crypto.randomUUID();
  const pool = { query: async (sql, params) => {
    if (/SELECT user_id FROM agent_accounts/u.test(sql)) {
      assert.deepEqual(params, [agentUserId, operatorId]);
      return { rows: [{ user_id: agentUserId }] };
    }
    if (/FROM agent_blog_foundation_drafts draft/u.test(sql)) {
      assert.deepEqual(params, [agentUserId, articleId]);
      assert.match(sql, /article\.author_user_id=draft\.agent_user_id/u);
      return { rows: [{ run_id: crypto.randomUUID(), article_id: articleId, revision_id: crypto.randomUUID(),
        content_sha256: 'a'.repeat(64), created_at: new Date('2026-10-26T07:26:52Z'),
        slug: 'agent-private-draft', locale: 'zh-CN', publication_state: 'draft',
        title: '一篇只读草稿', summary: '这是一篇只允许所属机器人运营者查看的私有草稿摘要。',
        blocks: [{ type: 'paragraph', text: '草稿正文。' }], citations: [{ id: crypto.randomUUID() }],
        content_hash: 'b'.repeat(64), citation_count: 1, bound_citation_count: 1,
        evidence_span_count: 3, source_version_count: 1 }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const service = createAgentRuntimeReadService({ pool,
    authorizeOperator: async actor => actor.userId === operatorId });
  const draft = await service.foundationDraft({ userId: operatorId }, agentUserId, articleId);
  assert.equal(draft.schemaVersion, 'agent-blog-foundation-draft-preview-v1');
  assert.equal(draft.readOnly, true);
  assert.equal(draft.articleId, articleId);
  assert.equal(draft.publicationState, 'draft');
  assert.deepEqual(draft.blocks, [{ type: 'paragraph', text: '草稿正文。' }]);
  assert.deepEqual(draft.researchEvidence, { citationCount: 1, boundCitationCount: 1,
    evidenceSpanCount: 3, sourceVersionCount: 1, complete: true });
});

test('runtime timeline exposes the bounded selection gate audit payload', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../apps/api/src/agent-runtime-read-service.mjs'), 'utf8');
  assert.match(source, /CASE WHEN artifact_key='blog\.selection' THEN content_json ELSE NULL END AS audit_content/u);
  assert.match(source, /rawCandidateGate = selectionArtifact\?\.audit_content\?\.gateReport/u);
  assert.match(source, /selectionDecision = rawSelection/u);
  assert.match(source, /usageSummary =/u);
  assert.match(source, /charged_cost_microusd/u);
  assert.match(source, /availableAt: iso\(row\.available_at\)/u);
  assert.match(source, /paperQualityAssessments/u);
  assert.match(source, /agent_paper_parse_assessments/u);
  assert.match(source, /paperSemanticAnalyses/u);
  assert.match(source, /agent_paper_semantic_analyses/u);
});
