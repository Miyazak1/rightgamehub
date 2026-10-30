const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-text-draft-eval-v1.json'), 'utf8'));
const provider = require('./support/paper-text-draft.cjs');

test('real Transformer PDF remains limited while only two narrative chunks enter private draft scope', async () => {
  const { selectTextOnlyDraftEvidence, validateTextOnlyDraftScope } = await load('agent-paper-text-draft.mjs');
  const before = structuredClone(fixture);
  const result = selectTextOnlyDraftEvidence(fixture.evidence, fixture.paper);
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  assert.equal(fixture.sourceSha256, 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697');
  assert.equal(stableHash(fixture.layoutManifest), fixture.paper.layout_sha256);
  assert.deepEqual(result.evidence.map(e => e.locator.blockIds[0]), fixture.expectedBlockIds);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.readingScope.originalGrade, 'limited-text');
  assert.equal(result.readingScope.publicPublicationEnabled, false);
  assert.equal(result.readingScope.manualReviewRequired, true);
  assert.deepEqual(result.evidence.map(e => e.allowedUses), [['analysis'], ['analysis']]);
  validateTextOnlyDraftScope(result.readingScope, result.evidence);
  assert.deepEqual(fixture, before);
});

test('missing pages, scans, order errors, blocked quality and sparse evidence remain blocked', async () => {
  const { selectTextOnlyDraftEvidence } = await load('agent-paper-text-draft.mjs');
  for (const changes of [{ reliability_grade: 'blocked' }, { reason_codes: ['READING_ORDER_UNCERTAIN'] },
    ...['emptyPageCount', 'scannedPageCount', 'orderRiskPageCount', 'lowDensityPageCount'].map(key =>
      ({ metrics_json: { ...fixture.paper.metrics_json, [key]: 1 } })),
    { metrics_json: { ...fixture.paper.metrics_json, textCoverageBp: 9000 } },
    { metrics_json: { ...fixture.paper.metrics_json, evidenceCoverageBp: 9000 } }]) {
    assert.throws(() => selectTextOnlyDraftEvidence(fixture.evidence, { ...fixture.paper, ...changes }),
      { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  }
  assert.throws(() => selectTextOnlyDraftEvidence(fixture.evidence.slice(0, 1), fixture.paper));
});

test('eight real PDF assessments with reading-order risks remain blocked even with usable narrative chunks', async () => {
  const { selectTextOnlyDraftEvidence } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-text-draft-real-rejections-v1.json'), 'utf8'));
  const safeChunks = selectTextOnlyDraftEvidence(fixture.evidence, fixture.paper).evidence;
  assert.equal(real.controls.length, 8);
  for (const control of real.controls) {
    const q = control.quality;
    assert.match(control.sourceSha256, /^[a-f0-9]{64}$/u);
    assert.ok(q.metrics.orderRiskPageCount > 0);
    assert.throws(() => selectTextOnlyDraftEvidence(safeChunks, { reliability_grade: q.grade,
      permitted_uses: q.permittedUses, reason_codes: q.reasonCodes, metrics_json: q.metrics,
      assessment_sha256: stableHash(q), layout_sha256: fixture.paper.layout_sha256 }),
    { code: control.expectedError }, control.sourceUrl);
  }
});

test('mixed structural chunks, credits, changed hashes and incomplete sentences do not become prose', async () => {
  const { isNarrativeDraftEvidence, textOnlyDraftExcerpt, selectTextOnlyDraftEvidence } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const source = selectTextOnlyDraftEvidence(fixture.evidence, fixture.paper).evidence[0];
  for (const marker of [' Figure 3.', ' Equation x = y.', ' Table 2.', ' References.', ' arXiv:1234.5678.', ' Work performed elsewhere.']) {
    const quoteText = source.quoteText + marker;
    assert.equal(isNarrativeDraftEvidence({ ...source, quoteText, quoteHash: stableHash(quoteText) }), false);
  }
  assert.equal(isNarrativeDraftEvidence({ ...source, quoteHash: '0'.repeat(64) }), false);
  assert.equal(textOnlyDraftExcerpt('continued fragment. Complete sentence. Another sentence. unfinished'),
    'Complete sentence. Another sentence.');
  assert.equal(textOnlyDraftExcerpt('See section 3.2 for context. Complete statement.'),
    'Complete statement.');
  assert.equal(textOnlyDraftExcerpt('The error rate fell by 28%. Authors describe the method [1, 2].'),
    'Authors describe the method [1, 2].');
});

test('a real flattened translation-example table never enters narrative evidence', async () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-text-draft-flattened-table-v1.json'), 'utf8'));
  const { isNarrativeDraftEvidence } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  assert.equal(stableHash(real.evidence.quoteText), real.evidence.quoteHash);
  assert.deepEqual(real.evidence.locator.pages, [7]);
  assert.equal(isNarrativeDraftEvidence(real.evidence), false);
});

test('text-only findings cannot claim verified observations, comparisons or numerical results', async () => {
  const { assertTextOnlyDraftFindings, assertTextOnlyDraftComposition } = await load('agent-paper-text-draft.mjs');
  assertTextOnlyDraftFindings([{ kind: 'author_claim', text: '作者提出一种方法。' }]);
  for (const item of [{ kind: 'observed_result', text: '实验得到结果。' },
    { kind: 'author_claim', text: '作者报告提升了5%。' }, { kind: 'author_claim', text: '作者认为优于基线。' }]) {
    assert.throws(() => assertTextOnlyDraftFindings([item]));
  }
  assert.throws(() => assertTextOnlyDraftComposition({ title: '模型', summary: '概要',
    blocks: [{ type: 'paragraph', text: '这已经得到普遍证明。' }] }));
});

test('actual live-model numerical, complexity and external-impact outputs remain rejected', async () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-text-draft-live-rejection-v1.json'), 'utf8'));
  const { assertTextOnlyDraftFindings, assertTextOnlyDraftComposition, selectTextOnlyDraftEvidence,
    textOnlyDraftExcerpt } = await load('agent-paper-text-draft.mjs');
  const { validatePaperSemanticExtractionV1 } = await load('agent-paper-semantic-contracts.mjs');
  validatePaperSemanticExtractionV1(real.output); // JSON validity is insufficient.
  assert.throws(() => assertTextOnlyDraftFindings(real.output.findings), { code: real.expectedError });
  assert.throws(() => assertTextOnlyDraftFindings([real.complexityFinding]), { code: real.expectedError });
  const composition = provider.composition();
  composition.blocks[1].text = real.unsupportedHistoricalParagraph;
  assert.throws(() => assertTextOnlyDraftComposition(composition), { code: real.expectedError });
  // A negative scope statement must not be mistaken for an impact claim.
  assertTextOnlyDraftComposition({ title: '阅读边界', summary: '本次未核验', blocks: [{ type: 'paragraph',
    text: '论文阅读说明：本文不讨论现实意义、后来影响或未来应用。' }] });
  const selected = selectTextOnlyDraftEvidence(fixture.evidence, fixture.paper);
  assert.equal(selected.evidence.length, 2);
  for (const e of selected.evidence) {
    assert.doesNotMatch(textOnlyDraftExcerpt(e.quoteText), /operations|complexity|resolution|This makes it/iu);
    assert.ok(textOnlyDraftExcerpt(e.quoteText).length >= 300);
  }
});

