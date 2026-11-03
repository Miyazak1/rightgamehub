const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../apps/api/src', name)));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-editorial-v1.json')));
const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', fixture.sourceFixture))).evidencePack;

async function harness(mutate = () => {}, { evidencePack = evidence, responses = fixture.responses } = {}) {
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const plans = buildPaperArticleSectionPlans(evidencePack), artifacts = new Map(), cache = new Map(), requests = [];
  const context = { run: { id: randomUUID(), agentUserId: randomUUID(), workflowVersion: 4, input: {} },
    stage: { id: randomUUID() }, prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded',
      outputRef: { artifactIds: [randomUUID()] } }] };
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke(request) {
    requests.push(request);
    if (cache.has(request.idempotencyKey)) return structuredClone(cache.get(request.idempotencyKey));
    assert.equal(request.responseSchema.key, 'paper.article.section');
    assert.equal(request.tokenCeiling, 2400);
    const payload = JSON.parse(request.request.messages[1].content);
    const i = plans.findIndex(p => p.sectionKey === payload.sectionKey);
    assert.ok(i >= 0);
    assert.ok(payload.claims.every(c => !Object.hasOwn(c, 'findingKey')));
    assert.ok(payload.paragraphAssignments.every(p => p.primaryClaimIndexes.length
      && p.primaryClaimIndexes.every(index => payload.claims[index - 1].primary)));
    assert.equal(Object.hasOwn(payload, 'verifiedPaper'), false);
    assert.equal(Object.hasOwn(payload, 'previousBody'), false);
    const output = structuredClone(responses[i]);
    mutate(output, i, payload);
    const result = { status: 'succeeded', output, actionId: randomUUID() };
    cache.set(request.idempotencyKey, structuredClone(result));
    return result;
  } }, artifactRepository: {
    async readToolArtifact() { return { content: structuredClone(evidencePack) }; },
    async save(value) {
      const existing = [...artifacts.values()].find(a => a.artifactKey === value.artifactKey);
      const contentSha256 = stableHash(value.content);
      if (existing) {
        assert.equal(existing.contentSha256, contentSha256);
        return existing;
      }
      const row = { ...value, id: randomUUID(), contentSha256 };
      artifacts.set(row.id, row); return row;
    },
    async read({ artifactId, expectedArtifactKey }) {
      const row = artifacts.get(artifactId); assert.equal(row.artifactKey, expectedArtifactKey); return row;
    },
  } });
  return { plans, artifacts, requests, cache, context, handlers,
    compose: () => handlers['paper.article.draft-shadow:compose'](context, {}),
    verify: ref => handlers['paper.article.draft-shadow:verify']({ ...context,
      prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: ref }] }, {}) };
}

test('bounded sections use local indexes, preserve readable recorded prose and verify the merged private-only composition', async () => {
  const before = structuredClone(fixture), h = await harness();
  assert.equal(fixture.captureKind, 'local-editorial-binding-revision-not-new-provider');
  const composed = await h.compose(), article = h.artifacts.get(composed.outputRef.artifactId).content;
  assert.equal(h.requests.length, 5);
  assert.equal(new Set(h.requests.map(r => r.idempotencyKey)).size, 5);
  assert.equal(article.bodyCharacters, 2761);
  assert.equal(article.generationMode, 'bounded-sections-v1');
  assert.equal(article.sectionManifest.entries.length, 5);
  assert.equal(article.paragraphEvidenceBindings.length, 15);
  assert.ok(article.content.blocks.every(block => !Object.hasOwn(block, 'findingKeys')));
  const verified = await h.verify(composed.outputRef), proof = h.artifacts.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
  // Successful receipts are replayed, never regenerated on a compose retry.
  const replay = await h.compose();
  assert.deepEqual(replay, composed);
  assert.equal(h.cache.size, 5);
  assert.deepEqual(fixture, before);
});

test('section failure stops later model work and never creates a final article artifact', async () => {
  const h = await harness((response, i) => { if (i === 1) response.paragraphs[0].claimIndexes = [999]; });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_SECTION_REFERENCE_INVALID' });
  assert.equal(h.requests.length, 2);
  assert.deepEqual([...h.artifacts.values()].map(a => a.artifactKey), ['paper.article.section-01']);
  assert.equal([...h.artifacts.values()].some(a => a.artifactKey === 'blog.composition'), false);
});

test('a section cannot claim other sections by copying keys, string indexes or reference-only paragraphs', async () => {
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const plans = buildPaperArticleSectionPlans(evidence);
  const first = plans[0], last = plans.at(-1);
  assert.ok(!first.claims.some(c => last.primaryFindingKeys.includes(c.findingKey)));
  const cases = [
    ['AGENT_PAPER_ARTICLE_SECTION_SCHEMA_INVALID', r => { r.paragraphs[0].findingKeys = ['propose-transformer-eschering-recurrence']; }],
    ['AGENT_PAPER_ARTICLE_SECTION_REFERENCE_INVALID', r => { r.paragraphs[0].claimIndexes = ['1']; }],
    ['AGENT_PAPER_ARTICLE_SECTION_REFERENCE_INVALID', r => { r.paragraphs[0].claimIndexes = [1, 1]; }],
    ['AGENT_PAPER_ARTICLE_SECTION_REFERENCE_INVALID', r => { r.paragraphs[0].claimIndexes = [first.claims.length + 1]; }],
  ];
  for (const [code, mutate] of cases) {
    const response = structuredClone(fixture.responses[0]); mutate(response);
    assert.throws(() => validatePaperArticleSection(response, evidence, first), { code });
  }
  const response = structuredClone(fixture.responses[2]);
  const reference = plans[2].claims.find(c => !c.primary);
  response.paragraphs[0].claimIndexes = [reference.index];
  assert.throws(() => validatePaperArticleSection(response, evidence, plans[2]),
    { code: 'AGENT_PAPER_ARTICLE_SECTION_OWNERSHIP_INVALID' });
});

