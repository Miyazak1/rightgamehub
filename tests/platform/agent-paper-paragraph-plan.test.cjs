const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../apps/api/src', name)));
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-sectioned-live-research-callback-rejection-v1.json')));
const pack = raw.evidencePack;

async function setup(mutate = () => {}) {
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const plans = buildPaperArticleSectionPlans(pack, { plannedParagraphs: true }), rows = new Map(), cache = new Map(), calls = [];
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke(request) {
    calls.push(request);
    if (cache.has(request.idempotencyKey)) return structuredClone(cache.get(request.idempotencyKey));
    assert.equal(request.responseSchema.key, 'paper.article.planned-section');
    const payload = JSON.parse(request.request.messages[1].content), plan = plans[payload.ordinal];
    assert.deepEqual(payload.paragraphPlan, plan.paragraphPlan);
    const output = { sectionKey: plan.sectionKey, heading: '论文中的方法与关系',
      paragraphs: plan.paragraphPlan.paragraphs.map(p => ({ paragraphId: p.paragraphId,
        text: p.claimIndexes.map(n => plan.claims[n - 1].text).join('') })),
      article: plan.ordinal === 0 ? { title: '论文研究问题与方法介绍',
        summary: '作者指出循环模型的顺序计算约束仍然存在，并提出不使用循环、完全依赖注意力的模型架构。生成时仍将先前生成的符号作为下一步的额外输入。' } : null };
    mutate(output, plan, payload);
    const result = { status: 'succeeded', output, actionId: randomUUID() };
    cache.set(request.idempotencyKey, structuredClone(result)); return result;
  } }, artifactRepository: {
    async readToolArtifact() { return { content: structuredClone(pack) }; },
    async save(value) {
      const old = [...rows.values()].find(r => r.artifactKey === value.artifactKey);
      if (old) { assert.equal(old.contentSha256, stableHash(value.content)); return old; }
      const row = { ...value, id: randomUUID(), contentSha256: stableHash(value.content) }; rows.set(row.id, row); return row;
    },
    async read({ artifactId }) { return rows.get(artifactId); },
  } });
  const context = { run: { id: randomUUID(), agentUserId: randomUUID(), workflowVersion: 5, input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  return { plans, rows, calls, cache, context,
    compose: () => handlers['paper.article.draft-shadow:compose'](context, {}),
    verify: ref => handlers['paper.article.draft-shadow:verify']({ ...context,
      prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: ref }] }, {}) };
}

test('v5 freezes related problem, architecture and generation facts before writing, rather than repairing a response', async () => {
  const before = structuredClone(raw), h = await setup(), first = h.plans[0];
  const group = first.paragraphPlan.paragraphs.find(p => p.claimIndexes.some(n => first.claims[n - 1].narrativeRole === 'proposal'));
  assert.ok(group.claimIndexes.some(n => first.claims[n - 1].findingKey === 'sequential-computation-constraint'));
  assert.ok(group.claimIndexes.some(n => first.claims[n - 1].findingKey === 'autoregressive-generation'));
  const { validatePlannedSectionResponse } = await load('agent-paper-article-paragraph-plan.mjs');
  const old = raw.recordedReceipts.find(c => c.stage === 'compose-section-01').receipt.output;
  assert.throws(() => validatePlannedSectionResponse(old), { code: 'AGENT_PAPER_ARTICLE_PARAGRAPH_RESPONSE_INVALID' });
  const composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId).content;
  assert.equal(article.generationMode, 'planned-paragraphs-v1');
  assert.equal(article.paragraphBindingOrigin, 'server-plan-before-generation');
  const sections = [...h.rows.values()].filter(r => /^paper.article.section-/u.test(r.artifactKey));
  assert.equal(sections.length, h.plans.length);
  for (const section of sections) {
    assert.equal(section.content.bindingOrigin, 'server-plan-before-generation');
    assert.equal(section.content.coverageCheck, 'targeted-signatures-with-manual-review');
    assert.ok(section.content.response.paragraphs.every(p => !Object.hasOwn(p, 'claimIndexes')));
  }
  const verified = await h.verify(composed.outputRef), proof = h.rows.get(verified.outputRef.artifactId).content;
  assert.equal(proof.manualReviewRequired, true);
  assert.equal(proof.publicPublicationEnabled, false);
  assert.equal(proof.coverageCheck, 'targeted-signatures-with-manual-review');
  assert.deepEqual(await h.compose(), composed);
  assert.equal(h.cache.size, h.plans.length);
  assert.deepEqual(raw, before);
});

test('planned paragraphs cannot silently omit the known research topic despite having a prebound fact set', async () => {
  const h = await setup((out, plan) => { if (plan.ordinal === 0) {
    out.paragraphs[0].text = plan.claims.filter(c => c.narrativeRole === 'proposal').map(c => c.text).join('');
  } });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_PLANNED_FACT_OMITTED' });
  assert.equal(h.calls.length, 1);
  assert.equal(h.rows.size, 0);
});

test('new paragraph IDs, changed ordering, model-supplied indexes and outside facts fail without a later call', async t => {
  for (const [code, mutate] of [
    ['AGENT_PAPER_ARTICLE_PARAGRAPH_PLAN_MISMATCH', out => { out.paragraphs[0].paragraphId = 'paragraph-99'; }],
    ['AGENT_PAPER_ARTICLE_PARAGRAPH_PLAN_MISMATCH', out => { out.paragraphs.reverse(); }],
    ['AGENT_PAPER_ARTICLE_PARAGRAPH_PLAN_MISMATCH', out => { out.paragraphs.pop(); }],
    ['AGENT_PAPER_ARTICLE_PARAGRAPH_RESPONSE_INVALID', out => { out.paragraphs[0].claimIndexes = [1]; }],
    ['AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE', out => { out.paragraphs[1].text += '作者指出编码器自注意力的查询来自编码器前一层。'; }],
    ['AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION', out => { out.paragraphs[0].text += '注意力不能独立承担序列建模。'; }],
  ]) await t.test(code, async () => {
    const h = await setup((out, plan) => { if (plan.ordinal === 0) mutate(out); });
    await assert.rejects(h.compose(), { code });
    assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
  });
});

test('verify rejects a modified paragraph plan, provider response or generation mode even if row hashes are refreshed', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const h = await setup(), composed = await h.compose(), row = h.rows.get(composed.outputRef.artifactId);
  const entry = row.content.sectionManifest.entries[0], section = h.rows.get(entry.artifactId), original = structuredClone(section.content);
  section.content.paragraphPlan.paragraphs[0].claimIndexes = [1];
  section.contentSha256 = stableHash(section.content); entry.contentSha256 = section.contentSha256;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
  section.content = structuredClone(original);
  section.content.response.paragraphs[0].text += '注意力不能独立承担序列建模。';
  section.contentSha256 = stableHash(section.content); entry.contentSha256 = section.contentSha256;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION' });
  delete row.content.paragraphBindingOrigin;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_EVIDENCE_INVALID' });
  row.content.paragraphBindingOrigin = 'server-plan-before-generation';
  row.content.generationMode = 'bounded-sections-v1';
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_MANIFEST_INVALID' });
});
