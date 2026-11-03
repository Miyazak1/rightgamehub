// Recorded pre-sectioned responses intentionally exercise the retained v3 compositor.
// Sectioned v4 production behavior is covered in agent-paper-article-sections.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../apps/api/src', name)));
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-native-prose-real-v1.json')));
let captured;
async function source() {
  if (captured) return structuredClone(captured);
  const { extractPaperPdf } = await load('agent-arxiv-paper-tool.mjs');
  const { selectTextOnlyDraftEvidence } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { OPS } = await import(pathToFileURL(path.resolve(__dirname,
    '../../apps/api/node_modules/pdfjs-dist/legacy/build/pdf.mjs')));
  const output = await extractPaperPdf(new Uint8Array([1]), randomUUID(), () => ({
    promise: Promise.resolve({ numPages: real.pages.length, async getPage(n) {
      const page = real.pages[n - 1];
      return { getViewport: () => page,
        getTextContent: async () => ({ items: page.items }),
        getOperatorList: async () => ({ fnArray: Array(page.imageCount).fill(OPS.paintImageXObject) }) };
    } }), destroy: async () => {} }));
  const q = output.qualityAssessment;
  const selected = selectTextOnlyDraftEvidence(output.evidence.map(span => ({ ...span,
    id: randomUUID(), allowedUses: ['analysis'], evidenceKind: 'direct-quote' })), {
    reliability_grade: q.grade, permitted_uses: q.permittedUses, reason_codes: q.reasonCodes,
    metrics_json: q.metrics, assessment_sha256: stableHash(q), layout_sha256: stableHash(output.pages),
  });
  captured = { output, selected };
  return structuredClone(captured);
}

test('real full PDF text items expose method and conclusion prose without upgrading structural quality', async () => {
  const { output, selected } = await source();
  const { textOnlyDraftExcerpt, validateTextOnlyDraftScope } = await load('agent-paper-text-draft.mjs');
  assert.equal(real.sourceSha256, 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697');
  assert.equal(output.qualityAssessment.grade, 'limited-text');
  assert.deepEqual(output.qualityAssessment.permittedUses, ['analysis']);
  assert.equal(output.qualityAssessment.metrics.orderRiskPageCount, 0);
  const pages = new Set(selected.evidence.flatMap(e => e.locator.pages));
  for (const page of [2, 3, 5, 6, 10]) assert.ok(pages.has(page), `safe prose on page ${page}`);
  const excerpts = selected.evidence.map(e => textOnlyDraftExcerpt(e.quoteText)).join(' ');
  assert.match(excerpts, /decoder.*attend/iu);
  assert.match(excerpts, /positional encodings/iu);
  assert.match(excerpts, /feed-forward/iu);
  assert.doesNotMatch(excerpts, /\b(?:outperforms?|perplexities|operations|complexity|LayerNorm)\b|\bO\s*\(/iu);
  assert.ok(excerpts.length >= 4500);
  assert.ok(selected.evidence.length > 2);
  validateTextOnlyDraftScope(selected.readingScope, selected.evidence);
  assert.equal(selected.readingScope.publicPublicationEnabled, false);
});

test('paragraph boundaries preserve item order and stop at columns, gaps and structural lines', async () => {
  const { paragraphTextLayerBlocks: split } = await load('agent-paper-text-layer-blocks.mjs');
  const line = (str, x, y, width = 200) => ({ str, width,
    transform: [10, 0, 0, 10, x, y], hasEOL: true });
  const items = [line('Authors describe the method.', 40, 700),
    line('The next sentence explains it.', 40, 688),
    line('Figure 1: a diagram.', 40, 660),
    line('An independent paragraph.', 40, 620),
    line('A different column.', 320, 700)];
  const before = structuredClone(items);
  const blocks = split(items, { page: 1, width: 600, height: 800 });
  assert.equal(blocks[0].text, 'Authors describe the method. The next sentence explains it.');
  assert.equal(blocks[1].kind, 'caption');
  assert.equal(blocks.at(-1).text, 'A different column.');
  assert.notDeepEqual(blocks[0].bbox, [0, 0, 600, 800]);
  assert.deepEqual(items, before);
  const cells = split([
    { ...line('A long table cell containing prose.', 40, 700, 130), hasEOL: false },
    line('Another cell.', 320, 700, 100),
  ], { page: 1, width: 600, height: 800 });
  assert.equal(cells[0].kind, 'table');
  assert.equal(split([{ ...items[0], transform: [0, 10, -10, 0, 40, 700] }],
    { page: 1, width: 600, height: 800 }), null);
});

test('writing depth follows available evidence and complete draft verification retains private review', async () => {
  const { selected } = await source();
  const { textOnlyDraftWritingPlan, TEXT_DRAFT_NOTICE } = await load('agent-paper-text-draft.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const evidence = { schemaVersion: 'paper-article-evidence-v2',
    analysisId: randomUUID(), analysisSha256: 'a'.repeat(64), paperVersionId: randomUUID(),
    paper: { title: 'Attention Is All You Need', authors: ['Vaswani'], year: 2017,
      venue: null, sourceUrl: real.sourceUrl }, evidence: selected.evidence.map(
      ({ index, id, quoteText, quoteHash, evidenceKind, locator, allowedUses }) =>
        ({ index, id, quoteText, quoteHash, evidenceKind, locator, allowedUses })),
    readingScope: selected.readingScope,
    findings: selected.evidence.map((e, i) => ({ key: `claim-${i}`,
      kind: 'author_claim', text: `作者说明${'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳'[i]}部分的信息组织方式。`,
      relations: [{ evidenceId: e.id, evidenceIndex: e.index, relation: 'supports' }] })),
    limitations: [], followUpQuestions: ['作者怎样定义方法？', '模型如何组织信息？', '有哪些适用边界？'],
    accessedAt: '2026-10-31T00:00:00.000Z' };
  assert.equal(textOnlyDraftWritingPlan(evidence).depth, 'expanded');
  assert.equal(textOnlyDraftWritingPlan(evidence).lengthPolicy, 'content-first-v1');
  assert.equal(textOnlyDraftWritingPlan({ ...evidence, findings: evidence.findings.slice(0, 2) }).depth, 'brief');
  assert.equal(textOnlyDraftWritingPlan({ ...evidence, findings: evidence.findings.map(
    f => ({ ...f, text: evidence.findings[0].text })) }).depth, 'brief');
  assert.equal(textOnlyDraftWritingPlan({ ...evidence, findings: evidence.findings.map(
    f => ({ ...f, relations: [evidence.findings[0].relations[0]] })) }).depth, 'brief');
  const memory = new Map(), toolId = randomUUID();
  let output;
  const handlers = createAgentPaperArticleGenerationHandlers({
    providerGateway: { async invoke(request) {
      const payload = JSON.parse(request.request.messages[1].content);
      assert.equal(payload.writingPlan.depth, 'expanded');
      assert.match(request.request.messages[0].content, /两千五百至四千字/u);
      assert.doesNotMatch(request.request.messages[0].content, /文章应解释研究问题、方法、主要发现、现实意义和限制/u);
      assert.doesNotMatch(request.request.messages[0].content, /向左信息流|向右信息流|阻止解码器中的信息流|过拟合/u);
      assert.equal(Object.hasOwn(payload.verifiedPaper, 'readingNotice'), false);
      assert.deepEqual(payload.verifiedPaper.limitations, []);
      assert.equal(JSON.stringify(payload).includes(TEXT_DRAFT_NOTICE), false);
      assert.equal(Object.hasOwn(payload.verifiedPaper.evidence[0], 'quoteText'), false);
      return { output, actionId: randomUUID() };
    } }, artifactRepository: {
      async readToolArtifact() { return { content: evidence }; },
      async save(value) { const a = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) };
        memory.set(a.id, a); return a; },
      async read({ artifactId }) { return memory.get(artifactId); },
    } });
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [toolId] } }] };
  const sentence = '作者说明信息如何在模型的各部分之间建立联系，论文把这种联系作为解释方法组织方式的线索。';
  const draft = repeats => ({ title: '理解论文中的信息组织方式', summary: '论文围绕序列处理中的信息联系，介绍方法组成与各部分之间的关系，帮助读者理解作者的设计思路。',
    blocks: ['研究问题', '方法组成', '各部分的关系'].flatMap((text, i) => [
      { type: 'heading', level: 2, text },
      { type: 'paragraph', text: sentence.repeat(repeats), citationIndexes: [1],
        findingKeys: evidence.findings.filter((f, j) => j % 3 === i).map(f => f.key) }]),
    followUpQuestions: evidence.followUpQuestions });
  output = draft(5);
  output.blocks.push(...Array.from({ length: 20 }, () => ({ type: 'heading', level: 2,
    text: '论文的方法组成与信息关系'.repeat(10) })));
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: 'AGENT_PAPER_ARTICLE_LENGTH_INVALID' });
  output = draft(22);
  const composed = await handlers['paper.article.draft-shadow:compose'](context, {});
  assert.equal(memory.get(composed.outputRef.artifactId).content.content.blocks[0].text, TEXT_DRAFT_NOTICE);
  assert.equal(memory.get(composed.outputRef.artifactId).content.paragraphEvidenceBindings.length, 3);
  assert.ok(memory.get(composed.outputRef.artifactId).content.content.blocks.every(b => !Object.hasOwn(b, 'findingKeys')));
  const verified = await handlers['paper.article.draft-shadow:verify']({ ...context,
    prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] }, {});
  assert.equal(memory.get(verified.outputRef.artifactId).content.manualReviewRequired, true);
  assert.equal(memory.get(verified.outputRef.artifactId).content.publicPublicationEnabled, false);
  const savedComposition = memory.get(composed.outputRef.artifactId).content;
  const savedBlocks = structuredClone(savedComposition.content.blocks);
  const savedBindings = structuredClone(savedComposition.paragraphEvidenceBindings);
  savedComposition.paragraphEvidenceBindings[0].evidence[0].pages = [99];
  await assert.rejects(handlers['paper.article.draft-shadow:verify']({ ...context,
    prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] }, {}),
  { code: 'AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID' });
  savedComposition.paragraphEvidenceBindings = structuredClone(savedBindings);
  savedComposition.content.blocks.find(b => b.type === 'paragraph' && b.text !== TEXT_DRAFT_NOTICE).text
    += '作者这样安排是为了控制过拟合。';
  await assert.rejects(handlers['paper.article.draft-shadow:verify']({ ...context,
    prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] }, {}),
  { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  savedComposition.content.blocks = structuredClone(savedBlocks);
  savedComposition.content.blocks.find(b => b.type === 'paragraph' && b.text !== TEXT_DRAFT_NOTICE).text
    += '作者在解码器中阻止向左的信息流。';
  await assert.rejects(handlers['paper.article.draft-shadow:verify']({ ...context,
    prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] }, {}),
  { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  savedComposition.content.blocks = structuredClone(savedBlocks);
  for (const b of savedComposition.content.blocks.slice(1)) {
    if (b.type === 'paragraph') b.text = sentence.repeat(3);
  }
  await assert.rejects(handlers['paper.article.draft-shadow:verify']({ ...context,
    prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] }, {}),
  { code: 'AGENT_PAPER_ARTICLE_LENGTH_INVALID' });
  savedComposition.content.blocks = savedBlocks;
  output = draft(22);
  for (const b of output.blocks.filter(b => b.type === 'paragraph')) b.text += '论文中的复杂内容本次未核验。';
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_LIMITATIONS' });
});