test('valid indexes cannot excuse cross-paragraph omissions or unsupported attention and dropout explanations', async () => {
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const plans = buildPaperArticleSectionPlans(evidence);
  const functions = structuredClone(fixture.responses[2]);
  const definition = plans[2].claims.find(c => c.findingKey === 'attention-function-mapping');
  functions.paragraphs[0].claimIndexes = functions.paragraphs[0].claimIndexes.filter(i => i !== definition.index);
  assert.throws(() => validatePaperArticleSection(functions, evidence, plans[2]),
    { code: 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE' });
  for (const text of ['作者说明注意力对值进行加权组合得到输出。', '作者用正则化控制训练过程。', '作者通过非线性运算形成输出。']) {
    const response = structuredClone(fixture.responses[0]); response.paragraphs[0].text += text;
    assert.throws(() => validatePaperArticleSection(response, evidence, plans[0]),
      { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  }
  const foreign = structuredClone(fixture.responses[0]); foreign.paragraphs[0].text += '作者还描述了 dropout 的位置。';
  assert.throws(() => validatePaperArticleSection(foreign, evidence, plans[0]),
    { code: 'AGENT_PAPER_ARTICLE_TOPIC_BINDING_INCOMPLETE' });
});

test('each section enforces repetition, primary coverage, attribution and direct references before proceeding', async () => {
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const plan = buildPaperArticleSectionPlans(evidence)[0];
  for (const [code, mutate] of [
    ['AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP', r => { r.paragraphs.forEach(p => { p.text = '作者提出注意力架构。'; }); }],
    ['AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT', r => { r.paragraphs[0].text = r.paragraphs[0].text.replaceAll('作者', '研究者').replaceAll('论文', '文章'); }],
    ['AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE', r => { r.paragraphs[0].text += '作者认为前者与后者有区别。'; }],
    ['AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED', r => { r.paragraphs[0].text += '作者未在此处展开计算细节。'; }],
    ['AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION', r => { r.paragraphs[0].text += '这意味着模型不再按顺序逐步处理序列。'; }],
  ]) {
    const response = structuredClone(fixture.responses[0]); mutate(response);
    assert.throws(() => validatePaperArticleSection(response, evidence, plan), { code });
  }
  const metadata = structuredClone(fixture.responses[0]); metadata.article.summary += '作者还使用 dropout。';
  assert.throws(() => validatePaperArticleSection(metadata, evidence, plan),
    { code: 'AGENT_PAPER_ARTICLE_TOPIC_BINDING_INCOMPLETE' });
});

test('merged verification rejects removed manifests, changed paragraphs and forged section artifacts', async () => {
  const h = await harness(), composed = await h.compose(), row = h.artifacts.get(composed.outputRef.artifactId);
  const original = structuredClone(row.content);
  delete row.content.sectionManifest;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
  row.content = structuredClone(original);
  row.content.content.blocks[2].text += '作者补充一个不同的解释。';
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
  row.content = structuredClone(original);
  row.content.content.blocks.at(-1).items[0] = '作者还有哪些未经绑定的结论？';
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
  row.content = structuredClone(original);
  const entry = row.content.sectionManifest.entries[1], section = h.artifacts.get(entry.artifactId);
  const stageId = section.stageId;
  section.stageId = randomUUID();
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
  section.stageId = stageId;
  section.content.response.paragraphs[0].claimIndexes = [999];
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
});

test('current workflow reserves a bounded section budget and registers both response contracts', async () => {
  const { PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW: workflow } = await load('agent-paper-article-workflow.mjs');
  const { PAPER_ARTICLE_RESPONSE_SCHEMAS } = await load('agent-paper-article-generation.mjs');
  assert.equal(workflow.workflowVersion, 9);
  assert.equal(workflow.defaultBudget.providerCalls, 65);
  assert.ok(workflow.defaultBudget.outputTokens >= 7 * 2400);
  assert.ok(workflow.stages.find(s => s.key === 'compose').timeoutSeconds >= 7 * 180);
  assert.equal(typeof PAPER_ARTICLE_RESPONSE_SCHEMAS['paper.article.section@1'], 'function');
  assert.equal(typeof PAPER_ARTICLE_RESPONSE_SCHEMAS['paper.article.planned-section@1'], 'function');
  assert.equal(typeof PAPER_ARTICLE_RESPONSE_SCHEMAS['paper.article.paragraph@1'], 'function');
});

test('actual last whole-article response exposes a misspelled key and unsupported weighted attention and regularization', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-expanded-live-key-overreach-rejection-v1.json')));
  const before = structuredClone(live);
  const { bindDraftParagraphs } = await load('agent-paper-draft-grounding.mjs');
  const { assertSupportedDraftExplanations: check } = await load('agent-paper-text-draft.mjs');
  const first = live.composition.blocks.find(b => b.type === 'paragraph');
  assert.equal(live.recordedReceipts.length, 2);
  assert.equal(live.evidencePack.findings.some(f => f.key === first.findingKeys[0]), false);
  assert.throws(() => bindDraftParagraphs([first], live.evidencePack, { requiredFindingKeys: [] }),
    { code: 'AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID' });
  for (const term of ['对值进行加权组合', '训练时的正则化手段']) {
    const block = live.composition.blocks.find(b => b.text?.includes(term));
    assert.ok(block);
    const support = block.findingKeys.map(key => live.evidencePack.findings.find(f => f.key === key).text).join('。');
    assert.throws(() => check(block.text, support), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  }
  check('作者把输出写成值的加权和。', '作者明确把输出写成值的加权和。');
  check('作者说明 dropout 是正则化方法。', '作者明确说明 dropout 是一种正则化方法。');
  assert.deepEqual(live, before);
});

test('actual first section negated equivalence is allowed while double negation and later positive assertions stay blocked', async () => {
  const { assertDraftGenerationDistinction: check } = await load('agent-paper-text-draft.mjs');
  const support = '作者说明架构不依赖循环，生成下一个符号时会把先前生成的符号作为额外输入。';
  for (const text of ['论文并未把无循环架构等同于非自回归生成。', '作者没有将无循环架构视为非自回归。',
    '论文不应把无循环架构等同于非自回归。', '作者不可直接理解为非自回归模型。']) check(text, support);
  for (const text of ['论文并非没有把无循环架构等同于非自回归生成。',
    '作者不是没有将无循环架构视为非自回归。', '作者不能不把无循环架构等同于非自回归。',
    '论文并未把无循环架构等同于非自回归。模型是非自回归的。',
    '作者不应把无循环架构等同于非自回归，但模型无需逐步生成。']) {
    assert.throws(() => check(text, support), { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' }, text);
  }
});

test('first actual section still rejects ungrounded roles, unbound purpose and repeated recap after the false positive is fixed', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-first-rejection-v1.json')));
  const before = structuredClone(live);
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { assertSupportedDraftExplanations: check, assertDraftGenerationDistinction } = await load('agent-paper-text-draft.mjs');
  const { assertDraftCallbackBindings } = await load('agent-paper-draft-grounding.mjs');
  const plan = buildPaperArticleSectionPlans(live.evidencePack)[0];
  const claims = p => p.claimIndexes.map(index => plan.claims[index - 1]);
  const support = p => claims(p).map(c => c.text).join('。');
  assertDraftGenerationDistinction(live.response.paragraphs[2].text, support(live.response.paragraphs[2]));
  for (const p of live.response.paragraphs.slice(0, 2)) {
    assert.throws(() => check(p.text, support(p)), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  }
  assert.throws(() => assertDraftCallbackBindings(live.response.paragraphs[1].text, claims(live.response.paragraphs[1])),
    { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  assert.throws(() => validatePaperArticleSection(live.response, live.evidencePack, plan),
    { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP' });
  check('作者解释了为何用注意力而非循环处理关联。', '作者解释为何用注意力而非循环：目的是处理位置之间的关联。');
  assert.throws(() => check('作者解释了为何用注意力而非循环处理关联。',
    '作者未解释为何用注意力而非循环处理关联。'), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  assert.deepEqual(live, before);
});

test('a locally revised section with the formerly rejected correct caution can merge and verify without a new model response', async () => {
  const sentence = '论文并未把无循环架构等同于非自回归生成。';
  const h = await harness((response, i) => { if (i === 0) response.paragraphs[2].text += sentence; });
  const composed = await h.compose(), article = h.artifacts.get(composed.outputRef.artifactId).content;
  assert.equal(article.bodyCharacters, 2761 + Array.from(sentence).length);
  assert.equal(h.cache.size, 5);
  const verified = await h.verify(composed.outputRef), proof = h.artifacts.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
});

test('reference candidates are paired to primary claims and cannot be attached to an unrelated owning paragraph', async () => {
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const plans = buildPaperArticleSectionPlans(evidence);
  for (const plan of plans) {
    for (const reference of plan.claims.filter(c => !c.primary)) {
      assert.ok(reference.referenceForPrimaryIndexes.length);
      assert.ok(reference.referenceForPrimaryIndexes.every(index => plan.claims[index - 1].primary));
    }
    const indexes = plan.paragraphAssignments.flatMap(p => p.primaryClaimIndexes);
    assert.deepEqual(indexes, plan.claims.filter(c => c.primary).map(c => c.index));
  }
  const plan = plans[1], response = structuredClone(fixture.responses[1]);
  const category = plan.claims.find(c => c.findingKey === 'two-common-attention-functions');
  assert.ok(category && !category.primary);
  assert.equal(response.paragraphs[0].claimIndexes.some(index => category.referenceForPrimaryIndexes.includes(index)), false);
  response.paragraphs[0].claimIndexes.push(category.index);
  assert.throws(() => validatePaperArticleSection(response, evidence, plan),
    { code: 'AGENT_PAPER_ARTICLE_SECTION_REFERENCE_OWNERSHIP_INVALID' });
});

test('actual second sectioned run retains frozen local tables and exposes reference-only paragraphs and unsupported expansions', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-reference-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertSupportedDraftExplanations: check, assertDraftGenerationDistinction } = await load('agent-paper-text-draft.mjs');
  const { assertDraftTopicBindings } = await load('agent-paper-draft-grounding.mjs');
  assert.equal(live.recordedProviderCalls.length, 3);
  const first = live.attempts[0], second = live.attempts[1];
  const support = (attempt, paragraph) => paragraph.claimIndexes.map(index => attempt.request.claims.find(c => c.index === index).text).join('。');
  const orphaned = second.response.paragraphs.filter(paragraph => !paragraph.claimIndexes.some(index =>
    second.request.claims.find(c => c.index === index).primary));
  assert.equal(orphaned.length, 2);
  assert.deepEqual(orphaned.map(p => p.claimIndexes), [[5, 8], [7]]);
  assert.equal(live.expectedErrorCode, 'AGENT_PAPER_ARTICLE_SECTION_OWNERSHIP_INVALID');
  for (const [attempt, paragraph] of [[first, first.response.paragraphs[0]], [first, first.response.paragraphs[2]],
    [second, second.response.paragraphs[1]], [second, second.response.paragraphs[4]]]) {
    assert.throws(() => check(paragraph.text, support(attempt, paragraph)),
      { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  }
  assert.throws(() => assertDraftGenerationDistinction(second.response.paragraphs[0].text,
    support(second, second.response.paragraphs[0])), { code: 'AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION' });
  assertDraftGenerationDistinction(first.response.paragraphs[3].text, support(first, first.response.paragraphs[3]));
  assert.throws(() => assertDraftTopicBindings(first.response.paragraphs[0].text,
    first.response.paragraphs[0].claimIndexes.map(index => first.request.claims[index - 1])),
  { code: 'AGENT_PAPER_ARTICLE_TOPIC_BINDING_INCOMPLETE' });
  assert.deepEqual(live, before);
});

test('known role, access and mechanism effects require explicit support rather than component names', async () => {
  const { assertSupportedDraftExplanations: check } = await load('agent-paper-text-draft.mjs');
  for (const [claim, support] of [
    ['作者把注意力作为辅助手段增强信息利用。', '作者说明注意力通常与循环结合。'],
    ['作者说明自注意力在单层内建立全局依赖。', '作者定义自注意力关联序列不同位置。'],
    ['作者说明残差连接有助于信息在深层网络中的传递。', '作者在子层周围使用残差连接。'],
    ['作者说明编码器能够逐步提取输入序列的特征。', '作者说明编码器包含注意力和前馈网络。'],
    ['作者说明注意力本身对顺序不敏感。', '作者在输入嵌入中加入位置编码。'],
  ]) {
    assert.throws(() => check(claim, support), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
    check(claim, claim);
  }
});

test('the formerly auto-passing actual first section now fails before any later section or artifact is created', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-reference-rejection-v1.json')));
  const h = await harness(() => {}, { evidencePack: live.evidencePack, responses: live.attempts.map(a => a.response) });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_TOPIC_BINDING_INCOMPLETE' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.artifacts.size, 0);
});

test('latest captured first section independently rejects ambiguous references, aliased source absence and repeated summary', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-prose-rejection-v1.json')));
  const before = structuredClone(live);
  const { assertTextOnlyDraftProseClarity: check } = await load('agent-paper-text-draft.mjs');
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const plan = buildPaperArticleSectionPlans(live.evidencePack)[0];
  assert.equal(live.recordedProviderCalls.length, 2);
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE');
  assert.equal(live.response.paragraphs.reduce((n, p) => n + Array.from(p.text).length, 0), 790);
  assert.throws(() => check(live.response.paragraphs[1].text), { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  assert.throws(() => check(live.response.paragraphs[2].text), { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
  assert.throws(() => check(live.response.paragraphs[3].text), { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  for (const lead of ['综合作者的表述，', '综合论文的描述，', '总体来看，', '归纳起来，', '总之，']) {
    const output = structuredClone(live.response);
    output.paragraphs.at(-1).text = lead + output.paragraphs.at(-1).text.replace(/^综合作者的表述，/u, '');
    assert.throws(() => validatePaperArticleSection(output, live.evidencePack, plan),
      { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP' });
  }
  assert.deepEqual(live, before);
});

test('scope aliases retain explicit reading boundaries and ordinary substantive endings remain valid', async () => {
  const { assertTextOnlyDraftProseClarity: check } = await load('agent-paper-text-draft.mjs');
  for (const text of ['该定义本身并未展开实现方式。', '上述主张未详述计算过程。', '描述本身没有说明实现细节。']) {
    assert.throws(() => check(text), { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  }
  check('这一描述并未在本次可见范围内展开实现方式。');
  check('这一定义没有改变模型结构，论文继续讨论生成过程。');
  check('这一定义没有改变模型结构并继续讨论生成过程。');
  check('无循环架构并不意味着非自回归生成。');
  assert.throws(() => check('这一描述并未在本次可见范围内展开实现方式。该定义未详述计算方式。'),
    { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const response = structuredClone(fixture.responses[0]);
  // This paragraph introduces the previously unused generation claim; a lead-in
  // alone must not classify it as a recap of facts already covered in this section.
  response.paragraphs.at(-1).text = '总体来看，' + response.paragraphs.at(-1).text;
  validatePaperArticleSection(response, evidence, buildPaperArticleSectionPlans(evidence)[0]);
});

test('latest failed prose stops before later calls and artifacts while natural revised prose still merges and verifies', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-prose-rejection-v1.json')));
  const failed = await harness(() => {}, { evidencePack: live.evidencePack, responses: [live.response] });
  await assert.rejects(failed.compose(), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP' });
  assert.equal(failed.requests.length, 1);
  assert.equal(failed.artifacts.size, 0);
  const valid = await harness(), composed = await valid.compose(), verified = await valid.verify(composed.outputRef);
  assert.equal(valid.artifacts.get(composed.outputRef.artifactId).content.bodyCharacters, 2761);
  const proof = valid.artifacts.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
});

const conciseSections = [
  '论文提出完全依赖注意力、放弃循环结构的序列转换架构。作者把自注意力定义为关联单个序列不同位置、计算该序列表示的机制。架构选择与生成顺序应分开：模型仍逐步生成符号，先前生成的符号作为下一步的额外输入。',
  '论文的编码器层由多头自注意力和逐位置前馈网络组成，子层周围有残差连接，之后做层归一化。作者修改解码器自注意力，使位置不能关注后续位置，并结合输出嵌入偏移，将预测依赖限定在此前已知输出。注意力函数把查询和键值对映射为向量输出；实际计算时，查询、键和值分别打包为矩阵。',
  '作者列出的常见注意力函数是加性注意力和点积注意力。编码器—解码器注意力的查询来自前一个解码器层，键和值来自编码器输出，每个解码器位置可关注整个输入序列。编码器自注意力的查询、键和值则都来自编码器前一层的输出，每个位置可关注前一层所有位置。',
  '作者把解码器自注意力的范围限定为截至并包括当前位置。编码器与解码器每层还包含逐位置应用的前馈网络，由两次线性变换和中间的 ReLU 激活组成。前馈变换在各位置相同，不同层使用不同参数；另一种参数安排是两个嵌入层与 softmax 前线性变换共享权重矩阵。两种共享范围需要区分。',
  '作者为无循环、无卷积的模型注入顺序信息，将位置编码加到编码器和解码器栈底部的输入嵌入中。dropout 用于子层输出加到输入并归一化之前，也用于嵌入与位置编码之和。论文在结论中重申以多头自注意力替代循环层，并计划拓展文本以外的模态、研究局部受限注意力和更少序列化的生成。',
];

test('concise complete sections merge below the former article minimum without sacrificing bindings or private review', async () => {
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const plans = buildPaperArticleSectionPlans(evidence);
  const h = await harness((response, i) => { response.paragraphs = [{ text: conciseSections[i],
    claimIndexes: plans[i].claims.filter(c => c.primary).map(c => c.index) }]; });
  const composed = await h.compose(), article = h.artifacts.get(composed.outputRef.artifactId).content;
  assert.ok(article.bodyCharacters < 800);
  assert.equal(article.lengthPolicy, 'content-first-v1');
  assert.equal(article.paragraphEvidenceBindings.length, 5);
  assert.equal(new Set(article.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, evidence.findings.length);
  assert.equal(h.requests.length, 5);
  for (const request of h.requests) {
    const payload = JSON.parse(request.request.messages[1].content);
    assert.equal(payload.lengthPolicy, 'content-first-v1');
    assert.equal(Object.hasOwn(payload, 'minimumCharacters'), false);
    assert.equal(Object.hasOwn(payload, 'targetCharacters'), false);
  }
  const verified = await h.verify(composed.outputRef), proof = h.artifacts.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
});

test('content-first permits brevity but still rejects omitted primary facts, empty sections and duplicate paragraphs', async () => {
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const plan = buildPaperArticleSectionPlans(evidence)[0];
  const response = structuredClone(fixture.responses[0]);
  response.paragraphs = [{ text: conciseSections[0], claimIndexes: plan.claims.filter(c => c.primary).map(c => c.index) }];
  validatePaperArticleSection(response, evidence, plan);
  const omitted = structuredClone(response);
  const definition = plan.claims.find(c => c.findingKey === 'self-attention-definition');
  omitted.paragraphs[0].text = omitted.paragraphs[0].text.replace('作者把自注意力定义为关联单个序列不同位置、计算该序列表示的机制。', '');
  omitted.paragraphs[0].claimIndexes = omitted.paragraphs[0].claimIndexes.filter(index => index !== definition.index);
  assert.throws(() => validatePaperArticleSection(omitted, evidence, plan),
    { code: 'AGENT_PAPER_ARTICLE_FINDING_COVERAGE_INSUFFICIENT' });
  const empty = structuredClone(response); empty.paragraphs[0].text = ' ';
  assert.throws(() => validatePaperArticleSection(empty, evidence, plan), { code: 'AGENT_PAPER_ARTICLE_SECTION_INVALID' });
  const duplicate = structuredClone(response); duplicate.paragraphs.push(structuredClone(duplicate.paragraphs[0]));
  assert.throws(() => validatePaperArticleSection(duplicate, evidence, plan),
    { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP' });
});

test('current brief drafts also have no body quota while retaining source bindings and review notice', async () => {
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const pack = { ...structuredClone(evidence), findings: evidence.findings.slice(0, 2) }, memory = new Map();
  const output = { title: '论文如何用注意力组织序列转换',
    summary: '作者提出完全依赖注意力的序列转换架构，并把自注意力定义为关联单个序列位置的机制。',
    blocks: [{ type: 'paragraph', text: '作者提出完全依赖注意力、放弃循环结构的序列转换架构。论文把自注意力定义为关联单个序列不同位置、计算该序列表示的机制。',
      citationIndexes: [1], findingKeys: pack.findings.map(f => f.key) }], followUpQuestions: evidence.followUpQuestions.slice(0, 3) };
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke(request) {
    assert.match(request.request.messages[0].content, /没有字数下限或固定段数/u);
    return { output, actionId: randomUUID() };
  } }, artifactRepository: {
    async readToolArtifact() { return { content: pack }; },
    async save(value) { const row = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) }; memory.set(row.id, row); return row; },
    async read({ artifactId }) { return memory.get(artifactId); },
  } });
  const context = { run: { id: randomUUID(), agentUserId: randomUUID(), workflowVersion: 4, input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  const composed = await handlers['paper.article.draft-shadow:compose'](context, {});
  const article = memory.get(composed.outputRef.artifactId).content;
  assert.ok(article.bodyCharacters < 800);
  assert.equal(article.paragraphEvidenceBindings.length, 1);
  const verified = await handlers['paper.article.draft-shadow:verify']({ ...context,
    prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] }, {});
  assert.equal(memory.get(verified.outputRef.artifactId).content.publicPublicationEnabled, false);
  const original = structuredClone(output.blocks[0]);
  delete output.blocks[0].findingKeys;
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID' });
  output.blocks[0] = { ...original, text: '作者提出完全依赖注意力、放弃循环结构的序列转换架构。',
    findingKeys: [pack.findings[0].key] };
  await assert.rejects(handlers['paper.article.draft-shadow:compose'](context, {}),
    { code: 'AGENT_PAPER_ARTICLE_FINDING_COVERAGE_INSUFFICIENT' });
});

const componentLive = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-component-rejection-v1.json')));
const relationEditorial = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-problem-relations-editorial-v1.json')));
const recordedSections = () => componentLive.recordedReceipts.filter(c => c.stage.startsWith('compose-section-'))
  .map(c => typeof c.receipt.output === 'string' ? JSON.parse(c.receipt.output) : structuredClone(c.receipt.output));

test('actual third-section comparisons remain rejected, and explicit bilateral local bindings repair them without regenerating text', async () => {
  const before = structuredClone(componentLive);
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const pack = componentLive.evidencePack, plan = buildPaperArticleSectionPlans(pack)[2];
  const raw = recordedSections()[2];
  const pair = plan.comparisonBindings.find(p => p.subjects.some(s => s.topic === 'encoder-self-attention')
    && p.subjects.some(s => s.topic === 'encoder-decoder-attention'));
  assert.ok(pair);
  assert.deepEqual(pair.subjects.map(s => s.claimIndexes), [[3], [2]]);
  assert.throws(() => validatePaperArticleSection(raw, pack, plan),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_COMPARISON_AMBIGUOUS' });
  const revised = structuredClone(raw);
  revised.paragraphs[1].text = revised.paragraphs[1].text.replace('区别于自注意力', '区别于编码器自注意力');
  revised.paragraphs[1].claimIndexes = [2, 3];
  assert.throws(() => validatePaperArticleSection(revised, pack, plan),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
  revised.paragraphs[2].claimIndexes = [3, 2];
  const valid = validatePaperArticleSection(revised, pack, plan);
  assert.deepEqual(valid.paragraphEvidenceBindings[2].findingKeys,
    [pack.findings[9].key, pack.findings[8].key]);
  assert.deepEqual(componentLive, before);
});

test('recorded missing comparison stops before a fourth section and cannot be silently auto-bound', async () => {
  const before = structuredClone(componentLive);
  const h = await harness(() => {}, { evidencePack: componentLive.evidencePack, responses: recordedSections() });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_COMPARISON_AMBIGUOUS' });
  assert.equal(h.requests.length, 3);
  assert.equal(h.artifacts.size, 2);
  assert.equal([...h.artifacts.values()].some(a => a.artifactKey === 'blog.composition'), false);
  for (const req of h.requests) {
    const payload = JSON.parse(req.request.messages[1].content);
    assert.equal(req.promptTemplate.version, 7);
    assert.deepEqual(payload.comparisonBindings, h.plans[payload.ordinal].comparisonBindings);
    assert.ok(payload.comparisonBindings.every(p => p.subjects.every(s => s.claimIndexes.every(n => payload.claims[n - 1]))));
    assert.equal(JSON.stringify(payload.comparisonBindings).includes('findingKey'), false);
  }
  assert.deepEqual(componentLive, before);
});

test('generic self-attention contrasts are ambiguous even with both bindings, but a concrete source contrast passes', async () => {
  const { assertDraftComponentBindings: check } = await load('agent-paper-draft-grounding.mjs');
  const claims = componentLive.evidencePack.findings.slice(8, 10);
  for (const text of ['作者说明编码器—解码器注意力不同于自注意力。',
    '论文把编码器-解码器注意力与自注意力相比。']) {
    assert.throws(() => check(text, claims), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_COMPARISON_AMBIGUOUS' });
  }
  check('作者说明编码器—解码器注意力的查询来自前一个解码器层，而编码器自注意力的查询来自编码器前一层。', claims);
  assert.throws(() => check('作者说明编码器—解码器注意力与编码器自注意力的查询来源不同。', [claims[1]]),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
});

async function problemEditorialCase() {
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const pack = structuredClone(componentLive.evidencePack);
  const f = relationEditorial.addedFinding, source = pack.evidence.find(e => e.index === f.sourceEvidenceIndex);
  pack.findings.push({ key: f.key, kind: f.kind, text: f.text, evidenceIndexes: [source.index],
    relations: [{ evidenceIndex: source.index, evidenceId: source.id, relation: 'supports' }], confidence: 'low' });
  const plans = buildPaperArticleSectionPlans(pack);
  const responses = relationEditorial.sections.map((section, i) => {
    const indexes = keys => keys.map(key => {
      const claim = plans[i].claims.find(c => c.findingKey === key); assert.ok(claim, key); return claim.index;
    });
    return { sectionKey: plans[i].sectionKey, heading: section.heading,
      paragraphs: section.paragraphs.map(p => ({ text: p.text, claimIndexes: indexes(p.findingKeys) })),
      article: i === 0 ? { title: relationEditorial.article.title, summary: relationEditorial.article.summary,
        claimIndexes: indexes(relationEditorial.article.findingKeys) } : null };
  });
  return { pack, plans, responses };
}

test('a source-backed problem returned late is introduced first and the readable relation revision merges with private review', async () => {
  const { textOnlyDraftExcerpt, assertTextOnlyDraftFindingContext } = await load('agent-paper-text-draft.mjs');
  const { pack, plans, responses } = await problemEditorialCase();
  const problem = pack.findings.at(-1), source = pack.evidence[0];
  assert.equal(relationEditorial.captureKind, 'local-editorial-problem-and-relation-revision-not-new-provider');
  for (const sentence of relationEditorial.addedFinding.literalSourceSentences) assert.ok(textOnlyDraftExcerpt(source.quoteText).includes(sentence));
  assert.deepEqual(source.locator.pages, [2]);
  assertTextOnlyDraftFindingContext([problem], pack.evidence);
  assert.equal(plans[0].claims[0].findingKey, problem.key);
  assert.equal(plans[0].claims[0].narrativeRole, 'research-problem');
  const h = await harness(() => {}, { evidencePack: pack, responses });
  const composed = await h.compose(), article = h.artifacts.get(composed.outputRef.artifactId).content;
  assert.ok(article.bodyCharacters < 2500);
  assert.equal(article.lengthPolicy, 'content-first-v1');
  assert.equal(new Set(article.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, pack.findings.length);
  const problemBinding = article.paragraphEvidenceBindings.find(b => b.findingKeys.includes(problem.key));
  assert.deepEqual(problemBinding.evidence[0].pages, [2]);
  assert.equal(problemBinding.evidence[0].quoteHash, source.quoteHash);
  const verified = await h.verify(composed.outputRef), proof = h.artifacts.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
});

test('problem coverage, paragraph recall and safe-source boundaries remain mandatory in the editorial revision', async () => {
  const { validatePaperArticleSection, buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const { assertSupportedDraftExplanations, assertTextOnlyDraftFindingContext } = await load('agent-paper-text-draft.mjs');
  const { pack, plans, responses } = await problemEditorialCase();
  const bad = structuredClone(responses[0]);
  bad.paragraphs[0].claimIndexes = bad.paragraphs[0].claimIndexes.filter(n => plans[0].claims[n - 1].narrativeRole !== 'research-problem');
  assert.throws(() => validatePaperArticleSection(bad, pack, plans[0]),
    { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  const omitted = structuredClone(responses[0]); omitted.paragraphs.shift();
  assert.throws(() => validatePaperArticleSection(omitted, pack, plans[0]),
    { code: 'AGENT_PAPER_ARTICLE_FINDING_COVERAGE_INSUFFICIENT' });
  assert.throws(() => assertTextOnlyDraftFindingContext([{ ...pack.findings.at(-1),
    relations: [{ evidenceIndex: 2, relation: 'supports' }] }], pack.evidence),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  assert.throws(() => assertSupportedDraftExplanations('作者说明训练无法并行。', pack.findings.at(-1).text),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  const oldPlans = buildPaperArticleSectionPlans(componentLive.evidencePack);
  assert.equal(oldPlans.flatMap(p => p.claims).some(c => c.narrativeRole === 'research-problem'), false);
});

const researchLive = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-research-callback-rejection-v1.json')));
const callbackEditorial = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-research-callback-editorial-v1.json')));
function researchLiveSection() {
  const output = researchLive.recordedReceipts.find(c => c.stage === 'compose-section-01').receipt.output;
  return typeof output === 'string' ? JSON.parse(output) : structuredClone(output);
}
async function callbackEditorialCase() {
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const pack = structuredClone(researchLive.evidencePack), plans = buildPaperArticleSectionPlans(pack);
  const responses = callbackEditorial.sections.map((s, i) => {
    const indexes = keys => keys.map(key => { const claim = plans[i].claims.find(c => c.findingKey === key);
      assert.ok(claim, key); return claim.index; });
    return { sectionKey: plans[i].sectionKey, heading: s.heading,
      paragraphs: s.paragraphs.map(p => ({ text: p.text, claimIndexes: indexes(p.findingKeys) })),
      article: i === 0 ? { title: callbackEditorial.article.title, summary: callbackEditorial.article.summary,
        claimIndexes: indexes(callbackEditorial.article.findingKeys) } : null };
  });
  return { pack, plans, responses };
}

test('actual co-use overreach and research callback omissions fail independently; binding repair never alters recorded output', async () => {
  const before = structuredClone(researchLive), pack = researchLive.evidencePack;
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { assertSupportedDraftExplanations } = await load('agent-paper-text-draft.mjs');
  const plan = buildPaperArticleSectionPlans(pack)[0], raw = researchLiveSection();
  assert.throws(() => assertSupportedDraftExplanations(raw.paragraphs[1].text, pack.findings[1].text),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  assert.throws(() => validatePaperArticleSection(raw, pack, plan),
    { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  const revised = structuredClone(raw);
  revised.paragraphs[1].text = pack.findings[1].text;
  assert.throws(() => validatePaperArticleSection(revised, pack, plan),
    { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  revised.paragraphs[2].claimIndexes.push(1);
  const valid = validatePaperArticleSection(revised, pack, plan);
  assert.ok(valid.paragraphEvidenceBindings[2].findingKeys.includes(pack.findings[0].key));
  assert.deepEqual(researchLive, before);
});

test('implicit problem callbacks require the local problem binding, while unrelated purpose connectors remain valid', async () => {
  const { assertDraftCallbackBindings: check } = await load('agent-paper-draft-grounding.mjs');
  const pack = researchLive.evidencePack, problem = pack.findings[0], proposal = pack.findings[2];
  for (const text of ['针对上述问题，作者提出放弃循环的架构。',
    '回应这一约束，论文提出新的模型架构。', '面对该问题，作者提出放弃循环的模型。']) {
    assert.throws(() => check(text, [proposal]), { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
    check(text, [problem, proposal]);
  }
  check('论文提出放弃循环的模型架构。', [proposal]);
  const positions = pack.findings.find(f => f.key === 'positional-encoding-purpose');
  check('作者为此在输入嵌入中加入位置编码。', [positions]);
});

test('co-use never proves inability, including in saved findings, but explicit evidence and scoped cautions remain valid', async () => {
  const { assertDraftCoUseScope: check, assertTextOnlyDraftFindingContext } = await load('agent-paper-text-draft.mjs');
  const finding = researchLive.evidencePack.findings[1], support = finding.text;
  for (const text of ['作者说明注意力不能独立承担序列建模。', '注意力无法单独完成序列建模。',
    '作者说明注意力是搭配组件，而非独立承担序列建模。', '论文认为注意力并非独立进行序列转换。']) {
    assert.throws(() => check(text, support), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
    assert.throws(() => assertTextOnlyDraftFindingContext([{ ...finding, text }], researchLive.evidencePack.evidence),
      { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  }
  check('作者指出除少数情况外，注意力通常与循环网络结合使用。', support);
  for (const text of ['不能把通常结合使用理解为不能独立承担序列建模。',
    '这并不意味着注意力不能独立承担序列建模。']) check(text, support);
  const denial = '作者明确指出注意力不能独立承担序列建模。';
  check(denial, denial);
  check(denial, 'Attention cannot independently perform sequence modeling.');
  for (const source of ['作者认为注意力可能不能独立承担序列建模。',
    '作者并非不能独立承担序列建模。', '通常结合使用不意味着注意力不能独立承担序列建模。',
    'This does not mean attention cannot independently perform sequence modeling.']) {
    assert.throws(() => check(denial, source), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  }
});

test('a natural source-bounded revision merges, keeps private review and supplies local callback indexes without auto-binding', async () => {
  const { pack, plans, responses } = await callbackEditorialCase();
  const h = await harness(() => {}, { evidencePack: pack, responses });
  const composed = await h.compose(), article = h.artifacts.get(composed.outputRef.artifactId).content;
  assert.equal(callbackEditorial.captureKind, 'local-editorial-callback-and-co-use-revision-not-new-provider');
  assert.equal(plans[0].claims.find(c => c.findingKey === pack.findings[2].key).narrativeRole, 'proposal');
  const first = JSON.parse(h.requests[0].request.messages[1].content);
  assert.deepEqual(first.paragraphBindingGuide.find(g => g.topic === 'research-problem').claimIndexes, [1]);
  assert.ok(first.paragraphBindingGuide.every(g => g.claimIndexes.every(n => first.claims[n - 1])));
  assert.equal(JSON.stringify(first.paragraphBindingGuide).includes('findingKey'), false);
  assert.match(h.requests[0].request.messages[0].content, /上一段已经引用不能代替/u);
  assert.match(h.requests[0].request.messages[0].content, /保留程度和例外/u);
  assert.equal(article.lengthPolicy, 'content-first-v1');
  assert.equal(new Set(article.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, pack.findings.length);
  const verified = await h.verify(composed.outputRef), proof = h.artifacts.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
  assert.equal(h.requests.length, plans.length);
  // Original evidence, hashes and receipts were not replaced by the revision.
  assert.deepEqual(pack.evidence, researchLive.evidencePack.evidence);
});

test('a co-use failure stops section generation and never creates a composition or a later provider call', async () => {
  const h = await harness(() => {}, { evidencePack: researchLive.evidencePack, responses: [researchLiveSection()] });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.artifacts.size, 0);
});
