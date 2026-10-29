const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root,
  'apps/api/src/agent-paper-article-acceptance.mjs'));
const ids = {
  agent: '11111111-1111-4111-8111-111111111111', request: '22222222-2222-4222-8222-222222222222',
  analyses: ['31111111-1111-4111-8111-111111111111', '32222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'],
  versions: ['41111111-1111-4111-8111-111111111111', '42222222-2222-4222-8222-222222222222',
    '43333333-3333-4333-8333-333333333333'],
  identities: ['51111111-1111-4111-8111-111111111111', '52222222-2222-4222-8222-222222222222',
    '53333333-3333-4333-8333-333333333333'],
  runs: ['61111111-1111-4111-8111-111111111111', '62222222-2222-4222-8222-222222222222',
    '63333333-3333-4333-8333-333333333333'],
  articles: ['71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222',
    '73333333-3333-4333-8333-333333333333'],
};

function source(index) {
  return { analysisId: ids.analyses[index], paperVersionId: ids.versions[index],
    paperIdentityId: ids.identities[index], canonicalId: `arxiv:2401.0000${index + 1}`,
    arxivId: `2401.0000${index + 1}`, sourceUrl: `https://arxiv.org/pdf/2401.0000${index + 1}`,
    accessLevel: 'fulltext-open', analysisRunId: `81111111-1111-4111-8111-11111111111${index + 1}`,
    analysisRunStatus: 'succeeded', researchExecutionId: `91111111-1111-4111-8111-11111111111${index + 1}`,
    researchExecutionStatus: 'succeeded', executionAccessLevel: 'fulltext-open',
    queueState: 'completed', sourceKind: 'arxiv', discoveryStatus: 'completed',
    reliabilityGrade: 'trusted-text', permittedUses: ['analysis', 'citation', 'comparison'],
    parseReasonCodes: [], pageCount: 12 + index, findingCount: 5,
    evidenceLinkCount: 8, pageEvidenceCount: 5 };
}

function sample(index) {
  return { ...source(index), draftRunId: ids.runs[index], draftWorkflowKey: 'paper.article.draft-shadow',
    draftWorkflowVersion: 1, draftStatus: 'succeeded', outputType: 'blog.private-draft',
    outputId: ids.articles[index], articleId: ids.articles[index], publicationState: 'draft',
    revisionState: 'working', publishedRevisionId: null, publicationReceiptExists: false,
    publishEvents: 0, publishActions: 0, stageCount: 5, nonSucceededStages: 0,
    stageRetries: 0, nonSucceededActions: 0, toolCalls: 1, failedOrUncertainToolCalls: 0,
    providerCalls: 1, failedOrUncertainProviderCalls: 0, sourceArtifactCount: 1,
    analysisSelectionMatches: true, paperVersionSelectionMatches: true,
    verificationApproved: true, compositionHashMatches: true, verificationHashMatches: true,
    citationCount: 1, citationUrlMatches: true, citationHasPageLocator: true,
    everyFactualBlockCited: true };
}

function snapshot() {
  return { schemaVersion: 'agent-paper-article-acceptance-evidence-v1',
    agentUserId: ids.agent, requestId: ids.request, samples: [0, 1, 2].map(sample) };
}

test('R2.3 accepts only three distinct real open-paper private-draft lineages', async () => {
  const { evaluateAgentPaperArticleAcceptance } = await import(moduleUrl.href);
  const result = evaluateAgentPaperArticleAcceptance(snapshot());
  assert.equal(result.verdict, 'passed');
  assert.deepEqual(result.reasonCodes, []);
  assert.deepEqual(result.metrics, { samples: 3, pages: 39, findings: 15,
    evidenceLinks: 24, providerCalls: 3, toolCalls: 3 });
  assert.match(result.reportSha256, /^[a-f0-9]{64}$/u);
});

test('R2.3 fails closed on duplicate papers, weak parsing, missing citation and publication', async () => {
  const { evaluateAgentPaperArticleAcceptance } = await import(moduleUrl.href);
  const evidence = snapshot();
  evidence.samples[1].paperIdentityId = evidence.samples[0].paperIdentityId;
  evidence.samples[1].reliabilityGrade = 'limited-text';
  evidence.samples[2].everyFactualBlockCited = false;
  evidence.samples[2].publicationState = 'published';
  evidence.samples[2].publicationReceiptExists = true;
  const result = evaluateAgentPaperArticleAcceptance(evidence);
  assert.equal(result.verdict, 'failed');
  assert.deepEqual(result.reasonCodes, ['PAPER_DUPLICATED', 'PARSE_QUALITY_NOT_TRUSTED',
    'PUBLICATION_AUTHORITY_OBSERVED', 'CITATION_COVERAGE_INVALID']);
});

test('acceptance service prechecks all sources, creates exactly three drafts and never schedules or publishes', async () => {
  const { createAgentPaperArticleAcceptanceService } = await import(moduleUrl.href);
  const calls = [];
  const sources = [0, 1, 2].map(source);
  const repository = {
    async inspectSources(agentUserId, analysisIds) {
      assert.equal(agentUserId, ids.agent); assert.deepEqual(analysisIds, ids.analyses); return sources;
    },
    async snapshot({ results }) {
      assert.equal(results.length, 3); return snapshot();
    },
    async persist({ evaluation }) {
      return { id: 'report-1', verdict: evaluation.verdict, reasonCodes: evaluation.reasonCodes,
        existing: false };
    },
  };
  const paperArticleRunner = { async run(input) {
    calls.push(input);
    const index = ids.analyses.indexOf(input.analysisId);
    return { analysisId: input.analysisId, runId: ids.runs[index], articleId: ids.articles[index] };
  } };
  const result = await createAgentPaperArticleAcceptanceService({ repository, paperArticleRunner })
    .run({ agentUserId: ids.agent, analysisIds: ids.analyses, requestId: ids.request });
  assert.equal(result.verdict, 'passed');
  assert.equal(result.publicationAttempted, false);
  assert.equal(result.automaticScheduleChange, false);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map(call => call.requestId)).size, 3);
});

test('acceptance service rejects an invalid source triplet before any model call', async () => {
  const { createAgentPaperArticleAcceptanceService } = await import(moduleUrl.href);
  const sources = [0, 1, 2].map(source);
  sources[2].paperIdentityId = sources[0].paperIdentityId;
  let calls = 0;
  const service = createAgentPaperArticleAcceptanceService({
    repository: { async inspectSources() { return sources; } },
    paperArticleRunner: { async run() { calls += 1; } },
  });
  await assert.rejects(service.run({ agentUserId: ids.agent, analysisIds: ids.analyses,
    requestId: ids.request }), /AGENT_PAPER_ARTICLE_ACCEPTANCE_SOURCE_REJECTED/u);
  assert.equal(calls, 0);
});

test('production wiring exposes a one-shot acceptance profile and immutable receipt migration', () => {
  const compose = fs.readFileSync(path.join(root, 'deploy/compose.prod.yml'), 'utf8');
  const ops = fs.readFileSync(path.join(root, 'deploy/agent-blog-public-ops.sh'), 'utf8');
  const migration = fs.readFileSync(path.join(root,
    'apps/api/migrations/0158_agent_paper_article_acceptance.sql'), 'utf8');
  assert.match(compose, /agent-paper-article-acceptance:/u);
  assert.match(compose, /agent-paper-article-acceptance-cli\.mjs/u);
  assert.match(ops, /paper-accept\)/u);
  assert.match(migration, /cardinality\(analysis_ids\)=3/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
});