test('recorded expanded live draft stays blocked for repeated limitations without another model call', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-expanded-live-rejection-v1.json')));
  const { createAgentPaperArticleGenerationHandlers, validatePaperArticleEvidencePack } =
    await load('agent-paper-article-generation.mjs');
  const { PAPER_SEMANTIC_PROMPT_VERSION } = await load('agent-paper-semantic-runtime.mjs');
  assert.equal(PAPER_SEMANTIC_PROMPT_VERSION, 'paper-semantic-reader-v10');
  validatePaperArticleEvidencePack(live.evidencePack);
  assert.equal(live.recordedReceipts.length, 2);
  assert.ok(live.recordedReceipts.every(r => r.responseRef.httpStatus === 200));
  assert.equal(live.composition.blocks.filter(b => b.type === 'paragraph')
    .reduce((n, b) => n + Array.from(b.text).length, 0), 2781);
  let saved = false, replayReads = 0;
  let output = live.composition;
  const handlers = createAgentPaperArticleGenerationHandlers({
    providerGateway: { async invoke() { replayReads += 1; return { output }; } },
    artifactRepository: {
      async readToolArtifact() { return { content: live.evidencePack }; },
      async save() { saved = true; throw Error('BLOCKED_DRAFT_MUST_NOT_BE_SAVED'); },
    },
  });
  const context = {
    run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded',
      outputRef: { artifactIds: [randomUUID()] } }],
  };
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  // A diagnostic copy with only the ambiguous wording removed still fails the
  // original repetition gate. Never modify the recorded provider response.
  output = structuredClone(live.composition);
  for (const b of output.blocks) if (b.type === 'paragraph') {
    b.text = b.text.replace('阻止向左的信息流', '阻止访问后续位置');
  }
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: live.expectedErrorCode });
  assert.equal(saved, false);
  assert.equal(replayReads, 2);
});

test('literal same-page labels restore clipped component context and cannot leak across headings or pages', async () => {
  const { output, selected } = await source();
  const { textLayerSectionPaths } = await load('agent-paper-text-layer-blocks.mjs');
  const { assertTextOnlyDraftFindingContext: check } = await load('agent-paper-text-draft.mjs');
  const { validateTextOnlyDraftScope } = await load('agent-paper-text-draft.mjs');
  const encoder = selected.evidence.find(e => e.locator.blockIds.includes('p3-b5'));
  const decoder = selected.evidence.find(e => e.locator.blockIds[0] === 'p3-b8');
  assert.equal(encoder.locator.sectionPath.at(-1), 'Encoder');
  assert.equal(decoder.locator.sectionPath.at(-1), 'Decoder');
  validateTextOnlyDraftScope(selected.readingScope, selected.evidence);
  assert.ok(selected.readingScope.selectedEvidence.find(e => e.id === encoder.id).locatorSha256);
  const forged = structuredClone(selected.evidence);
  forged.find(e => e.id === encoder.id).locator.sectionPath = ['Decoder'];
  assert.throws(() => validateTextOnlyDraftScope(selected.readingScope, forged),
    { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  const claim = { kind: 'author_claim', text: '作者说明编码器使用注意力子层与前馈子层。',
    relations: [{ evidenceIndex: encoder.index, relation: 'supports' }] };
  check([claim], selected.evidence);
  const missing = selected.evidence.map(e => e.id === encoder.id
    ? { ...e, locator: { ...e.locator, sectionPath: [] } } : e);
  assert.throws(() => check([claim], missing), { code: 'AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT' });
  const broad = selected.evidence.map(e => e.id === encoder.id
    ? { ...e, locator: { ...e.locator, sectionPath: ['Encoder and Decoder Stacks'] } } : e);
  assert.throws(() => check([claim], broad), { code: 'AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT' });
  assert.throws(() => check([{ ...claim, relations: [{ ...claim.relations[0], relation: 'context' }] }], selected.evidence),
    { code: 'AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT' });
  assert.throws(() => check([{ ...claim, text: '作者在解码器中阻止向左的信息流。' }], selected.evidence),
    { code: 'AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT' });
  assert.deepEqual(textLayerSectionPaths(output.pages).get('p3-b10'), ['Attention']);
  const paths = textLayerSectionPaths([
    { blocks: [{ id: 'a', kind: 'paragraph', text: 'Encoder: A literal label.' }] },
    { blocks: [{ id: 'b', kind: 'paragraph', text: 'The first is an attention layer.' }] },
  ]);
  assert.deepEqual(paths.get('a'), ['Encoder']);
  assert.deepEqual(paths.get('b'), []);
});

test('semantic extraction and verification both enforce explicit component context before saving a proof', async () => {
  const { selected } = await source();
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { createAgentPaperSemanticHandlers } = await load('agent-paper-semantic-runtime.mjs');
  const encoder = selected.evidence.find(e => e.locator.blockIds.includes('p3-b5'));
  const paperVersionId = randomUUID(), memory = new Map();
  const sourceValue = { ...selected, paperVersionId, identity: { title: 'Attention Is All You Need' },
    externalProcessingClass: 'public-arxiv-open-fulltext', contentSha256: real.sourceSha256,
    layoutSha256: selected.readingScope.layoutSha256,
    parseAssessmentSha256: selected.readingScope.parseAssessmentSha256,
    evidenceManifestSha256: stableHash(selected.evidence.map(({ index, id, quoteHash }) => ({ index, id, quoteHash }))) };
  let bad = true;
  const handlers = createAgentPaperSemanticHandlers({
    repository: { loadTrustedPaper: async () => sourceValue }, semanticGateway: {},
    artifactRepository: {
      async save(value) { const row = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) };
        memory.set(row.id, row); return row; },
      async read({ artifactId }) { return memory.get(artifactId); },
    },
    providerGateway: { async invoke(request) {
      const payload = JSON.parse(request.request.messages[1].content);
      assert.equal(payload.evidence.find(e => e.evidenceIndex === encoder.index).locator.sectionPath.at(-1), 'Encoder');
      assert.equal(request.promptTemplate.version, 10);
      assert.equal(payload.readingGuide.candidateEvidenceOnly, true);
      assert.ok(payload.readingGuide.researchProblemEvidenceIndexes.includes(selected.evidence.find(e =>
        e.quoteText.includes('The fundamental constraint of sequential computation')).index));
      assert.match(request.request.messages[0].content, /不能只提取新架构而丢掉问题/u);
      assert.match(request.request.messages[0].content, /主语不明时用 unknown/u);
      assert.doesNotMatch(request.request.messages[0].content, /向左信息流|向右信息流|阻止解码器中的信息流|过拟合/u);
      return { status: 'succeeded', actionId: randomUUID(), provider: 'offline-fixture', modelId: 'fixture', output: {
        schemaVersion: 'paper-semantic-extraction-v1', sections: payload.suppliedSections,
        findings: [{ key: 'encoder-structure', kind: 'author_claim',
          text: bad ? '作者在解码器中阻止向左的信息流。' : '作者说明编码器使用注意力子层与前馈子层。',
          evidenceIndexes: [encoder.index], relations: [{ evidenceIndex: encoder.index, relation: 'supports' }], confidence: 'low' }],
        limitations: [], followUpQuestions: ['作者如何组织模型？', '子层怎样联系起来？', '哪些内容需要进一步阅读？'],
      } };
    } },
  });
  const input = { schemaVersion: 'paper-semantic-run-input-v1', paperVersionId, purpose: 'private-research' };
  const run = { id: randomUUID(), agentUserId: randomUUID(), input, inputSha256: stableHash(input) };
  const context = { run, stage: { id: randomUUID() }, prerequisites: [] };
  const eligible = await handlers['paper.single.semantic-shadow:verify-eligibility'](context, {});
  const sections = await handlers['paper.single.semantic-shadow:reconstruct-sections']({ ...context,
    prerequisites: [{ stageKey: 'verify-eligibility', status: 'succeeded', outputRef: eligible.outputRef }] }, {});
  const extractContext = { ...context, prerequisites: [{ stageKey: 'reconstruct-sections', status: 'succeeded', outputRef: sections.outputRef }] };
  await assert.rejects(handlers['paper.single.semantic-shadow:extract-semantics'](extractContext, {}),
    { code: 'AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT' });
  assert.equal(memory.size, 0);
  bad = false;
  const extraction = await handlers['paper.single.semantic-shadow:extract-semantics'](extractContext, {});
  const verifyContext = { ...context, prerequisites: [{ stageKey: 'extract-semantics', status: 'succeeded', outputRef: extraction.outputRef }] };
  const cached = memory.get(extraction.outputRef.artifactId);
  const goodText = cached.content.findings[0].text;
  cached.content.findings[0].text = '作者在解码器中阻止向左的信息流。';
  await assert.rejects(handlers['paper.single.semantic-shadow:verify-semantics'](verifyContext, {}),
    { code: 'AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT' });
  cached.content.findings[0].text = goodText;
  const verified = await handlers['paper.single.semantic-shadow:verify-semantics'](verifyContext, {});
  const proof = memory.get(verified.outputRef.artifactId).content;
  assert.equal(proof.promptVersion, 'paper-semantic-reader-v10');
  assert.equal(proof.publicPublicationEnabled, false);
});

