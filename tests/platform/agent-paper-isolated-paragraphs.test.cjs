const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../apps/api/src', name)));
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-planned-live-synonym-rejection-v1.json')));
// Explicit offline safe subset: archived extraction incorrectly flattened the
// encoder hierarchy. Keep raw receipts unchanged, and do not invent a layer
// count from their clipped source passage.
const pack = structuredClone(raw.evidencePack);
const encoderFinding = pack.findings.find(f => /编码器包含[^。]{0,80}两个子层/u.test(f.text));
encoderFinding.text = '作者说明编码器中使用多头自注意力机制与逐位置全连接前馈网络，并在子层周围使用残差连接，随后进行层归一化。';
const recorded = n => {
  const row = raw.recordedReceipts.find(r => r.stage === `compose-section-${String(n).padStart(2, '0')}`);
  return { payload: JSON.parse(row.request.messages[1].content), output: typeof row.receipt.output === 'string' ? JSON.parse(row.receipt.output) : row.receipt.output };
};

async function setup(mutate = () => {}) {
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const plans = buildPaperArticleSectionPlans(pack, { plannedParagraphs: true, isolatedParagraphs: true }), rows = new Map(), cache = new Map(), calls = [];
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke(request) {
    calls.push(request);
    if (cache.has(request.idempotencyKey)) return structuredClone(cache.get(request.idempotencyKey));
    const payload = JSON.parse(request.request.messages[1].content), plan = plans.find(p => p.sectionKey === payload.sectionKey);
    const assignment = plan.paragraphPlan.paragraphs.find(p => p.paragraphId === payload.paragraphId);
    assert.equal(request.responseSchema.key, 'paper.article.paragraph');
    assert.deepEqual(payload.claims.map(c => c.text), assignment.claimIndexes.map(n => plan.claims[n - 1].text));
    for (const name of ['paragraphPlan', 'paragraphAssignments', 'comparisonBindings', 'paragraphBindingGuide', 'previousHeadings', 'previousBody']) {
      assert.equal(Object.hasOwn(payload, name), false, name);
    }
    assert.ok(payload.claims.every(c => !Object.hasOwn(c, 'findingKey') && !Object.hasOwn(c, 'index')));
    const output = { sectionKey: payload.sectionKey, paragraphId: payload.paragraphId,
      text: payload.claims.map(c => c.text).join(''), heading: payload.writeHeading ? '论文中的问题与方法' : null,
      article: payload.writeArticleMetadata ? { title: '论文问题与方法介绍', summary: payload.claims[0].text } : null };
    mutate(output, payload, plan, assignment);
    const result = { status: 'succeeded', output, actionId: randomUUID() };
    cache.set(request.idempotencyKey, structuredClone(result)); return result;
  } }, artifactRepository: {
    async readToolArtifact() { return { content: structuredClone(pack) }; },
    async save(value) {
      const old = [...rows.values()].find(r => r.artifactKey === value.artifactKey);
      if (old) { assert.equal(old.contentSha256, stableHash(value.content)); return old; }
      const row = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) }; rows.set(row.id, row); return row;
    },
    async read({ artifactId, expectedArtifactKey }) { const row = rows.get(artifactId); assert.equal(row.artifactKey, expectedArtifactKey); return row; },
  } });
  const context = { run: { id: randomUUID(), agentUserId: randomUUID(), workflowVersion: 6, input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  return { plans, rows, calls, cache,
    compose: () => handlers['paper.article.draft-shadow:compose'](context, {}),
    verify: ref => handlers['paper.article.draft-shadow:verify']({ ...context,
      prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: ref }] }, {}) };
}