test('private evidence pack preserves analysis-only permission and rejects scope forgery', async () => {
  const { selectTextOnlyDraftEvidence } = await load('agent-paper-text-draft.mjs');
  const { validatePaperArticleEvidencePack } = await load('agent-paper-article-generation.mjs');
  const selected = selectTextOnlyDraftEvidence(fixture.evidence, fixture.paper);
  const extraction = provider.extraction({ suppliedSections: [] });
  const pack = { schemaVersion: 'paper-article-evidence-v2', analysisId: crypto.randomUUID(),
    analysisSha256: 'a'.repeat(64), paperVersionId: crypto.randomUUID(), paper: {
      title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017, venue: 'arXiv', sourceUrl: fixture.sourceUrl },
    findings: extraction.findings.map((f, i) => ({ ...f, relations: f.relations.map(r => ({ ...r, evidenceId: selected.evidence[i].id })) })),
    limitations: [], followUpQuestions: extraction.followUpQuestions, evidence: selected.evidence.map(e => ({
      index: e.index, id: e.id, quoteText: e.quoteText, quoteHash: e.quoteHash,
      evidenceKind: 'direct-quote', locator: e.locator, allowedUses: e.allowedUses })),
    readingScope: selected.readingScope, accessedAt: '2026-10-30T00:00:00.000Z' };
  validatePaperArticleEvidencePack(pack);
  const promoted = { ...pack, schemaVersion: 'paper-article-evidence-v1' }; delete promoted.readingScope;
  assert.throws(() => validatePaperArticleEvidencePack(promoted));
  assert.throws(() => validatePaperArticleEvidencePack({ ...pack,
    readingScope: { ...pack.readingScope, manualReviewRequired: false } }));
  return { pack };
});