test('real native PDF reading guide highlights the supported problem and method relations without inventing findings', async () => {
  const { selected } = await source();
  const { textOnlyDraftReadingGuide, textOnlyDraftExcerpt } = await load('agent-paper-text-draft.mjs');
  const before = structuredClone(selected), guide = textOnlyDraftReadingGuide(selected.evidence);
  const problem = selected.evidence.find(e => textOnlyDraftExcerpt(e.quoteText).includes('The fundamental constraint of sequential computation'));
  const informationSources = selected.evidence.find(e => textOnlyDraftExcerpt(e.quoteText).includes('queries come from the previous decoder layer'));
  const positions = selected.evidence.find(e => textOnlyDraftExcerpt(e.quoteText).includes('To this end'));
  assert.ok(guide.researchProblemEvidenceIndexes.includes(problem.index));
  assert.ok(guide.methodRelationEvidenceIndexes.includes(informationSources.index));
  assert.ok(guide.methodRelationEvidenceIndexes.includes(positions.index));
  assert.equal(guide.candidateEvidenceOnly, true);
  assert.equal(Object.hasOwn(guide, 'findings'), false);
  assert.deepEqual(selected, before);
  const neutral = textOnlyDraftReadingGuide([{ index: 47, quoteText: 'Authors describe a sequence model. The method maps inputs to outputs.' }]);
  assert.deepEqual(neutral.researchProblemEvidenceIndexes, []);
  assert.deepEqual(neutral.methodRelationEvidenceIndexes, []);
  // A problem present only in a rejected numerical sentence is not supplied.
  const unsafe = textOnlyDraftReadingGuide([{ index: 9, quoteText: 'There are 12 unresolved problems. Authors describe a sequence model.' }]);
  assert.deepEqual(unsafe.researchProblemEvidenceIndexes, []);
});