test('actual mapping paraphrase is recognized without exempting a missing definition or an unbound recall', async () => {
  const { assertPlannedParagraphCoverage } = await load('agent-paper-article-paragraph-plan.mjs');
  const { assertDraftFunctionBinding } = await load('agent-paper-draft-grounding.mjs');
  const { payload, output } = recorded(3), claim = { ...payload.claims[0], findingKey: 'mapping' };
  assertPlannedParagraphCoverage(output.paragraphs[0].text, [claim]);
  for (const text of ['论文说明函数接收查询和一组键值对，并产生输出向量。',
    '作者把查询和键值对映射为向量输出。']) {
    assertPlannedParagraphCoverage(text, [claim]);
    assertDraftFunctionBinding(text, [{ text: claim.text }]);
    assert.throws(() => assertDraftFunctionBinding(text, [{ text: payload.claims[2].text }]),
      { code: 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE' });
  }
  for (const text of ['作者说明查询与键值对都是向量。', '作者介绍两种常用注意力函数。']) {
    assert.throws(() => assertPlannedParagraphCoverage(text, [claim]), { code: 'AGENT_PAPER_ARTICLE_PLANNED_FACT_OMITTED' });
  }
});

test('architecture synonyms select the actual proposal over positional encoding, while recall still needs support', async () => {
  const { assertDraftCallbackBindings } = await load('agent-paper-draft-grounding.mjs');
  for (const text of ['论文提出不采用循环的架构。', '作者提出不再采用循环的模型。', '论文说明架构不使用循环。',
    '作者介绍不包含循环的架构。', '论文提出没有采用循环的模型。']) {
    assertDraftCallbackBindings(text, [{ text: '作者提出放弃循环的模型架构。' }]);
    assert.throws(() => assertDraftCallbackBindings(text, [{ text: '作者说明模型逐步生成符号。' }]),
      { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  }
  const h = await setup(), first = h.plans[0];
  assert.equal(first.paragraphPlan.paragraphs.flatMap(p => p.claimIndexes).some(n => first.claims[n - 1].narrativeRole === 'generation-order'), false);
  const generation = h.plans.find(p => p.claims.some(c => c.primary && c.narrativeRole === 'generation-order'));
  assert.ok(generation.claims.some(c => !c.primary && c.narrativeRole === 'proposal'));
  assert.equal(first.paragraphPlan.paragraphs.flatMap(p => p.claimIndexes).some(n => /位置编码/u.test(first.claims[n - 1].text)), false);
});

test('isolated requests expose only assigned facts and merge governed paragraph artifacts into a private draft', async () => {
  const before = structuredClone(raw), h = await setup(), composed = await h.compose();
  const article = h.rows.get(composed.outputRef.artifactId).content;
  assert.equal(article.generationMode, 'isolated-paragraphs-v1');
  const expectedCalls = h.plans.reduce((n, p) => n + p.paragraphPlan.paragraphs.length, 0);
  assert.equal(h.calls.length, expectedCalls);
  assert.ok(expectedCalls <= 56);
  assert.equal(new Set(h.calls.map(c => c.idempotencyKey)).size, expectedCalls);
  const paragraphs = [...h.rows.values()].filter(r => r.artifactKey.startsWith('paper.article.paragraph.'));
  assert.equal(paragraphs.length, expectedCalls);
  const sections = [...h.rows.values()].filter(r => /^paper.article.section-/u.test(r.artifactKey));
  assert.ok(sections.every(r => r.content.responseOrigin === 'validated-paragraph-assembly'));
  const verified = await h.verify(composed.outputRef), proof = h.rows.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true); assert.equal(proof.publicPublicationEnabled, false);
  assert.equal(proof.paragraphBindingOrigin, 'server-plan-before-generation');
  assert.deepEqual(await h.compose(), composed); assert.equal(h.cache.size, expectedCalls);
  assert.deepEqual(raw, before);
});

test('actual component contrast and function recall outside an assignment remain blocked even after the synonym fix', async () => {
  const { validateIsolatedParagraph } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const h = await setup(), section = h.plans[2], old = recorded(3).output;
  const types = section.paragraphPlan.paragraphs.find(a => a.claimIndexes.some(n => /两种最常用/u.test(section.claims[n - 1].text)));
  const i = section.paragraphPlan.paragraphs.indexOf(types);
  assert.throws(() => validateIsolatedParagraph({ sectionKey: section.sectionKey, paragraphId: types.paragraphId,
    text: old.paragraphs[2].text, heading: i === 0 ? '注意力函数' : null, article: null }, pack, section, types, i, validatePaperArticleSection),
  { code: 'AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE' });
  const cross = section.paragraphPlan.paragraphs.find(a => a.claimIndexes.some(n => /编码器-解码器注意力层/u.test(section.claims[n - 1].text)));
  const j = section.paragraphPlan.paragraphs.indexOf(cross), response = { sectionKey: section.sectionKey,
    paragraphId: cross.paragraphId, text: old.paragraphs[3].text, heading: j === 0 ? '注意力来源' : null, article: null };
  assert.throws(() => validateIsolatedParagraph(response, pack, section, cross, j, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_AUTHOR_ATTRIBUTION_MISSING' });
  response.text = `论文说明，${response.text}`;
  assert.throws(() => validateIsolatedParagraph(response, pack, section, cross, j, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
});

test('per-paragraph author attribution can vary naturally, and a missing attribution stops all later calls', async () => {
  for (const prefix of ['作者说明，', '根据论文，', '这一结构在文中被描述为：']) {
    const h = await setup((out, payload) => { if (payload.writeArticleMetadata) out.text = prefix + out.text.replaceAll('作者', ''); });
    await h.compose();
  }
  const h = await setup(out => { out.text = out.text.replaceAll('作者', '').replaceAll('论文', '').replaceAll('文中', ''); });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_AUTHOR_ATTRIBUTION_MISSING' });
  assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
});

test('a later paragraph failure preserves its validated prefix but never creates its failing section or calls the following paragraph', async () => {
  let count = 0;
  const h = await setup(out => { if (++count === 2) out.text += '注意力不能独立承担序列建模。'; });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  assert.equal(h.calls.length, 2);
  assert.equal([...h.rows.values()].filter(r => r.artifactKey.startsWith('paper.article.paragraph.')).length, 1);
  const failingSection = JSON.parse(h.calls[1].request.messages[1].content).sectionKey;
  assert.equal([...h.rows.values()].some(r => r.artifactKey === `paper.article.${failingSection}`), false);
  assert.equal([...h.rows.values()].some(r => r.artifactKey === 'blog.composition'), false);
});

test('verify rechecks child paragraph lineage, plan and content rather than trusting a forged section assembly', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const h = await setup(), composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId);
  const sectionEntry = article.content.sectionManifest.entries[0], section = h.rows.get(sectionEntry.artifactId);
  const childEntry = section.content.paragraphEntries[0], child = h.rows.get(childEntry.artifactId);
  const stageId = child.stageId; child.stageId = randomUUID();
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
  child.stageId = stageId;
  child.content.response.text += '注意力不能独立承担序列建模。';
  child.contentSha256 = stableHash(child.content); childEntry.contentSha256 = child.contentSha256;
  section.contentSha256 = stableHash(section.content); sectionEntry.contentSha256 = section.contentSha256;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
});

const localLive = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-isolated-live-local-reference-v1.json')));
test('actual decoder-local reference is recognized, while the separately incorrect whole-encoder hierarchy stays blocked', async () => {
  const before = structuredClone(localLive);
  const { assertPlannedParagraphCoverage } = await load('agent-paper-article-paragraph-plan.mjs');
  const { assertDraftComponentBindings } = await load('agent-paper-draft-grounding.mjs');
  const { assertDraftEncoderLayerScope } = await load('agent-paper-text-draft.mjs');
  const call = localLive.recordedReceipts.find(c => c.stage === 'compose-section-02-paragraph-03');
  const payload = JSON.parse(call.request.messages[1].content), out = typeof call.receipt.output === 'string' ? JSON.parse(call.receipt.output) : call.receipt.output;
  const claims = payload.claims.map((c, i) => ({ ...c, findingKey: `local-${i}` }));
  assertPlannedParagraphCoverage(out.text, claims);
  assertDraftComponentBindings(out.text, claims);
  assert.throws(() => assertDraftEncoderLayerScope(out.text, 'Encoder: Each layer has two sub-layers.'),
    { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
  const corrected = out.text.replace('编码器由两个子层组成', '编码器每层由两个子层组成');
  assertDraftEncoderLayerScope(corrected, 'Encoder: Each layer has two sub-layers.');
  assert.deepEqual(localLive, before);
});

test('local references never inherit from another sentence, a coordinated subject, a crossing object or cross-attention name', async () => {
  const { assertDraftComponentBindings: check, draftClaimBindingGuide } = await load('agent-paper-draft-grounding.mjs');
  const decoder = [{ text: '作者说明解码器自注意力限制位置访问范围。' }];
  for (const text of ['作者说明，解码器同样使用层归一化，但修改其中的自注意力子层。',
    '作者在解码器中使用残差连接，并修改其中的自注意力子层。',
    '解码器与编码器类似地使用残差连接，作者修改其中的自注意力子层。',
    '编码器使用残差连接，解码器也使用残差连接，并修改其中的自注意力子层。']) {
    check(text, decoder);
    assert.ok(draftClaimBindingGuide([{ kind: 'author_claim', key: 'local', text }]).some(g => g.topic === 'decoder-self-attention'));
  }
  for (const text of ['其中的自注意力子层阻止关注后续位置。',
    '解码器使用残差连接。其中的自注意力子层阻止关注后续位置。',
    '编码器和解码器都使用残差连接，并修改其中的自注意力子层。',
    '解码器的输出进入编码器，并修改其中的自注意力子层。',
    '编码器—解码器注意力使用查询，其中的自注意力子层被修改。']) {
    assert.throws(() => check(text, decoder), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_REFERENCE_AMBIGUOUS' });
  }
  assert.throws(() => check('编码器使用残差连接，并修改其中的自注意力子层。', decoder),
    { code: 'AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE' });
});

test('avoid-recurrence synonyms choose the proposal and schedule positional encoding and generation only in their primary paragraphs', async () => {
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const { assertDraftCallbackBindings } = await load('agent-paper-draft-grounding.mjs');
  for (const verb of ['避开', '绕开', '舍弃', '去除']) {
    assertDraftCallbackBindings(`作者${verb}循环，提出新的架构。`, [{ text: '作者提出无循环架构。' }]);
    assert.throws(() => assertDraftCallbackBindings(`作者${verb}循环，提出新的架构。`, [{ text: '作者描述逐步生成。' }]),
      { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  }
  const plans = buildPaperArticleSectionPlans(localLive.evidencePack, { plannedParagraphs: true, isolatedParagraphs: true });
  const positional = localLive.evidencePack.findings.find(f => /为使模型利用序列顺序/u.test(f.text));
  const generation = localLive.evidencePack.findings.find(f => /模型在每一步是自回归/u.test(f.text));
  const occurrences = key => plans.flatMap(p => p.paragraphPlan.paragraphs.map(a => ({ section: p.sectionKey,
    keys: a.claimIndexes.map(n => p.claims[n - 1].findingKey), primary: a.primaryClaimIndexes.map(n => p.claims[n - 1].findingKey) })))
    .filter(p => p.keys.includes(key));
  for (const finding of [positional, generation]) {
    const places = occurrences(finding.key);
    assert.equal(places.length, 1);
    assert.ok(places[0].primary.includes(finding.key));
  }
  assert.equal(plans[0].paragraphPlan.paragraphs.some(a => a.claimIndexes.some(n => /位置编码/u.test(plans[0].claims[n - 1].text))), false);
});

test('flattened encoder hierarchy fails within the isolated pipeline before subsequent generation', async () => {
  const h = await setup((out, payload) => {
    if (payload.claims.some(c => /编码器中使用多头/u.test(c.text))) out.text = out.text.replace(
      '编码器中使用多头自注意力机制与逐位置全连接前馈网络',
      '编码器由两个子层组成：多头自注意力机制与逐位置全连接前馈网络');
  });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
  assert.equal([...h.rows.values()].some(r => r.artifactKey === 'blog.composition'), false);
  assert.equal(h.calls.at(-1).action.actionKey.includes('paragraph'), true);
});

test('titles and summaries cannot flatten the encoder hierarchy or bypass the paragraph evidence boundary', async () => {
  const { assertDraftEncoderLayerScope: check } = await load('agent-paper-text-draft.mjs');
  assert.throws(() => check('编码器由多头自注意力与逐位置前馈网络组成。',
    '作者说明编码器每层包含两个子层。'), { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
  check('编码器中使用多头自注意力与逐位置前馈网络。', '作者说明编码器每层包含两个子层。');
  for (const field of ['title', 'summary']) {
    const h = await setup((out, payload) => { if (payload.writeArticleMetadata) out.article[field] = '作者说明编码器整体只有两个子层：多头自注意力与前馈网络。'; });
    await assert.rejects(h.compose(), { code: 'AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT' });
    assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
  }
});