test('automated publication of a text-only draft is rejected before any write', async () => {
  const { PostgresAgentBlogFoundationPublicationRepository } = await load('agent-blog-foundation-publication-repository.mjs');
  const queries = [], leaseToken = crypto.randomUUID();
  const action = { action_kind: 'domain-write', capability_key: 'blog.article.publish', contract_version: 1,
    risk_level: 'L3', workflow_key: 'blog.project.single', status: 'authorized', run_status: 'running',
    stage_status: 'running', agent_status: 'active', user_status: 'active', stage_leased_by: 'worker',
    stage_lease_token: leaseToken, stage_lease_valid: true, agent_user_id: crypto.randomUUID() };
  const client = { release() {}, async query(sql) {
    queries.push(sql);
    if (sql.includes('SELECT action.*')) return { rows: [action] };
    if (sql.includes('SELECT mapping.*')) return { rows: [{ text_only_draft: true }] };
    return { rows: [] };
  } };
  const repository = new PostgresAgentBlogFoundationPublicationRepository({ connect: async () => client },
    { publicationOwnership: { assertPublisher: async () => ({ generation: 1 }) } });
  await assert.rejects(repository.publish({ actionId: crypto.randomUUID(), workerId: 'worker', leaseToken,
    articleId: crypto.randomUUID(), revisionId: crypto.randomUUID(), contentSha256: 'a'.repeat(64) }),
  { code: 'AGENT_BLOG_PUBLICATION_MANUAL_REVIEW_REQUIRED' });
  assert.equal(queries.some(sql => /^(UPDATE|INSERT)/u.test(sql)), false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('text-only article retains its notice and cannot strip scope or invent a measured result', async t => {
  const { selectTextOnlyDraftEvidence, TEXT_DRAFT_NOTICE } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const s = selectTextOnlyDraftEvidence(fixture.evidence, fixture.paper), extract = provider.extraction({ suppliedSections: [] });
  const pack = { schemaVersion: 'paper-article-evidence-v2', analysisId: crypto.randomUUID(),
    analysisSha256: 'a'.repeat(64), paperVersionId: crypto.randomUUID(), paper: {
      title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017, venue: 'arXiv', sourceUrl: fixture.sourceUrl },
    findings: extract.findings.map((f, i) => ({ ...f, relations: f.relations.map(r => ({ ...r, evidenceId: s.evidence[i].id })) })),
    limitations: [], followUpQuestions: extract.followUpQuestions,
    evidence: s.evidence.map(e => ({ index: e.index, id: e.id, quoteText: e.quoteText, quoteHash: e.quoteHash,
      evidenceKind: 'direct-quote', locator: e.locator, allowedUses: e.allowedUses })),
    readingScope: s.readingScope, accessedAt: '2026-10-30T00:00:00.000Z' };
  const stored = new Map(), toolId = crypto.randomUUID(); let output = provider.composition();
  const artifacts = { readToolArtifact: async () => ({ content: pack }),
    save: async input => { const row = { id: crypto.randomUUID(), artifactKey: input.artifactKey,
      content: structuredClone(input.content), contentSha256: stableHash(input.content) }; stored.set(row.id, row); return row; },
    read: async ({ artifactId }) => structuredClone(stored.get(artifactId)) };
  const handlers = createAgentPaperArticleGenerationHandlers({ artifactRepository: artifacts,
    providerGateway: { invoke: async request => {
      const payload = JSON.parse(request.request.messages[1].content);
      const prompt = request.request.messages[0].content;
      assert.match(prompt, /六至八十个块/u);
      assert.match(prompt, /八百至一万字/u);
      assert.equal(payload.verifiedPaper.evidence.every(e => !Object.hasOwn(e, 'quoteText')), true);
      assert.deepEqual(payload.verifiedPaper.evidence.map(e => e.quoteHash), s.evidence.map(e => e.quoteHash));
      assert.equal(payload.verifiedPaper.findings.every(f => !Object.hasOwn(f, 'confidence')), true);
      assert.equal(Object.hasOwn(payload.verifiedPaper.readingScope, 'reasonCodes'), false);
      assert.deepEqual(payload.verifiedPaper.limitations, [{ text: TEXT_DRAFT_NOTICE }]);
      return { actionId: crypto.randomUUID(), output };
    } } });
  const run = { id: crypto.randomUUID(), agentUserId: crypto.randomUUID(), input: {}, configSnapshot: {} };
  const execution = { workerId: 'text-draft-test', leaseToken: crypto.randomUUID() };
  const composeContext = { run, stage: { id: crypto.randomUUID() }, prerequisites: [{ stageKey: 'collect-evidence',
    status: 'succeeded', outputRef: { artifactIds: [toolId] } }] };
  const composed = await handlers['paper.article.draft-shadow:compose'](composeContext, execution);
  const context = { run, stage: { id: crypto.randomUUID() }, prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] };
  const artifact = stored.get(composed.outputRef.artifactId), original = structuredClone(artifact.content);
  assert.equal(original.content.blocks[0].text, TEXT_DRAFT_NOTICE);
  await handlers['paper.article.draft-shadow:verify'](context, execution);
  delete artifact.content.selection.readingScope;
  await assert.rejects(handlers['paper.article.draft-shadow:verify'](context, execution));
  artifact.content = structuredClone(original); artifact.content.content.blocks.shift();
  await assert.rejects(handlers['paper.article.draft-shadow:verify'](context, execution));
  output = provider.composition(); output.blocks[1].text += '作者报告准确率提升5%。';
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](composeContext, execution));
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-text-draft-live-rejection-v1.json'), 'utf8'));
  output = provider.composition(); output.blocks[1].citationIndexes = real.invalidCitationIndexes;
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](composeContext, execution),
    { code: 'AGENT_PAPER_ARTICLE_CITATION_INVALID' });
  for (const heading of ['实验准确率提升90%', '实验效果优于基线', '这项研究后来影响深远']) {
    await t.test(`compose rejects heading: ${heading}`, async () => {
      output = provider.composition();
      output.blocks.find(block => block.type === 'heading').text = heading;
      await assert.rejects(handlers['paper.article.draft-shadow:compose'](composeContext, execution),
        { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
    });
    await t.test(`verify rejects heading: ${heading}`, async () => {
      artifact.content = structuredClone(original);
      artifact.content.content.blocks.find(block => block.type === 'heading').text = heading;
      artifact.contentSha256 = stableHash(artifact.content);
      await assert.rejects(handlers['paper.article.draft-shadow:verify'](context, execution),
        { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
    });
  }
});

test('semantic reader sends a complete schema example and filtered evidence to the provider', async () => {
  const { createAgentPaperSemanticHandlers } = await load('agent-paper-semantic-runtime.mjs');
  const { validatePaperSemanticExtractionV1 } = await load('agent-paper-semantic-contracts.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { selectTextOnlyDraftEvidence } = await load('agent-paper-text-draft.mjs');
  const selected = selectTextOnlyDraftEvidence(fixture.evidence, fixture.paper);
  const source = { ...selected, paperVersionId: crypto.randomUUID(), identity: { title: 'Attention Is All You Need' },
    externalProcessingClass: 'public-arxiv-open-fulltext', contentSha256: fixture.sourceSha256,
    layoutSha256: fixture.paper.layout_sha256, parseAssessmentSha256: fixture.paper.assessment_sha256,
    evidenceManifestSha256: stableHash(selected.evidence.map(({ index, id, quoteHash }) => ({ index, id, quoteHash }))) };
  let captured;
  const handlers = createAgentPaperSemanticHandlers({ repository: { loadTrustedPaper: async () => source },
    artifactRepository: { save: async input => ({ id: crypto.randomUUID(), artifactKey: input.artifactKey,
      contentSha256: stableHash(input.content) }) }, semanticGateway: {},
    providerGateway: { invoke: async request => {
      captured = request.request;
      const payload = JSON.parse(captured.messages[1].content);
      const example = JSON.parse(captured.messages[0].content.match(/\{"key":"author-claim-example"[^\n]+\}/u)[0]);
      // The actual prompt's example must satisfy the same production validator.
      const output = { schemaVersion: 'paper-semantic-extraction-v1', sections: payload.suppliedSections,
        findings: [example], limitations: [], followUpQuestions: ['研究问题是什么？', '方法如何工作？', '哪些内容仍需核对？'] };
      validatePaperSemanticExtractionV1(output);
      return { status: 'succeeded', actionId: crypto.randomUUID(), output };
    } } });
  const input = { schemaVersion: 'paper-semantic-run-input-v1', paperVersionId: source.paperVersionId, purpose: 'private-research' };
  const run = { input, inputSha256: stableHash(input), id: crypto.randomUUID(), agentUserId: crypto.randomUUID() };
  let previous;
  for (const [stage, parent] of [['verify-eligibility', null], ['reconstruct-sections', 'verify-eligibility'],
    ['extract-semantics', 'reconstruct-sections']]) {
    previous = await handlers[`paper.single.semantic-shadow:${stage}`]({ run, stage: { id: crypto.randomUUID() },
      prerequisites: parent ? [{ stageKey: parent, status: 'succeeded', outputRef: previous.outputRef }] : [] },
    { workerId: 'test', leaseToken: crypto.randomUUID() });
  }
  assert.match(captured.messages[0].content, /只能提取定性的 author_claim 或 unknown/u);
  const payload = JSON.parse(captured.messages[1].content);
  assert.equal(payload.evidence.length, 2);
  assert.equal(payload.evidence.some(e => /h t −/u.test(e.quoteText)), false);
});