test('real PDF preserves the literal each-layer premise across adjacent blocks without upgrading structural quality', async () => {
  const { output, selected } = await source();
  const { textOnlyDraftExcerpt, assertTextOnlyDraftFindingContext, validateTextOnlyDraftScope } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const encoder = selected.evidence.find(e => e.locator.blockIds.includes('p3-b5'));
  assert.deepEqual(encoder.locator.blockIds, ['p3-b4', 'p3-b5']);
  assert.match(textOnlyDraftExcerpt(encoder.quoteText), /^Each layer has two sub-layers\./u);
  assert.equal(encoder.quoteHash, stableHash(encoder.quoteText));
  const native = real.pages[2].items.map(i => i.str).join(' ').replace(/\s+/gu, ' ');
  assert.ok(native.includes('Each layer has two sub-layers.'));
  assert.equal(output.qualityAssessment.parserVersion, 'pdfjs-dist@6.4.299:text-layer-v5');
  assert.equal(output.qualityAssessment.grade, 'limited-text');
  assert.deepEqual(output.qualityAssessment.permittedUses, ['analysis']);
  const claim = { kind: 'author_claim', text: '作者说明编码器每层包含两个子层：多头自注意力与逐位置前馈网络。',
    relations: [{ evidenceIndex: encoder.index, relation: 'supports' }] };
  assertTextOnlyDraftFindingContext([claim], selected.evidence);
  assertTextOnlyDraftFindingContext([{ ...claim, text: claim.text.replace('编码器每层', '编码器层') }], selected.evidence);
  assert.throws(() => assertTextOnlyDraftFindingContext([{ ...claim,
    text: '作者说明编码器由两个子层组成：多头自注意力与逐位置前馈网络。' }], selected.evidence),
  { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
  const forged = structuredClone(selected.evidence);
  forged.find(e => e.id === encoder.id).locator.blockIds = ['p2-b4', 'p3-b5'];
  assert.throws(() => validateTextOnlyDraftScope(selected.readingScope, forged), { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  const clipped = selected.evidence.map(e => e.id === encoder.id
    ? { ...e, quoteText: e.quoteText.replace('Each layer has two ', ''), quoteHash: stableHash(e.quoteText.replace('Each layer has two ', '')) } : e);
  assert.throws(() => assertTextOnlyDraftFindingContext([claim], clipped), { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
});

test('literal hierarchy continuation refuses column jumps, distant lines, tables and cross-page context', async () => {
  const { textLayerHierarchyContinuations: join } = await load('agent-paper-text-layer-blocks.mjs');
  const previous = { id: 'p1-b1', kind: 'formula', text: 'Encoder: stack N = 6. Each layer has two', bbox: [40, 40, 300, 52] };
  const current = { id: 'p1-b2', kind: 'paragraph', text: 'sub-layers. The first is self-attention.', bbox: [40, 53, 300, 65] };
  const result = join([{ blocks: [previous, current] }]).get(current.id);
  assert.equal(result.quoteText, 'Each layer has two sub-layers. The first is self-attention.');
  assert.deepEqual(result.blockIds, [previous.id, current.id]);
  for (const blocks of [[previous, { ...current, bbox: [350, 53, 600, 65] }],
    [previous, { ...current, bbox: [40, 100, 300, 112] }],
    [{ ...previous, kind: 'table' }, current], [previous, { ...current, kind: 'caption' }]]) {
    assert.equal(join([{ blocks }]).size, 0);
  }
  assert.equal(join([{ blocks: [previous] }, { blocks: [{ ...current, id: 'p2-b1' }] }]).size, 0);
});

test('recorded second live draft remains blocked below the expanded length floor without repeated caveats', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-expanded-live-short-v1.json')));
  const { createAgentPaperArticleGenerationHandlers, validatePaperArticleEvidencePack } =
    await load('agent-paper-article-generation.mjs');
  const { assertTextOnlyDraftComposition, textOnlyDraftWritingPlan } = await load('agent-paper-text-draft.mjs');
  validatePaperArticleEvidencePack(live.evidencePack);
  assert.equal(textOnlyDraftWritingPlan(live.evidencePack).depth, 'expanded');
  assert.throws(() => assertTextOnlyDraftComposition(live.composition), { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  const paragraphs = live.composition.blocks.filter(b => b.type === 'paragraph');
  assert.equal(paragraphs.reduce((n, b) => n + Array.from(b.text).length, 0), 1722);
  assert.equal(paragraphs.some(b => /未核验|未核对|发布前|待审|可用正文|阅读范围/u.test(b.text)), false);
  assert.ok(paragraphs.every(b => b.citationIndexes.length === 1 && b.citationIndexes[0] === 1));
  assert.equal(live.recordedReceipts.length, 2);
  assert.ok(live.recordedReceipts.every(r => r.responseRef.httpStatus === 200 && r.responseRef.finishReason === 'stop'));
  let saved = false;
  let output = live.composition;
  const handlers = createAgentPaperArticleGenerationHandlers({
    providerGateway: { async invoke() { return { output }; } },
    artifactRepository: {
      async readToolArtifact() { return { content: live.evidencePack }; },
      async save() { saved = true; throw Error('SHORT_DRAFT_MUST_NOT_BE_SAVED'); },
    },
  });
  const context = {
    run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded',
      outputRef: { artifactIds: [randomUUID()] } }],
  };
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  output = structuredClone(live.composition);
  for (const b of output.blocks) if (b.type === 'paragraph') {
    b.text = b.text.replace('阻止解码器中的信息流', '阻止来自后续位置的信息流');
  }
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: live.expectedErrorCode });
  assert.equal(saved, false);
});

test('server outline covers recorded findings without word or fixed paragraph quotas', async () => {
  const { evidencePack } = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-expanded-live-short-v1.json')));
  const { textOnlyDraftWritingPlan } = await load('agent-paper-text-draft.mjs');
  const plan = textOnlyDraftWritingPlan(evidencePack);
  assert.equal(plan.sections.length, 6);
  assert.ok(plan.sections.every(s => !Object.hasOwn(s, 'minimumCharacters') && !Object.hasOwn(s, 'targetCharacters')));
  assert.ok(plan.sections.every(s => s.minimumParagraphs === 1 && s.findingKeys.length > 0));
  assert.ok(plan.sections.every(s => s.paragraphs.length > 0
    && s.paragraphs.every(p => p.findingKeys.length > 0 && p.findingKeys.length <= 16)));
  assert.ok(plan.sections.every(s => new Set(s.paragraphs.flatMap(p => p.findingKeys)).size
    === s.paragraphs.reduce((n, p) => n + p.findingKeys.length, 0)));
  assert.ok(plan.sections.every(s => s.paragraphs.every(p => p.focus === 'explain-distinct-claims-without-recap')));
  assert.equal(plan.lengthPolicy, 'content-first-v1');
  assert.equal(Object.hasOwn(plan, 'minimumBodyCharacters'), false);
  assert.equal(Object.hasOwn(plan, 'targetBodyCharacters'), false);
  assert.equal(plan.authorAttributionRequiredPerParagraph, true);
  assert.ok(plan.sections.every(s => s.paragraphs.every(p => p.developmentTasks.length === 3)));
  const keys = plan.sections.flatMap(s => s.findingKeys);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, evidencePack.findings.filter(f => f.kind === 'author_claim').map(f => f.key));
  const sparse = textOnlyDraftWritingPlan({ ...evidencePack, findings: evidencePack.findings.slice(0, 2) });
  assert.deepEqual(sparse.sections, []);
  assert.equal(sparse.paragraphFindingKeysRequired, false);
});

test('actual unsupported purpose and overly broad masking claims are rejected without changing the captured output', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-short-v1.json')));
  const { assertSupportedDraftExplanations: check, assertTextOnlyDraftFindingContext: context } =
    await load('agent-paper-text-draft.mjs');
  const dropout = live.evidencePack.findings.find(f => f.key === 'residual-dropout-placement');
  const paragraph = live.composition.blocks.find(b => b.text?.includes('为了控制过拟合'));
  assert.ok(paragraph);
  assert.throws(() => check(paragraph.text, dropout.text),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  assert.throws(() => context([{ ...dropout, text: '作者说明 dropout 用于控制过拟合。' }], live.evidencePack.evidence),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  check('作者明确说明 dropout 用于控制过拟合。', 'Authors use dropout to prevent overfitting.');
  const broad = live.evidencePack.findings.find(f => f.key === 'decoder-self-attention-prefix');
  assert.throws(() => context([broad], live.evidencePack.evidence),
    { code: 'AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT' });
  context([{ ...broad, text: '作者说明解码器自注意力阻止来自后续位置的信息流。' }], live.evidencePack.evidence);
});

test('paragraph finding bindings reject absent, invented, duplicate and uncovered claims and forged source pages', async () => {
  const { evidencePack } = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-expanded-live-short-v1.json')));
  const { textOnlyDraftWritingPlan } = await load('agent-paper-text-draft.mjs');
  const { bindDraftParagraphs } = await load('agent-paper-draft-grounding.mjs');
  const { validatePaperArticleEvidencePack } = await load('agent-paper-article-generation.mjs');
  const mismatched = structuredClone(evidencePack);
  mismatched.findings[0].relations[0].evidenceIndex = evidencePack.evidence.at(-1).index;
  assert.throws(() => validatePaperArticleEvidencePack(mismatched), { code: 'AGENT_PAPER_ARTICLE_FINDING_INVALID' });
  // A protocol fixture, not an edited or approved live article.
  const blocks = textOnlyDraftWritingPlan(evidencePack).sections.map(s => ({
    type: 'paragraph', text: '作者说明模型的信息组织方式。', findingKeys: s.findingKeys,
  }));
  const bindings = bindDraftParagraphs(blocks, evidencePack);
  const unsupportedAnalysis = structuredClone(evidencePack);
  unsupportedAnalysis.findings.find(f => f.key === 'residual-dropout-placement').text += '作者这样安排是为了控制过拟合。';
  assert.throws(() => bindDraftParagraphs(blocks, unsupportedAnalysis),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  const visible = blocks.map(({ findingKeys, ...b }) => b);
  assert.deepEqual(bindDraftParagraphs(visible, evidencePack, { normalized: true, bindings }), bindings);
  const bad = structuredClone(blocks);
  delete bad[0].findingKeys;
  assert.throws(() => bindDraftParagraphs(bad, evidencePack), { code: 'AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID' });
  bad[0].findingKeys = ['invented-claim'];
  assert.throws(() => bindDraftParagraphs(bad, evidencePack), { code: 'AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID' });
  bad[0].findingKeys = [blocks[0].findingKeys[0], blocks[0].findingKeys[0]];
  assert.throws(() => bindDraftParagraphs(bad, evidencePack), { code: 'AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID' });
  bad[0].findingKeys = blocks[1].findingKeys;
  assert.throws(() => bindDraftParagraphs(bad, evidencePack), { code: 'AGENT_PAPER_ARTICLE_FINDING_COVERAGE_INSUFFICIENT' });
  const forged = structuredClone(bindings);
  forged[0].evidence[0].pages = [999];
  assert.throws(() => bindDraftParagraphs(visible, evidencePack, { normalized: true, bindings: forged }),
    { code: 'AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID' });
});

test('recorded third live extraction stays blocked while spatial-flow sentences are omitted from future safe excerpts', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-expanded-live-context-rejection-v1.json')));
  const { textOnlyDraftExcerpt, assertTextOnlyDraftFindingContext } = await load('agent-paper-text-draft.mjs');
  const { createAgentPaperSemanticHandlers } = await load('agent-paper-semantic-runtime.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const before = structuredClone(live);
  assert.equal(live.recordedReceipts.length, 1);
  assert.equal(live.recordedReceipts[0].stage, 'extract-semantics');
  assert.equal(live.extraction.findings.length, 21);
  const affected = live.sourceEvidence.find(e => e.index === 9);
  assert.match(affected.quoteText, /leftward information flow/u);
  assert.match(affected.providerExcerpt, /leftward information flow/u);
  const safe = textOnlyDraftExcerpt(affected.quoteText);
  assert.doesNotMatch(safe, /leftward|rightward/iu);
  assert.match(safe, /up to and including that position/u);
  assert.equal(stableHash(affected.quoteText), affected.quoteHash);
  assert.equal(textOnlyDraftExcerpt('Authors describe self-attention. We prevent rightward information flow in the decoder. Authors describe queries and values.'),
    'Authors describe self-attention. Authors describe queries and values.');
  assert.throws(() => assertTextOnlyDraftFindingContext(live.extraction.findings, live.sourceEvidence),
    { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
  const spatial = live.extraction.findings.filter(f => /向左|向右|信息流/u.test(f.text));
  assert.ok(spatial.length);
  assert.throws(() => assertTextOnlyDraftFindingContext(spatial, live.sourceEvidence), { code: live.expectedErrorCode });

  const source = { schemaVersion: 'paper-semantic-source-v1',
    paperVersionId: randomUUID(), evidence: live.sourceEvidence, readingScope: live.readingScope,
    identity: { title: 'Attention Is All You Need' }, externalProcessingClass: 'public-arxiv-open-fulltext',
    contentSha256: live.sourceSha256, layoutSha256: live.readingScope.layoutSha256,
    parseAssessmentSha256: live.readingScope.parseAssessmentSha256,
    evidenceManifestSha256: stableHash(live.sourceEvidence.map(({ index, id, quoteHash }) => ({ index, id, quoteHash }))) };
  let saved = false, replayReads = 0;
  const handlers = createAgentPaperSemanticHandlers({ repository: { loadTrustedPaper: async () => source },
    semanticGateway: {}, artifactRepository: { async save() { saved = true; throw Error('INVALID_EXTRACTION_MUST_NOT_BE_SAVED'); } },
    providerGateway: { async invoke(request) {
      replayReads += 1;
      const payload = JSON.parse(request.request.messages[1].content);
      assert.doesNotMatch(payload.evidence.find(e => e.evidenceIndex === 9).quoteText, /leftward|rightward/iu);
      return { status: 'succeeded', output: live.extraction };
    } } });
  const input = { schemaVersion: 'paper-semantic-run-input-v1', paperVersionId: source.paperVersionId, purpose: 'private-research' };
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input, inputSha256: stableHash(input) },
    stage: { id: randomUUID() }, prerequisites: [] };
  const eligible = await handlers['paper.single.semantic-shadow:verify-eligibility'](context, {});
  const sections = await handlers['paper.single.semantic-shadow:reconstruct-sections']({ ...context,
    prerequisites: [{ stageKey: 'verify-eligibility', status: 'succeeded', outputRef: eligible.outputRef }] }, {});
  await assert.rejects(handlers['paper.single.semantic-shadow:extract-semantics']({ ...context,
    prerequisites: [{ stageKey: 'reconstruct-sections', status: 'succeeded', outputRef: sections.outputRef }] }, {}),
  { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
  assert.equal(saved, false);
  assert.equal(replayReads, 1);
  assert.deepEqual(live, before);
});

test('safe excerpts omit anaphoric conclusions whose measured premise was removed but keep supported continuations', async () => {
  const { textOnlyDraftExcerpt: excerpt } = await load('agent-paper-text-draft.mjs');
  assert.equal(excerpt('The measured score reached 91%. These results establish reliability. This supports deployment. Authors define a query as a vector.'),
    'Authors define a query as a vector.');
  assert.equal(excerpt('continued result fragment. This establishes reliability. Authors define a query as a vector.'),
    'Authors define a query as a vector.');
  assert.equal(excerpt('Our experiments have shown the method is reliable. As a result, deployment is justified. Authors define a key as a vector.'),
    'Authors define a key as a vector.');
  assert.equal(excerpt('Authors define query vectors. This links queries to keys.'),
    'Authors define query vectors. This links queries to keys.');
});

test('purpose grounding requires positive support for the same method rather than a matching topic word', async () => {
  const { assertSupportedDraftExplanations: check } = await load('agent-paper-text-draft.mjs');
  const claim = '作者使用 dropout 控制过拟合。';
  for (const support of [
    'Authors mention overfitting.',
    'Authors have not evaluated whether dropout prevents overfitting.',
    'Dropout might reduce overfitting.',
    'Data augmentation prevents overfitting. Authors apply dropout to embeddings.',
  ]) assert.throws(() => check(claim, support), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' }, support);
  check(claim, 'Authors use dropout to prevent overfitting.');
  check('作者提到了过拟合问题。', 'Authors mention overfitting.');
});

test('excluded source material cannot satisfy the minimum usable narrative budget', async () => {
  const archived = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-text-draft-eval-v1.json')));
  const { selectTextOnlyDraftEvidence, isNarrativeDraftEvidence, textOnlyDraftExcerpt } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const safe = 'Authors describe a query as a vector and define how the model relates it to keys and values. Authors discuss how information moves between the components of their proposed architecture.';
  const quoteText = safe + ' The method has significant performance limitations.'.repeat(20);
  const items = archived.evidence.slice(0, 2).map(e => ({ ...e, quoteText, quoteHash: stableHash(quoteText) }));
  assert.ok(items.every(isNarrativeDraftEvidence));
  assert.ok(items.reduce((n, e) => n + e.quoteText.length, 0) > 1200);
  assert.ok(items.reduce((n, e) => n + textOnlyDraftExcerpt(e.quoteText).length, 0) < 1200);
  assert.throws(() => selectTextOnlyDraftEvidence(items, archived.paper), { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
});

test('recorded fourth live draft stays rejected for summary, body length, repeated prose and component omissions', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-expanded-live-bound-short-v1.json')));
  const { createAgentPaperArticleGenerationHandlers, validatePaperArticleEvidencePack } =
    await load('agent-paper-article-generation.mjs');
  const { bindDraftParagraphs } = await load('agent-paper-draft-grounding.mjs');
  validatePaperArticleEvidencePack(live.evidencePack);
  // A newly detected unsupported auxiliary-role explanation precedes the
  // historical component omission; keep the captured output unchanged.
  assert.throws(() => bindDraftParagraphs(live.composition.blocks, live.evidencePack),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  assert.equal(live.composition.blocks.filter(b => b.type === 'paragraph').length, 13);
  assert.equal(new Set(live.composition.blocks.flatMap(b => b.findingKeys ?? [])).size, 20);
  assert.equal(Array.from(live.composition.summary).length, 518);
  assert.equal(live.composition.blocks.filter(b => b.type === 'paragraph')
    .reduce((n, b) => n + Array.from(b.text).length, 0), 2405);
  assert.equal(live.recordedReceipts.length, 2);
  let output = live.composition, saved = false;
  const handlers = createAgentPaperArticleGenerationHandlers({
    providerGateway: { async invoke(request) {
      assert.match(request.request.messages[0].content, /二十至三百六十字/u);
      assert.match(request.request.messages[0].content, /标题、摘要、引用和 findingKeys 都不计入正文篇幅/u);
      return { output };
    } }, artifactRepository: {
      async readToolArtifact() { return { content: live.evidencePack }; },
      async save() { saved = true; throw Error('BLOCKED_DRAFT_MUST_NOT_BE_SAVED'); },
    },
  });
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_ARTICLE_SUMMARY_INVALID' });
  output = structuredClone(live.composition);
  output.summary = '论文介绍完全依赖注意力的序列转换模型，说明各个部件的来源与访问范围。';
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: live.expectedErrorCode });
  // A diagnostic copy that only adds words still must not pass. Keep the real
  // output unchanged; declared bindings alone do not establish factual quality.
  output = structuredClone(output);
  output.blocks.find(b => b.type === 'paragraph').text += '作者提出完全依赖注意力机制来建立输入与输出之间的全局依赖。'.repeat(5);
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_LIMITATIONS' });
  assert.equal(saved, false);
});

test('cross-component comparisons require each named attention component rather than a generic or unrelated claim', async () => {
  const { evidencePack, composition } = JSON.parse(fs.readFileSync(path.join(__dirname,
    'fixtures/paper-expanded-live-bound-short-v1.json')));
  const { assertDraftComponentBindings: check } = await load('agent-paper-draft-grounding.mjs');
  const byKey = new Map(evidencePack.findings.map(f => [f.key, f]));
  const cross = byKey.get('encoder-decoder-attention-sources');
  const decoder = byKey.get('decoder-self-attention-scope');
  const encoder = byKey.get('encoder-self-attention-scope');
  const mapping = byKey.get('attention-function-mapping');
  const actual = composition.blocks.find(b => b.text?.includes('与解码器自注意力不同'));
  assert.throws(() => check(actual.text, [cross]), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  assert.throws(() => check(actual.text, [cross, mapping]), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  check(actual.text, [cross, decoder]);
  check('作者分别说明编码器自注意力、解码器自注意力和编码器—解码器注意力。', [encoder, decoder, cross]);
  assert.throws(() => check('作者说明编码器和解码器各自的自注意力。', [decoder]),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  check('作者说明编码器和解码器各自的自注意力。', [encoder, decoder]);
  check('作者说明编码器—解码器注意力与解码器自注意力不同。', [cross, decoder]);
});

test('editorially revised long draft passes compose and verify while summary and component regressions stay blocked', async () => {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-bound-short-v1.json')));
  const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-reviewed-composition-v1.json')));
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { TEXT_DRAFT_NOTICE } = await load('agent-paper-text-draft.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  assert.equal(reviewed.captureKind, 'local-editorial-revision-for-regression');
  assert.equal(reviewed.notANewProviderResponse, true);
  const before = structuredClone(reviewed), memory = new Map();
  let output = structuredClone(reviewed.composition);
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke() {
    return { output, actionId: randomUUID() };
  } }, artifactRepository: {
    async readToolArtifact() { return { content: base.evidencePack }; },
    async save(value) { const row = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) };
      memory.set(row.id, row); return row; },
    async read({ artifactId }) { return memory.get(artifactId); },
  } });
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  const composed = await handlers['paper.article.draft-shadow:compose'](context, {});
  const artifact = memory.get(composed.outputRef.artifactId);
  assert.equal(artifact.content.bodyCharacters, 3057);
  assert.equal(artifact.content.paragraphEvidenceBindings.length, 19);
  assert.equal(new Set(artifact.content.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, 20);
  assert.equal(artifact.content.content.blocks[0].text, TEXT_DRAFT_NOTICE);
  const verifyContext = { ...context, prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] };
  const result = await handlers['paper.article.draft-shadow:verify'](verifyContext, {});
  assert.equal(memory.get(result.outputRef.artifactId).content.manualReviewRequired, true);
  assert.equal(memory.get(result.outputRef.artifactId).content.publicPublicationEnabled, false);
  const validSummary = artifact.content.content.summary;
  artifact.content.content.summary = base.composition.summary;
  await assert.rejects(handlers['paper.article.draft-shadow:verify'](verifyContext, {}),
    { code: 'AGENT_PAPER_ARTICLE_SUMMARY_INVALID' });
  artifact.content.content.summary = validSummary;
  const target = reviewed.composition.blocks.findIndex(b => b.text?.includes('与解码器自注意力截至当前位置'));
  assert.ok(target >= 0);
  const binding = artifact.content.paragraphEvidenceBindings.find(b => b.blockIndex === target);
  const originalKeys = binding.findingKeys;
  binding.findingKeys = ['encoder-decoder-attention-sources'];
  await assert.rejects(handlers['paper.article.draft-shadow:verify'](verifyContext, {}),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  binding.findingKeys = originalKeys;
  assert.deepEqual(reviewed, before);
});

test('fifth real response exposes four separate editorial failures without changing or recalling the provider', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-review-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertDraftSectionRepetition, assertDraftFunctionBinding } = await load('agent-paper-draft-grounding.mjs');
  const { assertTextOnlyDraftProseClarity } = await load('agent-paper-text-draft.mjs');
  assert.equal(live.originalAutomaticStatus, 'generated-awaiting-human-review');
  assert.equal(live.recordedReceipts.length, 2);
  assert.throws(() => assertDraftSectionRepetition(live.composition.blocks),
    { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP' });
  const reversed = live.composition.blocks.find(b => b.text?.includes('前者关注的是注意力函数'));
  assert.throws(() => assertTextOnlyDraftProseClarity(reversed.text),
    { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
  const unsupported = live.composition.blocks.find(b => b.text?.includes('文中并没有说循环网络本身有什么问题'));
  assert.throws(() => assertTextOnlyDraftProseClarity(unsupported.text),
    { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  const missing = live.composition.blocks.find(b => b.text?.startsWith('将计算形式与来源放在一起'));
  const bound = missing.findingKeys.map(k => live.evidencePack.findings.find(f => f.key === k));
  assert.throws(() => assertDraftFunctionBinding(missing.text, bound),
    { code: 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE' });
  assertDraftFunctionBinding(missing.text, [...bound,
    live.evidencePack.findings.find(f => f.key === 'attention-function-maps-query-keyvalue')]);
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  let saved = false;
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: {
    async invoke() { return { output: live.composition }; },
  }, artifactRepository: {
    async readToolArtifact() { return { content: live.evidencePack }; },
    async save() { saved = true; throw Error('REJECTED_RESPONSE_MUST_NOT_BE_SAVED'); },
  } });
  await assert.rejects(handlers['paper.article.draft-shadow:compose']({
    run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }],
  }, {}), { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  assert.equal(saved, false);
  assert.deepEqual(live, before);
});

test('clarity guards reject ambiguous order and source-absence claims while preserving structural negation', async () => {
  const { assertTextOnlyDraftProseClarity: check } = await load('agent-paper-text-draft.mjs');
  for (const text of ['作者把前者组织成矩阵，后者说明函数类别。', '论文将后者作为基本计算形式。']) {
    assert.throws(() => check(text), { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
  }
  for (const text of ['文中并没有说循环网络本身有什么问题。', '论文未讨论循环网络的问题。',
    '原文没有提供设计目的。', '作者并未解释这些来源差异之外的因果。', '论文没有在这些主张之间额外说明因果。']) {
    assert.throws(() => check(text), { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  }
  check('作者说明模型不含循环和卷积，论文把注意力作为主要结构。');
  check('论文并没有只用一个注意力名称代替所有细节。');
  check('文中并未在本次可见范围内说明这些组成部分的运作方式。');
  assert.throws(() => check('文中并未在本次可见范围内说明这些组成部分。论文没有讨论这些问题。'),
    { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  check('作者将查询、键和值打包成矩阵，论文另行列出注意力函数类别。');
});

test('recap detection distinguishes repeated section inventories from shared terms and a useful single recap', async () => {
  const { assertDraftSectionRepetition: check } = await load('agent-paper-draft-grounding.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-review-rejection-v1.json')));
  const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-reviewed-composition-v1.json')));
  check(reviewed.composition.blocks);
  // One recap is permitted; multiple recurring inventories are held for revision.
  check(live.composition.blocks.slice(4, 8));
  const paragraph = reviewed.composition.blocks.find(b => b.type === 'paragraph');
  assert.throws(() => check([paragraph, structuredClone(paragraph)]),
    { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP' });
});

test('compose and verify enforce every new editorial guard and retain a valid private-only path', async () => {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-bound-short-v1.json')));
  const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-reviewed-composition-v1.json')));
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  let output = structuredClone(reviewed.composition), saves = 0;
  const memory = new Map();
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke(request) {
    assert.equal(request.promptTemplate.version, 14);
    assert.match(request.request.messages[0].content, /未选入证据不代表论文未讨论/u);
    assert.match(request.request.messages[0].content, /一节不再增加汇总全组主张的段落/u);
    assert.match(request.request.messages[0].content, /整篇已经覆盖某个 key 不能代替本段绑定/u);
    assert.match(request.request.messages[0].content, /不用循环结构描述的是内部架构，不等于非自回归生成/u);
    assert.match(request.request.messages[0].content, /每段至少一次用作者、论文或文中标明归属/u);
    assert.match(request.request.messages[0].content, /developmentTasks 是内部构思提示，不是正文句式/u);
    assert.match(request.request.messages[0].content, /写“与前文掩蔽相配合”，就追加掩蔽主张/u);
    assert.match(request.request.messages[0].content, /组件预告也属于本段内容/u);
    assert.match(request.request.messages[0].content, /每节和每段的 minimumCharacters 是总下限的分配/u);
    const payload = JSON.parse(request.request.messages[1].content);
    assert.ok(payload.claimBindingGuide.some(entry => entry.topic === 'layer-specific-parameters'));
    assert.ok(payload.claimBindingGuide.some(entry => entry.topic === 'decoder-masking' && entry.requiredWhen));
    assert.ok(payload.comparisonBindingGuide.some(group => group.topics.includes('encoder-self-attention')
      && group.topics.includes('decoder-self-attention') && group.claimOptionsByTopic.length === 2));
    return { output };
  } }, artifactRepository: {
    async readToolArtifact() { return { content: base.evidencePack }; },
    async save(value) { saves++; const row = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) };
      memory.set(row.id, row); return row; },
    async read({ artifactId }) { return memory.get(artifactId); },
  } });
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  const composed = await handlers['paper.article.draft-shadow:compose'](context, {});
  const artifact = memory.get(composed.outputRef.artifactId);
  const original = structuredClone(artifact.content);
  const verifyContext = { ...context, prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] };
  const definitionIndex = reviewed.composition.blocks.findIndex(b => b.text?.includes('注意力函数把查询'));
  assert.ok(definitionIndex >= 0);
  const unrelatedKeys = reviewed.composition.blocks[1].findingKeys;
  for (const [code, mutate] of [
    ['AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE', blocks => { blocks[1].text += '作者称前者处理输入，后者处理输出。'; }],
    ['AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED', blocks => { blocks[1].text += '论文没有讨论循环网络的问题。'; }],
    ['AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED', blocks => { blocks[1].text += '作者未在此处展开计算细节。'; }],
    ['AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP', blocks => { blocks.splice(2, 0, structuredClone(blocks[1])); }],
    ['AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE', blocks => { blocks[definitionIndex].findingKeys = [...unrelatedKeys]; }],
    ['AGENT_PAPER_ARTICLE_PARAMETER_BINDING_INCOMPLETE', blocks => {
      blocks.find(b => b.text?.startsWith('在输出端')).text += '论文同时说明前馈网络不同层使用不同参数。';
    }],
    ['AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION', blocks => {
      blocks[1].text += '这意味着模型不再按顺序逐步处理序列。';
    }],
    ['AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE', blocks => {
      blocks[definitionIndex].text += '论文这里回顾前文掩蔽的安排。';
    }],
    ['AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE', blocks => {
      blocks[definitionIndex].text += '论文的模型采用无循环架构。';
    }],
    ['AGENT_PAPER_ARTICLE_REPETITIVE_NARRATION', blocks => {
      for (const block of blocks.filter(b => b.type === 'paragraph').slice(0, 10)) {
        block.text += '这一主张描述的是模型中的相关安排。';
      }
    }],
  ]) {
    output = structuredClone(reviewed.composition); mutate(output.blocks);
    const savedBefore = saves;
    await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code });
    assert.equal(saves, savedBefore);
    artifact.content = structuredClone(original);
    if (code === 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE') {
      artifact.content.paragraphEvidenceBindings.find(b => b.blockIndex === definitionIndex).findingKeys = [...unrelatedKeys];
    } else {
      const raw = structuredClone(reviewed.composition.blocks); mutate(raw);
      artifact.content.content.blocks = [original.content.blocks[0], ...raw.map(b => {
        if (b.type === 'heading') return b;
        const { findingKeys, citationIndexes, ...prose } = b;
        return { ...prose, citationIds: [original.content.citations[0].id] };
      }), ...original.content.blocks.slice(-2)];
    }
    await assert.rejects(handlers['paper.article.draft-shadow:verify'](verifyContext, {}), { code });
  }
  artifact.content = structuredClone(original);
  const result = await handlers['paper.article.draft-shadow:verify'](verifyContext, {});
  const proof = memory.get(result.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
});

test('sixth real draft stays blocked despite improved prose because its title and paragraph bindings are invalid', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-title-binding-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertDraftComponentBindings, assertDraftFunctionBinding, assertDraftSectionRepetition } =
    await load('agent-paper-draft-grounding.mjs');
  const { assertTextOnlyDraftProseClarity } = await load('agent-paper-text-draft.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  assert.equal(live.recordedReceipts.length, 2);
  assert.equal(Array.from(live.composition.summary).length, 136);
  assert.equal(live.composition.blocks.filter(b => b.type === 'paragraph')
    .reduce((n, b) => n + Array.from(b.text).length, 0), 2830);
  assertDraftSectionRepetition(live.composition.blocks);
  for (const block of live.composition.blocks) assertTextOnlyDraftProseClarity(block.text);
  for (const issue of live.reviewIssues.filter(i => i.blockIndex !== undefined)) {
    const block = live.composition.blocks[issue.blockIndex];
    const claims = block.findingKeys.map(key => live.evidencePack.findings.find(f => f.key === key));
    const check = issue.code === 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE'
      ? assertDraftFunctionBinding : assertDraftComponentBindings;
    assert.throws(() => check(block.text, claims), { code: issue.code });
  }
  let output = live.composition, saved = false;
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: {
    async invoke() { return { output }; },
  }, artifactRepository: {
    async readToolArtifact() { return { content: live.evidencePack }; },
    async save() { saved = true; throw Error('REJECTED_RESPONSE_MUST_NOT_BE_SAVED'); },
  } });
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: live.expectedErrorCode });
  // A diagnostic title correction cannot mask the independent binding errors.
  output = structuredClone(live.composition);
  output.title = '只靠注意力搭起来的模型：拆解论文的核心思路';
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  assert.equal(saved, false);
  assert.deepEqual(live, before);
});

test('real parameter comparison needs both layer-specific and embedding-sharing claims, independent of key names', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-title-binding-rejection-v1.json')));
  const { assertDraftParameterBindings: check, draftClaimBindingGuide } = await load('agent-paper-draft-grounding.mjs');
  const paragraph = live.composition.blocks.find(b => b.text?.startsWith('在嵌入与输出端'));
  const byKey = new Map(live.evidencePack.findings.map(f => [f.key, f]));
  const shared = byKey.get('shared-weight-matrix'), layers = byKey.get('feed-forward-layer-parameters');
  assert.throws(() => check(paragraph.text, [shared]),
    { code: 'AGENT_PAPER_ARTICLE_PARAMETER_BINDING_INCOMPLETE' });
  assert.throws(() => check(paragraph.text, [layers]),
    { code: 'AGENT_PAPER_ARTICLE_PARAMETER_BINDING_INCOMPLETE' });
  check(paragraph.text, [shared, layers]);
  const renamed = live.evidencePack.findings.map((f, i) => ({ ...f, key: `independent-claim-${i}` }));
  const before = structuredClone(renamed), guide = draftClaimBindingGuide(renamed);
  for (const entry of guide) assert.ok(entry.findingKeys.every(key => renamed.some(f => f.key === key)));
  assert.equal(guide.find(g => g.topic === 'layer-specific-parameters').findingKeys.length, 1);
  assert.equal(guide.find(g => g.topic === 'shared-embedding-output-weights').findingKeys.length, 1);
  assert.equal(guide.find(g => g.topic === 'attention-function-mapping').findingKeys.length, 1);
  check(paragraph.text, renamed.filter(f => [shared.text, layers.text].includes(f.text)));
  check('作者说明不同位置分别应用相同的前馈网络。', []);
  assert.deepEqual(renamed, before);
});

test('architecture and generation guard rejects unsupported sequential denial while preserving cautious and sourced statements', async () => {
  const { assertDraftGenerationDistinction: check } = await load('agent-paper-text-draft.mjs');
  const architecture = '作者提出一种架构，摒弃循环结构，完全依赖注意力机制。';
  for (const text of [
    '作者提出无循环模型。这意味着模型不再按顺序逐步处理序列。',
    '作者说明无循环架构是非自回归模型。',
    '论文中的模型无需逐步生成输出。',
    '作者说明生成过程没有先后步骤。',
    '论文说明训练后的模型无需逐步生成符号。',
  ]) assert.throws(() => check(text, architecture), { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' }, text);
  check('论文的无循环架构并不意味着非自回归。', architecture);
  check('作者不能把无循环架构理解成模型不再逐步生成。', architecture);
  check('作者说明模型在训练时不再按顺序逐步处理序列。', architecture);
  check('作者说明编码器模型不必逐步处理序列。', architecture);
  check('作者说明模型在生成下一个符号时使用此前生成的符号。', architecture);
  check('作者提出一种非自回归模型。', 'The authors introduce a non-autoregressive model.');
  assert.throws(() => check('作者提出一种非自回归模型。', '作者说明无循环不等于非自回归。'),
    { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' });
  for (const support of ['This is not a non-autoregressive model.', 'The model might be non-autoregressive.',
    '作者认为这可能是一种非自回归模型。', '作者说明这不是一种非自回归模型。']) {
    assert.throws(() => check('作者提出一种非自回归模型。', support),
      { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' });
  }
  assert.throws(() => check('作者不能把无循环架构理解成非自回归。作者说明模型不再逐步生成。', architecture),
    { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' });
});

test('seventh actual response independently exposes insufficient development, attribution, binding, reference and generation errors', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-generation-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertDraftGenerationDistinction, assertTextOnlyDraftComposition, assertTextOnlyDraftProseClarity,
    assertTextOnlyDraftFindingContext } = await load('agent-paper-text-draft.mjs');
  const { assertDraftComponentBindings } = await load('agent-paper-draft-grounding.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const paragraphs = live.composition.blocks.filter(b => b.type === 'paragraph');
  assert.equal(paragraphs.reduce((n, b) => n + Array.from(b.text).length, 0), 1759);
  assert.equal(new Set(paragraphs.flatMap(b => b.findingKeys)).size, live.evidencePack.findings.length);
  const byKey = new Map(live.evidencePack.findings.map(f => [f.key, f]));
  const wrong = paragraphs.find(b => b.text.includes('模型不再按顺序逐步处理序列'));
  assert.throws(() => assertDraftGenerationDistinction(wrong.text, wrong.findingKeys.map(k => byKey.get(k).text).join('。')),
    { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' });
  // The same inference cannot enter through a newly extracted semantic claim.
  const originalClaim = byKey.get(wrong.findingKeys[0]);
  assert.throws(() => assertTextOnlyDraftFindingContext([{ ...originalClaim, text: wrong.text }], live.evidencePack.evidence),
    { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' });
  const missingAuthor = paragraphs.filter(b => !/作者|论文|文中/u.test(b.text));
  assert.equal(missingAuthor.length, 1);
  assert.throws(() => assertTextOnlyDraftComposition({ ...live.composition, blocks: missingAuthor }),
    { code: 'AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT' });
  const compared = paragraphs.find(b => b.text.includes('这一范围与编码器自注意力不同'));
  assert.throws(() => assertDraftComponentBindings(compared.text, compared.findingKeys.map(k => byKey.get(k))),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  assertDraftComponentBindings(compared.text, [...compared.findingKeys.map(k => byKey.get(k)), byKey.get('encoder-self-attention-scope')]);
  assert.throws(() => assertTextOnlyDraftProseClarity(paragraphs.find(b => b.text.includes('前者')).text),
    { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
  let output = live.composition, saved = false;
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke() { return { output }; } },
    artifactRepository: { async readToolArtifact() { return { content: live.evidencePack }; },
      async save() { saved = true; throw Error('REJECTED_RESPONSE_MUST_NOT_BE_SAVED'); } } });
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: live.expectedErrorCode });
  // Attribution alone cannot make the short output pass. Never edit the capture.
  output = structuredClone(live.composition);
  for (const b of output.blocks.filter(b => b.type === 'paragraph')) if (!/作者|论文|文中/u.test(b.text)) b.text = '作者说明，' + b.text;
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_ARTICLE_LENGTH_INVALID' });
  assert.equal(saved, false);
  assert.deepEqual(live, before);
});

test('eighth real response rejects all three omissions and a local binding-only copy passes compose and verify', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-function-binding-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertTextOnlyDraftComposition, assertTextOnlyDraftProseClarity, assertDraftGenerationDistinction } =
    await load('agent-paper-text-draft.mjs');
  const { assertDraftSectionRepetition, assertDraftFunctionBinding } = await load('agent-paper-draft-grounding.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  assert.equal(live.recordedReceipts.length, 2);
  assert.equal(live.composition.blocks.filter(b => b.type === 'paragraph')
    .reduce((n, b) => n + Array.from(b.text).length, 0), 2761);
  assert.equal(Array.from(live.composition.summary).length, 114);
  assertTextOnlyDraftComposition(live.composition);
  assertDraftSectionRepetition(live.composition.blocks);
  for (const block of live.composition.blocks) {
    assertTextOnlyDraftProseClarity(block.text);
    if (block.type === 'paragraph') assertDraftGenerationDistinction(block.text,
      block.findingKeys.map(key => live.evidencePack.findings.find(f => f.key === key).text).join('。'));
  }
  const paragraph = live.composition.blocks.find(b => b.text?.includes('无论采用加性形式还是点积形式'));
  const claims = paragraph.findingKeys.map(key => live.evidencePack.findings.find(f => f.key === key));
  assert.throws(() => assertDraftFunctionBinding(paragraph.text, claims),
    { code: 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE' });
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  let output = live.composition;
  const memory = new Map();
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke() { return { output }; } },
    artifactRepository: { async readToolArtifact() { return { content: live.evidencePack }; },
      async save(value) { const row = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) };
        memory.set(row.id, row); return row; }, async read({ artifactId }) { return memory.get(artifactId); } } });
  const context = {
    run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }],
  };
  // The new earlier callback check detects the architecture omission before
  // reaching the function omission originally captured by the live run.
  assert.equal(live.expectedErrorCode, 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE');
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  assert.equal(memory.size, 0);
  output = structuredClone(live.composition);
  const fixes = [
    ['与架构主张相配套', 'propose-transformer-eschewing-recurrence', 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE'],
    ['无论采用加性形式还是点积形式', 'attention-function-mapping', 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE'],
  ];
  for (const [phrase, key, code] of fixes) {
    output.blocks.find(b => b.text?.includes(phrase)).findingKeys.push(key);
    await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code });
    assert.equal(memory.size, 0);
  }
  output.blocks.find(b => b.text?.includes('这一范围限定与前面提到的掩蔽主张')).findingKeys.push('decoder-masking-scope');
  const composed = await handlers['paper.article.draft-shadow:compose'](context, {});
  const artifact = memory.get(composed.outputRef.artifactId);
  assert.equal(artifact.content.bodyCharacters, 2761);
  const verifyContext = { ...context, prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] };
  const pristine = structuredClone(artifact.content);
  for (const [phrase, key, code] of [...fixes.map(([phrase, key]) => [phrase, key,
    key === 'attention-function-mapping' ? 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE' : 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE']),
    ['这一范围限定与前面提到的掩蔽主张', 'decoder-masking-scope', 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE']]) {
    artifact.content = structuredClone(pristine);
    const blockIndex = output.blocks.findIndex(b => b.text?.includes(phrase));
    const binding = artifact.content.paragraphEvidenceBindings.find(b => b.blockIndex === blockIndex);
    binding.findingKeys = binding.findingKeys.filter(k => k !== key);
    await assert.rejects(handlers['paper.article.draft-shadow:verify'](verifyContext, {}), { code });
  }
  artifact.content = structuredClone(pristine);
  const verified = await handlers['paper.article.draft-shadow:verify'](verifyContext, {});
  const proof = memory.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
  assert.deepEqual(live, before);
});

test('callback binding requirements use current paragraph claim content and survive renamed keys', async () => {
  const { assertDraftCallbackBindings: check, draftClaimBindingGuide } = await load('agent-paper-draft-grounding.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-function-binding-rejection-v1.json')));
  const renamed = live.evidencePack.findings.map((f, i) => ({ ...f, key: `new-key-${i}` }));
  const get = topic => {
    const guide = draftClaimBindingGuide(renamed).find(g => g.topic === topic);
    assert.ok(guide.requiredWhen);
    return renamed.filter(f => guide.findingKeys.includes(f.key));
  };
  const arch = get('recurrence-free-architecture'), generation = get('generation-order'), masking = get('decoder-masking');
  check('作者把无循环架构与自回归生成分开解释。', [...arch, ...generation]);
  assert.throws(() => check('作者把无循环架构与自回归生成分开解释。', generation),
    { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  assert.throws(() => check('作者把无循环架构与自回归生成分开解释。', arch),
    { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  assert.throws(() => check('作者回顾前述掩蔽安排。', []),
    { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  check('作者回顾前述掩蔽安排。', masking);
  check('论文接下来介绍方法的另一部分。', []);
});

test('comparison guide supplies both sides from this analysis without inventing keys or binding prose automatically', async () => {
  const { draftComparisonBindingGuide, assertDraftComponentBindings } = await load('agent-paper-draft-grounding.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-narration-rejection-v1.json')));
  const renamed = live.evidencePack.findings.map((f, i) => ({ ...f, key: `comparison-claim-${i}` }));
  const before = structuredClone(renamed), guide = draftComparisonBindingGuide(renamed);
  assert.ok(guide.length >= 5);
  for (const group of guide) {
    assert.equal(group.claimOptionsByTopic.length, 2);
    assert.deepEqual(group.claimOptionsByTopic.map(entry => entry.topic), group.topics);
    assert.ok(group.claimOptionsByTopic.every(entry => entry.findingKeys.length
      && entry.findingKeys.every(key => renamed.some(f => f.key === key))));
  }
  assert.deepEqual(draftComparisonBindingGuide([]), []);
  const paragraph = live.composition.blocks.find(b => b.text?.includes('与解码器自注意力层的局部访问范围形成对照'));
  const bound = paragraph.findingKeys.map(key => live.evidencePack.findings.find(f => f.key === key));
  assert.throws(() => assertDraftComponentBindings(paragraph.text, bound),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  assert.deepEqual(renamed, before);
});

test('narration gate rejects repeated writing labels while preserving isolated explanations and technical vocabulary', async () => {
  const { assertDraftNarrationStyle: check } = await load('agent-paper-draft-grounding.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-narration-rejection-v1.json')));
  const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-reviewed-composition-v1.json')));
  assert.throws(() => check(live.composition.blocks), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_NARRATION' });
  check(reviewed.composition.blocks);
  const repeated = { type: 'paragraph', text: '作者介绍自注意力。这一主张描述的是序列中各位置之间的联系。' };
  const plain = { type: 'paragraph', text: '作者说明编码器中的查询、键和值来自同一处，解码器中各位置的访问范围另有安排。' };
  check([repeated, plain, plain, plain]);
  check([...Array(3).fill(repeated), ...Array(5).fill(plain)]);
  assert.throws(() => check([...Array(4).fill(repeated), ...Array(4).fill(plain)]),
    { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_NARRATION' });
  check([...Array(4).fill(repeated), ...Array(5).fill(plain)]);
});

test('ninth captured response stays blocked for current-paragraph omissions, missing-source assertions and ambiguous references', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-narration-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertDraftComponentBindings, assertDraftCallbackBindings } = await load('agent-paper-draft-grounding.mjs');
  const { assertTextOnlyDraftProseClarity } = await load('agent-paper-text-draft.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  assert.equal(live.recordedReceipts.length, 2);
  assert.equal(live.composition.blocks.filter(b => b.type === 'paragraph')
    .reduce((n, b) => n + Array.from(b.text).length, 0), 3443);
  for (const issue of live.reviewIssues) {
    const block = live.composition.blocks[issue.blockIndex];
    const bound = block.findingKeys.map(key => live.evidencePack.findings.find(f => f.key === key));
    if (issue.code === 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE') {
      assert.throws(() => assertDraftComponentBindings(block.text, bound), { code: issue.code });
    } else if (issue.code === 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE') {
      assert.throws(() => assertDraftCallbackBindings(block.text, bound), { code: issue.code });
    } else assert.throws(() => assertTextOnlyDraftProseClarity(block.text), { code: issue.code });
  }
  // Declaring all claims across the article does not satisfy paragraph binding.
  assert.equal(new Set(live.composition.blocks.flatMap(b => b.findingKeys ?? [])).size, live.evidencePack.findings.length);
  let saved = false;
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke() { return { output: live.composition }; } },
    artifactRepository: { async readToolArtifact() { return { content: live.evidencePack }; },
      async save() { saved = true; throw Error('REJECTED_RESPONSE_MUST_NOT_BE_SAVED'); } } });
  await assert.rejects(handlers['paper.article.draft-shadow:compose']({
    run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }],
  }, {}), { code: live.expectedErrorCode });
  assert.equal(saved, false);
  assert.deepEqual(live, before);
});

test('expanded and detailed source-absence variants are rejected without blocking scoped archives or future plans', async () => {
  const { assertTextOnlyDraftProseClarity: check } = await load('agent-paper-text-draft.mjs');
  for (const text of ['作者未在此处展开计算细节。', '作者并未在此处展开两种函数的具体计算细节。',
    '论文没有详述计算细节。', '原文尚未阐述这种设计的作用。']) {
    assert.throws(() => check(text), { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  }
  check('作者未在本次可见范围内展开这些细节。');
  check('作者计划展开后续研究，论文将其作为未来方向。');
  assert.throws(() => check('作者未在本次可见范围内展开这些细节。原文没有详述计算方式。'),
    { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
});

test('tenth real response cannot pass by dropping its unsupported preview or fixing references while its body is short', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-preview-short-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertDraftComponentBindings } = await load('agent-paper-draft-grounding.mjs');
  const { assertTextOnlyDraftProseClarity } = await load('agent-paper-text-draft.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  assert.equal(live.recordedReceipts.length, 2);
  assert.equal(live.composition.blocks.filter(b => b.type === 'paragraph')
    .reduce((n, b) => n + Array.from(b.text).length, 0), 2305);
  const paragraph = live.composition.blocks.find(b => b.text?.includes('这一描述为后文区分'));
  const bound = paragraph.findingKeys.map(key => live.evidencePack.findings.find(f => f.key === key));
  assert.throws(() => assertDraftComponentBindings(paragraph.text, bound),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  // Omitting an unnecessary preview is a legitimate editorial alternative to
  // introducing and binding three more components in this definition paragraph.
  const concise = paragraph.text.slice(0, paragraph.text.indexOf('这一描述为后文区分'));
  assertDraftComponentBindings(concise, bound);
  const category = live.composition.blocks.find(b => b.text?.includes('后者也被称为乘性注意力'));
  assert.throws(() => assertTextOnlyDraftProseClarity(category.text), { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
  assert.throws(() => assertTextOnlyDraftProseClarity(category.text.replace('后者', '点积注意力')),
    { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  let output = live.composition, saved = false;
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke() { return { output }; } },
    artifactRepository: { async readToolArtifact() { return { content: live.evidencePack }; },
      async save() { saved = true; throw Error('REJECTED_RESPONSE_MUST_NOT_BE_SAVED'); } } });
  const context = { run: { workflowVersion: 3, id: randomUUID(), agentUserId: randomUUID(), input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: live.expectedErrorCode });
  output = structuredClone(live.composition);
  output.blocks.find(b => b.text?.includes('这一描述为后文区分')).text = concise;
  output.blocks.find(b => b.text?.includes('后者也被称为乘性注意力')).text =
    '论文指出最常用的两种注意力函数是加性注意力与点积注意力，点积注意力也被称为乘性注意力。';
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}), { code: 'AGENT_PAPER_ARTICLE_LENGTH_INVALID' });
  assert.equal(saved, false);
  assert.deepEqual(live, before);
});
