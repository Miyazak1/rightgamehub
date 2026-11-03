const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../apps/api/src', name)));
const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-isolated-live-complete-v1.json')));
const pack = recorded.evidencePack;

test('the unchanged v9 failure now receives literal problem, existing arrangement and proposal subjects without altering its claims', async () => {
  const { isolatedParagraphPayload, validateIsolatedParagraphResponse } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { assertParagraphVoice, paragraphVoicePolicy } = await load('agent-paper-article-readability.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/paper-study-live-reporting-failure-v1.json'))), before = structuredClone(live);
  assert.equal(stableHash(live.response),live.responseSha256);
  assert.throws(()=>assertParagraphVoice(validateIsolatedParagraphResponse(live.response).text,paragraphVoicePolicy({ordinal:0,topic:'problem',editorialVersion:2})),{code:'AGENT_PAPER_ARTICLE_REPETITIVE_REPORTING_CLAUSES'});
  const claims=live.claims.map((c,i)=>({...c,index:i+1,findingKey:'arbitrary-'+i,primary:true}));
  const evidence={findings:claims.map(c=>({key:c.findingKey,text:c.text,relations:[]}))};
  const section={sectionKey:'section-01',ordinal:0,topic:'problem',topicHeading:live.requiredHeading,editorialVersion:2,metadataGeneration:'isolated-focus-v1',claims};
  const assignment={paragraphId:'paragraph-01',claimIndexes:[1,2,3],primaryClaimIndexes:[1,2,3]};
  const payload=isolatedParagraphPayload(evidence,section,assignment,0);
  assert.deepEqual(payload.claims.map(c=>c.text),live.claims.map(c=>c.text));
  assert.deepEqual(payload.statementPlan.steps.map(s=>s.subject),['循环模型','注意力机制','Transformer']);
  assert.ok(payload.statementPlan.steps.every((s,i)=>live.claims[i].text.includes(s.subject)));
  assert.match(payload.writingTask,/方案本身作说明主体/);
  assert.match(payload.connectionPolicy.objectShift,/提出关系保留为对象的作者归属/);
  assert.equal(payload.voicePolicy.maxReportingStarts,1);
  assert.deepEqual(live,before);
});

test('statement subjects generalize to another proposal and never fill an ambiguous object from outside the assigned facts', async () => {
  const { paragraphStatementSubjects, assertParagraphVoice, paragraphVoicePolicy } = await load('agent-paper-article-readability.mjs');
  const { assertParagraphAuthorAttribution } = await load('agent-paper-article-paragraph-plan.mjs');
  const claims=[{text:'作者指出，检索系统面临索引更新延迟。',narrativeRole:'research-problem'},
    {text:'缓存模块通常与检索系统组合使用。',narrativeRole:'supported-fact'},
    {text:'作者提出 Atlas，一种更新方法。',narrativeRole:'proposal'}];
  assert.deepEqual(paragraphStatementSubjects(claims).map(s=>s.subject),['检索系统','缓存模块','Atlas']);
  assert.equal(paragraphStatementSubjects([{text:'作者提出未来还要研究更多任务。',narrativeRole:'proposal'}])[0].subject,null);
  const text='检索系统面临索引更新延迟，这是论文作者指出的问题。缓存模块通常与检索系统组合使用。Atlas 是作者提出的一种更新方法。';
  assert.doesNotThrow(()=>{assertParagraphVoice(text,paragraphVoicePolicy({ordinal:0,topic:'problem',editorialVersion:2}));assertParagraphAuthorAttribution(text);});
});

test('new editorial plan gives the real residual distance claim a concrete topic without dropping or rewriting findings', async () => {
  const { buildPaperTopicSections } = await load('agent-paper-article-topic-plan.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-study-live-editorial-v1.json'))), before = structuredClone(live);
  const old = buildPaperTopicSections(live), current = buildPaperTopicSections(live, { editorialVersion: 2 });
  assert.equal(old.at(-1).topicHeading, '其他可核对的主张');
  assert.equal(current.find(s => s.topic === 'dependency-range').topicHeading, '依赖关系与序列距离');
  assert.equal(current.at(-1).topic, 'outlook');
  assert.equal(current.some(s => /其他可核对|其他主张/.test(s.topicHeading)), false);
  assert.deepEqual(current.flatMap(s => s.findingKeys).sort(), live.findings.map(f => f.key).sort());
  assert.deepEqual(live, before);
});

test('unclassified findings from other domains get separate source-derived subjects independent of keys or paper identity', async () => {
  const { buildPaperTopicSections } = await load('agent-paper-article-topic-plan.mjs');
  const evidence = { findings: [
    { kind: 'author_claim', key: 'random-a', text: '作者指出，检索模块只访问当前索引中的文档。' },
    { kind: 'author_claim', key: 'random-b', text: '作者说明，校准模块将观测误差转换为修正量。' },
  ] };
  const sections = buildPaperTopicSections(evidence, { editorialVersion: 2 });
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(s => s.topicHeading), ['检索模块的访问范围', '校准模块的说明']);
  assert.deepEqual(sections.flatMap(s => s.findingKeys), ['random-a', 'random-b']);
  const spatial = buildPaperTopicSections({ findings: [{kind:'author_claim',key:'unrelated-spatial-key',text:'作者指出，关联关系的表达不受空间距离限制。'}] }, {editorialVersion:2});
  assert.equal(spatial[0].topicHeading,'关联关系与距离');
});

test('new paragraph attribution scope rejects the unchanged real repeated reporting starts while preserving legitimate object-first attribution', async () => {
  const { paragraphVoicePolicy, assertParagraphVoice } = await load('agent-paper-article-readability.mjs');
  const { assertParagraphAuthorAttribution } = await load('agent-paper-article-paragraph-plan.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { validateIsolatedParagraphResponse } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-study-live-editorial-v1.json')));
  const opening = live.paragraphResponses[0]; assert.equal(stableHash(opening.response), opening.sourceResponseSha256);
  const text = validateIsolatedParagraphResponse(opening.response).text;
  assert.doesNotThrow(() => assertParagraphVoice(text, paragraphVoicePolicy({ ordinal: 0, topic: 'problem' })));
  assert.throws(() => assertParagraphVoice(text, paragraphVoicePolicy({ ordinal: 0, topic: 'problem', editorialVersion: 2 })), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_REPORTING_CLAUSES' });
  const policy = paragraphVoicePolicy({ ordinal: 1, topic: 'other', editorialVersion: 2 });
  for (const text of ['检索模块只访问当前索引中的文档，这是论文作者给出的访问范围。', '校准模块在论文中被描述为将观测误差转换为修正量。'])
    assert.doesNotThrow(() => { assertParagraphVoice(text, policy); assertParagraphAuthorAttribution(text); });
  assert.throws(() => assertParagraphAuthorAttribution('检索模块只访问当前索引中的文档。'), { code: 'AGENT_PAPER_ARTICLE_AUTHOR_ATTRIBUTION_MISSING' });
  assert.doesNotThrow(() => assertParagraphVoice('作者计划扩展到其他任务。', paragraphVoicePolicy({ ordinal: 7, topic: 'outlook', editorialVersion: 2 })));
  assert.throws(() => assertParagraphVoice('作者提出一种检索方法。作者计划扩展到其他任务。', paragraphVoicePolicy({ ordinal: 7, topic: 'outlook', editorialVersion: 2 })), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_REPORTING_CLAUSES' });
});

test('version nine passes generation and verification with unchanged claim coverage; repeated report clauses stop before another model call', async () => {
  const safe = await setup(() => {}, 9), composed = await safe.compose();
  const output = safe.rows.get(composed.outputRef.artifactId).content;
  assert.deepEqual([...new Set(output.paragraphEvidenceBindings.flatMap(b => b.findingKeys))].sort(), pack.findings.map(f => f.key).sort());
  await safe.verify(composed.outputRef);
  const bad = await setup((out, payload, plan) => { if (plan.ordinal === 0 && payload.paragraphId) out.text = '作者说明，' + out.text + '。作者指出，' + payload.claims[0].text; }, 9);
  await assert.rejects(bad.compose(), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_REPORTING_CLAUSES' });
  assert.equal(bad.calls.length, 2);
});

async function setup(mutate = () => {}, workflowVersion = 7) {
  const { buildPaperArticleSectionPlans } = await load('agent-paper-article-sections.mjs');
  const { createAgentPaperArticleGenerationHandlers } = await load('agent-paper-article-generation.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { paragraphInputFact, isolatedMetadataPlan } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const plans = buildPaperArticleSectionPlans(pack, { plannedParagraphs: true, isolatedParagraphs: true, topicSections: true, isolatedMetadata: workflowVersion >= 8, editorialVersion: workflowVersion >= 9 ? 2 : 1 });
  const rows = new Map(), calls = [], cache = new Map();
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway: { async invoke(request) {
    calls.push(request);
    if (cache.has(request.idempotencyKey)) return structuredClone(cache.get(request.idempotencyKey));
    const payload = JSON.parse(request.request.messages[1].content), plan = plans.find(p => p.sectionKey === payload.sectionKey);
    if (request.responseSchema.key === 'paper.article.metadata') {
      assert.deepEqual(payload, isolatedMetadataPlan(plan).payload);
      const output = { sectionKey: payload.sectionKey, title: '论文提出的架构思路', summary: '论文表述：' + payload.claims.map(c => c.text).join('') };
      mutate(output, payload, plan, null);
      const result = { status: 'succeeded', output, actionId: randomUUID() };
      cache.set(request.idempotencyKey, structuredClone(result)); return result;
    }
    const assignment = plan.paragraphPlan.paragraphs.find(p => p.paragraphId === payload.paragraphId);
    assert.deepEqual(payload.claims.map(c => c.text), assignment.claimIndexes.map(n => paragraphInputFact(plan.claims[n - 1], assignment.primaryClaimIndexes.includes(n))));
    assert.ok(payload.claims.every(c => c.attribution === '论文作者'));
    assert.equal(Object.hasOwn(payload, 'previousBody'), false);
    assert.equal(Object.hasOwn(payload, 'paragraphPlan'), false);
    assert.equal(request.promptTemplate.version, workflowVersion >= 9 ? 17 : workflowVersion >= 8 ? 12 : 8);
    assert.equal(payload.titlePolicy.language, 'zh-CN');
    assert.equal(payload.titlePolicy.focus, plan.topicHeading);
    assert.equal(Object.hasOwn(payload, 'paperTitle'), false);
    const output = { sectionKey: payload.sectionKey, paragraphId: payload.paragraphId,
      text: payload.claims.map(c => c.text).join('') + '（论文表述）', heading: payload.writeHeading ? payload.requiredHeading : null,
      article: payload.writeArticleMetadata ? { title: '论文的问题与核心方法', summary: '论文表述：' + payload.summaryPolicy.focusClaims.join('') } : null };
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
  const context = { run: { id: randomUUID(), agentUserId: randomUUID(), workflowVersion, input: {} }, stage: { id: randomUUID() },
    prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [randomUUID()] } }] };
  return { plans, rows, calls, cache,
    compose: () => handlers['paper.article.draft-shadow:compose'](context, {}),
    verify: ref => handlers['paper.article.draft-shadow:verify']({ ...context,
      prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: ref }] }, {}) };
}

test('system groups all recorded facts by topic, keeps decoder future-position constraints out of future research, and merges explanations', async () => {
  const before = structuredClone(recorded), h = await setup();
  assert.equal(h.plans.length, 7);
  const primary = h.plans.flatMap(p => p.primaryFindingKeys);
  assert.equal(primary.length, pack.findings.length);
  assert.equal(new Set(primary).size, pack.findings.length);
  const layer = h.plans.find(p => p.topic === 'layers');
  assert.equal(layer.topicHeading, '编码器与解码器的层内结构');
  assert.equal(layer.paragraphPlan.paragraphs.length, 1);
  assert.ok(layer.primaryFindingKeys.includes('masking-with-offset-constraint'));
  assert.ok(layer.primaryFindingKeys.includes('decoder-residual-and-masking'));
  const attention = h.plans.find(p => p.topic === 'attention');
  const definition = attention.paragraphPlan.paragraphs.find(p => p.claimIndexes.some(n => attention.claims[n - 1].findingKey === 'attention-function-definition'));
  assert.deepEqual(new Set(definition.claimIndexes.map(n => attention.claims[n - 1].findingKey)),
    new Set(['attention-function-definition', 'batched-query-computation', 'two-common-attention-functions']));
  const parameters = h.plans.find(p => p.topic === 'parameters');
  assert.ok(parameters.paragraphPlan.paragraphs.some(p => p.claimIndexes.some(n => parameters.claims[n - 1].findingKey === 'position-wise-feed-forward')
    && p.claimIndexes.some(n => parameters.claims[n - 1].findingKey === 'feed-forward-parameters-per-layer')));
  const positions = h.plans.find(p => p.topic === 'position-output');
  assert.ok(positions.paragraphPlan.paragraphs.some(p => p.claimIndexes.some(n => positions.claims[n - 1].findingKey === 'positional-encoding-purpose')
    && p.claimIndexes.some(n => positions.claims[n - 1].findingKey === 'positional-encoding-choices')));
  assert.deepEqual(recorded, before);
});

test('topic planning is independent of finding-key spelling, input order and paper identity; unknown verified facts are retained', async () => {
  const { buildPaperTopicSections } = await load('agent-paper-article-topic-plan.mjs');
  const changed = structuredClone(pack);
  changed.paper.title = 'A different paper';
  changed.findings = changed.findings.map((f, i) => ({ ...f, key: `renamed-${i}` })).reverse();
  const membership = e => buildPaperTopicSections(e).map(s => ({ topic: s.topic, heading: s.topicHeading,
    facts: s.findingKeys.map(k => e.findings.find(f => f.key === k).text).sort() }));
  assert.deepEqual(membership(changed), membership(pack));
  const extra = { ...structuredClone(pack.findings[0]), key: 'unfamiliar-domain', text: '作者说明了一项其他领域的明确事实。' };
  const sections = buildPaperTopicSections({ ...pack, findings: [...pack.findings, extra] });
  assert.ok(sections.find(s => s.topic === 'other').findingKeys.includes(extra.key));
  assert.equal(sections.flatMap(s => s.findingKeys).length, pack.findings.length + 1);
});

test('automatic thematic composition uses planned whole-section headings and returns model text untouched with evidence bindings', async () => {
  const h = await setup(), composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId).content;
  assert.equal(article.generationMode, 'thematic-isolated-paragraphs-v1');
  assert.deepEqual(article.content.blocks.filter(b => b.type === 'heading').slice(0, -1).map(b => b.text), h.plans.map(p => p.topicHeading));
  assert.equal(h.calls.length, 11);
  for (const call of h.calls) {
    const payload = JSON.parse(call.request.messages[1].content);
    const response = h.cache.get(call.idempotencyKey).output;
    const row = [...h.rows.values()].find(r => r.artifactKey === `paper.article.paragraph.${payload.sectionKey}.${payload.paragraphId}`);
    assert.deepEqual(row.content.response, response);
    assert.ok(payload.attributionPlacement);
    assert.ok(payload.claims.every(c => ['explain', 'brief-context'].includes(c.usage)));
  }
  assert.equal(new Set(article.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, pack.findings.length);
  const verified = await h.verify(composed.outputRef), proof = h.rows.get(verified.outputRef.artifactId).content;
  assert.equal(proof.publicPublicationEnabled, false); assert.equal(proof.manualReviewRequired, true);
  assert.deepEqual(await h.compose(), composed); assert.equal(h.cache.size, 11);
});

test('wrong headings and extra component facts fail before the next model call rather than being rewritten', async () => {
  for (const [code, mutate] of [
    ['AGENT_PAPER_ARTICLE_HEADING_PLAN_MISMATCH', out => { out.heading = '只适合首段的标题'; }],
    ['AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE', out => { out.text += '论文说明编码器自注意力的查询来自编码器前一层。'; }],
  ]) {
    const h = await setup((out, payload) => { if (payload.writeArticleMetadata) mutate(out); });
    await assert.rejects(h.compose(), { code });
    assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
  }
});

test('verify rederives thematic membership and refuses a forged heading in an assembled section', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const h = await setup(), composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId);
  const entry = article.content.sectionManifest.entries[0], section = h.rows.get(entry.artifactId);
  const childEntry = section.content.paragraphEntries[0], child = h.rows.get(childEntry.artifactId);
  child.content.response.heading = '未按主题规划的标题';
  child.contentSha256 = stableHash(child.content); childEntry.contentSha256 = child.contentSha256;
  section.contentSha256 = stableHash(section.content); entry.contentSha256 = section.contentSha256;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_HEADING_PLAN_MISMATCH' });
});

test('author-prefix projection preserves factual scope and does not mutate canonical evidence', async () => {
  const { paragraphFactText } = await load('agent-paper-article-isolated-paragraphs.mjs');
  for (const [original, expected] of [
    ['作者指出，编码器每层包含两个子层。', '编码器每层包含两个子层。'],
    ['作者说明该模型在每一步是自回归的。', '该模型在每一步是自回归的。'],
    ['作者计划将该模型扩展到其他任务。', '计划将该模型扩展到其他任务。'],
    ['论文提出一种方法。', '论文提出一种方法。'],
  ]) assert.equal(paragraphFactText(original), expected);
});

test('unmodified thematic live failures catch unsupported summary causality and excessive recall while the decoder pronoun stays valid', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-thematic-live-reference-v1.json')));
  const before = structuredClone(live);
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const plans = buildPaperArticleSectionPlans(live.evidencePack, { plannedParagraphs: true, isolatedParagraphs: true, topicSections: true });
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_PLANNED_FACT_OMITTED');
  const calls = live.recordedReceipts.filter(r => r.stage.startsWith('compose-'));
  assert.equal(calls.length, 4);
  for (const call of calls) {
    const response = validateIsolatedParagraphResponse(call.receipt.output), section = plans.find(s => s.sectionKey === response.sectionKey);
    const index = section.paragraphPlan.paragraphs.findIndex(p => p.paragraphId === response.paragraphId);
    const validate = () => validateIsolatedParagraph(response, live.evidencePack, section,
      section.paragraphPlan.paragraphs[index], index, validatePaperArticleSection);
    if (call.stage === 'compose-section-01-paragraph-01') assert.throws(validate, { code: 'AGENT_PAPER_ARTICLE_DESIGN_CAUSALITY_UNSUPPORTED' });
    else if (call.stage === 'compose-section-02-paragraph-02') assert.throws(validate, { code: 'AGENT_PAPER_ARTICLE_REFERENCE_RECAP_EXCESSIVE' });
    else {
      const { assertPlannedParagraphCoverage } = await load('agent-paper-article-paragraph-plan.mjs');
      assertPlannedParagraphCoverage(response.text, section.paragraphPlan.paragraphs[index].claimIndexes.map(n => section.claims[n - 1]));
      assert.throws(validate, { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING' });
    }
  }
  assert.deepEqual(live, before);
});

test('reference input is an original literal facet; short contrasts retain both bindings and full restatements stop generation', async () => {
  const { paragraphInputFact } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const h = await setup(), section = h.plans.find(p => p.claims.some(c => c.primary && c.narrativeRole === 'generation-order'));
  const assignment = section.paragraphPlan.paragraphs.find(p => p.primaryClaimIndexes.some(n => section.claims[n - 1].narrativeRole === 'generation-order'));
  const reference = section.claims.find(c => !c.primary && c.narrativeRole === 'proposal');
  const facet = paragraphInputFact(reference, false);
  assert.ok(reference.text.includes(facet)); assert.ok(facet.length < reference.text.length / 2);
  const before = structuredClone(reference);
  const composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId).content;
  assert.ok(article.paragraphEvidenceBindings.some(b => b.findingKeys.includes(reference.findingKey)
    && b.findingKeys.includes(section.claims[assignment.primaryClaimIndexes[0] - 1].findingKey)));
  assert.deepEqual(reference, before);
  const bad = await setup((out, payload, plan, task) => {
    if (task.claimIndexes.some(n => !task.primaryClaimIndexes.includes(n))) out.text = '论文说明，' + task.claimIndexes.map(n => plan.claims[n - 1].text).join('');
  });
  await assert.rejects(bad.compose(), { code: 'AGENT_PAPER_ARTICLE_REFERENCE_RECAP_EXCESSIVE' });
  assert.equal(bad.calls.length, 3);
});

test('design causal guard applies to summaries and stops before another provider call without altering the response', async () => {
  const { assertParagraphDesignCausality } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const claims = [{ text: '作者指出顺序计算的限制仍然存在。' }, { text: '作者提出不采用循环的模型架构。' }];
  for (const text of ['作者据此提出不采用循环的模型架构。', '因此，作者选择不采用循环的模型架构。',
    '在此基础上，作者提出不采用循环的模型架构。', '基于这一限制，作者设计一种模型。',
    '为了解决顺序计算限制，作者设计了这种模型。']) {
    assert.throws(() => assertParagraphDesignCausality(text, claims), { code: 'AGENT_PAPER_ARTICLE_DESIGN_CAUSALITY_UNSUPPORTED' });
  }
  for (const text of ['论文指出顺序计算的限制仍然存在；作者提出不采用循环的模型架构。',
    '作者说明，为使模型利用序列顺序，需要注入位置信息。']) assert.doesNotThrow(() => assertParagraphDesignCausality(text, claims));
  const supported = '作者为了解决一个明示的问题，提出一种方法';
  assert.doesNotThrow(() => assertParagraphDesignCausality(supported, [{ text: supported }]));
  const h = await setup(out => { if (out.article) out.article.summary = '作者据此提出不采用循环的模型架构。'; });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_DESIGN_CAUSALITY_UNSUPPORTED' });
  assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
  assert.equal([...h.cache.values()][0].output.article.summary, '作者据此提出不采用循环的模型架构。');
});

test('same-sentence possessive reference still refuses unknown, crossed or coordinated component subjects', async () => {
  const { assertDraftComponentBindings } = await load('agent-paper-draft-grounding.mjs');
  const decoder = [{ text: '论文说明解码器自注意力子层经过修改。' }];
  assert.doesNotThrow(() => assertDraftComponentBindings('解码器一侧，作者指出其自注意力子层经过修改。', decoder));
  for (const text of [
    '作者指出其自注意力子层经过修改。',
    '解码器一侧。作者指出其自注意力子层经过修改。',
    '编码器与解码器都使用注意力，作者指出其自注意力子层经过修改。',
    '编码器—解码器注意力中，作者指出其自注意力子层经过修改。',
  ]) assert.throws(() => assertDraftComponentBindings(text, decoder), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_REFERENCE_AMBIGUOUS' });
});

test('latest real output keeps neutral summary relations but still fails the Chinese title gate unchanged', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-thematic-live-title-rejection-v1.json')));
  const before = structuredClone(live);
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedParagraphPayload,
    assertParagraphDesignCausality } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const plans = buildPaperArticleSectionPlans(live.evidencePack, { plannedParagraphs: true, isolatedParagraphs: true, topicSections: true });
  assert.equal(live.recordedReceipts.length, 2);
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_SECTION_METADATA_INVALID');
  const call = live.recordedReceipts[1], response = validateIsolatedParagraphResponse(call.receipt.output);
  const section = plans[0], assignment = section.paragraphPlan.paragraphs[0];
  const archivedPayload = JSON.parse(call.request.messages[1].content);
  assert.deepEqual(archivedPayload.claims, isolatedParagraphPayload(live.evidencePack, section, assignment, 0).claims);
  assert.equal(Object.hasOwn(archivedPayload, 'titlePolicy'), false);
  assert.match(response.article.title, /Transformer/u);
  assert.doesNotThrow(() => assertParagraphDesignCausality(response.article.summary, assignment.claimIndexes.map(n => section.claims[n - 1])));
  assert.throws(() => validateIsolatedParagraph(response, live.evidencePack, section, assignment, 0, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_SECTION_METADATA_INVALID' });
  assert.deepEqual(live, before);
});

test('Chinese title inspection rejects foreign and disguised letters without rewriting the title', async () => {
  const { isChinesePaperTitle } = await load('agent-paper-article-title.mjs');
  for (const title of ['研究问题与核心思路', '注意力机制：模型如何组织计算？', '第２节：编码器与解码器', '模型架构与生成顺序']) {
    assert.equal(isChinesePaperTitle(title), true, title);
  }
  for (const title of ['注意力与 Transformer 架构', '注意力与 Ｔｒａｎｓｆｏｒｍｅｒ', '注意力与 𝑻 架构',
    '注意力与 Трансформер', '注意力与 α 架构', '123：！？', '', '   ', '标题\n换行']) {
    const before = title; assert.equal(isChinesePaperTitle(title), false, title); assert.equal(title, before);
  }
});

test('the generation title contract is explicit and an invalid title stops immediately with the raw output intact', async () => {
  for (const title of ['注意力与 Transformer 架构', '注意力与 Ｔｒａｎｓｆｏｒｍｅｒ 架构', '123']) {
    const h = await setup(out => { if (out.article) out.article.title = title; });
    await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_SECTION_METADATA_INVALID' });
    assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
    assert.equal([...h.cache.values()][0].output.article.title, title);
    const policy = JSON.parse(h.calls[0].request.messages[1].content).titlePolicy;
    assert.match(policy.englishNames, /正文和摘要/u); assert.match(policy.selfCheck, /逐字检查/u);
  }
});

test('verification independently rejects an invalid stored title even when child and section hashes are refreshed', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const h = await setup(), composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId);
  const entry = article.content.sectionManifest.entries[0], section = h.rows.get(entry.artifactId);
  const childEntry = section.content.paragraphEntries[0], child = h.rows.get(childEntry.artifactId);
  child.content.response.article.title = '注意力与 Ｔｒａｎｓｆｏｒｍｅｒ';
  child.contentSha256 = stableHash(child.content); childEntry.contentSha256 = child.contentSha256;
  section.contentSha256 = stableHash(section.content); entry.contentSha256 = section.contentSha256;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SECTION_METADATA_INVALID' });
});

test('latest title-policy live response has a Chinese title but still stops on unsupported body causality unchanged', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-thematic-live-causal-rejection-v1.json')));
  const before = structuredClone(live);
  const { isChinesePaperTitle } = await load('agent-paper-article-title.mjs');
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedParagraphPayload,
    assertParagraphDesignCausality } = await load('agent-paper-article-isolated-paragraphs.mjs');
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_DESIGN_CAUSALITY_UNSUPPORTED');
  assert.equal(live.recordedReceipts.length, 2);
  const call = live.recordedReceipts[1], response = validateIsolatedParagraphResponse(call.receipt.output);
  const section = buildPaperArticleSectionPlans(live.evidencePack, { plannedParagraphs: true, isolatedParagraphs: true, topicSections: true })[0];
  const assignment = section.paragraphPlan.paragraphs[0], claims = assignment.claimIndexes.map(n => section.claims[n - 1]);
  const archivedPayload = JSON.parse(call.request.messages[1].content);
  assert.deepEqual(archivedPayload.claims, isolatedParagraphPayload(live.evidencePack, section, assignment, 0).claims);
  assert.equal(Object.hasOwn(archivedPayload, 'connectionPolicy'), false);
  assert.equal(isChinesePaperTitle(response.article.title), true);
  assert.equal(isChinesePaperTitle(response.heading), true);
  assert.doesNotThrow(() => assertParagraphDesignCausality(response.article.summary, claims));
  assert.match(response.text, /在此基础上，作者提出/u);
  assert.throws(() => validateIsolatedParagraph(response, live.evidencePack, section, assignment, 0, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_DESIGN_CAUSALITY_UNSUPPORTED' });
  assert.deepEqual(live, before);
});

test('problem and proposal are explicitly presented as coexisting facts, not an implied design cause', async () => {
  const { isolatedParagraphPayload } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const h = await setup(), section = h.plans[0], assignment = section.paragraphPlan.paragraphs[0];
  const before = structuredClone({ pack, section });
  const payload = isolatedParagraphPayload(pack, section, assignment, 0);
  assert.match(payload.writingTask, /这些事实是并列说明/u);
  assert.ok(payload.connectionPolicy.prohibitedDesignBridges.includes('在此基础上'));
  assert.match(payload.connectionPolicy.betweenClaims, /单条主张内明示的条件和目的仍须保留/u);
  assert.match(payload.connectionPolicy.attribution, /不必句句重复/u);
  assert.deepEqual({ pack, section }, before);
  const composed = await h.compose();
  assert.equal((await h.verify(composed.outputRef)).outputRef.artifactId.length > 0, true);
});

test('complete live output is immutable; its orphan parameter fact is now planned with the feed-forward explanation', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-thematic-live-complete-v1.json')));
  const before = structuredClone(live);
  const { buildPaperArticleSectionPlans, validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse } = await load('agent-paper-article-isolated-paragraphs.mjs');
  assert.equal(live.originalStatus, 'generated-awaiting-human-review');
  assert.equal(live.recordedReceipts.length, 13);
  const composition = live.artifacts.find(a => a.artifactKey === 'blog.composition').content;
  assert.equal(composition.paragraphEvidenceBindings.length, 12);
  assert.equal(new Set(composition.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, live.evidencePack.findings.length);
  const raw = live.recordedReceipts.find(c => c.stage === 'compose-section-08-paragraph-01');
  const response = validateIsolatedParagraphResponse(raw.receipt.output), old = live.sectionPlans.at(-1);
  assert.equal(old.topic, 'other');
  assert.throws(() => validateIsolatedParagraph(response, live.evidencePack, old, old.paragraphPlan.paragraphs[0], 0, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_LOCAL_ANTECEDENT_MISSING' });
  const plans = buildPaperArticleSectionPlans(live.evidencePack, { plannedParagraphs: true, isolatedParagraphs: true, topicSections: true });
  const parameters = plans.find(p => p.topic === 'parameters');
  assert.equal(plans.some(p => p.topic === 'other'), false);
  assert.ok(parameters.paragraphPlan.paragraphs.some(p => {
    const facts = p.primaryClaimIndexes.map(n => parameters.claims[n - 1].text);
    return facts.some(t => /逐层使用不同参数/u.test(t)) && facts.some(t => /全连接前馈网络/u.test(t));
  }));
  assert.deepEqual(live, before);
});

test('layer-specific parameter paraphrases are recognized, and only visible local transform antecedents are accepted', async () => {
  const { draftClaimBindingGuide } = await load('agent-paper-draft-grounding.mjs');
  const { assertParagraphTransformAntecedent } = await load('agent-paper-article-isolated-paragraphs.mjs');
  for (const text of ['这些线性变换在不同位置之间相同，但逐层使用不同参数。', '这些线性变换逐层使用时采用不同的参数。', '每层采用不同参数。']) {
    assert.ok(draftClaimBindingGuide([{ kind: 'author_claim', key: 'arbitrary-key', text }]).some(g => g.topic === 'layer-specific-parameters'));
  }
  for (const text of ['论文指出，这些线性变换逐层使用不同参数。', '上一节描述了网络。该变换使用不同参数。']) {
    assert.throws(() => assertParagraphTransformAntecedent(text), { code: 'AGENT_PAPER_ARTICLE_LOCAL_ANTECEDENT_MISSING' });
  }
  for (const text of ['论文说明前馈网络包含两个线性变换。这些线性变换逐层使用不同参数。',
    '论文说明各层的线性变换使用不同参数。']) assert.doesNotThrow(() => assertParagraphTransformAntecedent(text));
});

test('recorded complete opening cannot double as the summary; concise factual overlap and single-fact openings are legitimate', async () => {
  const { assertSummaryOpeningSeparation } = await load('agent-paper-article-readability.mjs');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-thematic-live-complete-v1.json')));
  const before = structuredClone(live), content = live.artifacts.find(a => a.artifactKey === 'blog.composition').content.content;
  const opening = content.blocks.find(b => b.type === 'paragraph' && !b.text.startsWith('阅读范围：')).text;
  assert.equal(content.summary, opening);
  assert.throws(() => assertSummaryOpeningSeparation(content.summary, opening, 3), { code: 'AGENT_PAPER_ARTICLE_SUMMARY_OPENING_DUPLICATE' });
  assert.throws(() => assertSummaryOpeningSeparation(content.summary.replace(/。/gu, '；'), opening, 3), { code: 'AGENT_PAPER_ARTICLE_SUMMARY_OPENING_DUPLICATE' });
  const brief = '作者提出 Transformer，一种放弃循环、完全依赖注意力机制的模型架构。';
  assert.doesNotThrow(() => assertSummaryOpeningSeparation(brief, opening, 3));
  assert.doesNotThrow(() => assertSummaryOpeningSeparation(brief, brief, 1));
  assert.deepEqual(live, before);
});

test('object openings still require author attribution and architecture references are not new proposal actions', async () => {
  const { assertParagraphVoice, paragraphVoicePolicy, assertArchitectureContextTransition } = await load('agent-paper-article-readability.mjs');
  const { assertParagraphAuthorAttribution } = await load('agent-paper-article-paragraph-plan.mjs');
  const policy = paragraphVoicePolicy({ ordinal: 2, topic: 'attention' });
  for (const text of ['论文作者说明，注意力函数接收查询。', '按作者的说明，注意力函数接收查询。']) {
    assert.throws(() => assertParagraphVoice(text, policy), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING' });
  }
  const text = '注意力函数在论文中被描述为把查询和键值对映射到输出。';
  assert.doesNotThrow(() => { assertParagraphVoice(text, policy); assertParagraphAuthorAttribution(text); });
  assert.throws(() => assertParagraphAuthorAttribution('注意力函数把查询和键值对映射到输出。'), { code: 'AGENT_PAPER_ARTICLE_AUTHOR_ATTRIBUTION_MISSING' });
  assert.doesNotThrow(() => assertParagraphVoice('作者计划扩展到其他任务。', paragraphVoicePolicy({ ordinal: 6, topic: 'outlook' })));
  assert.throws(() => assertArchitectureContextTransition('生成过程在论文中按步骤进行。作者同时提出放弃循环。', true),
    { code: 'AGENT_PAPER_ARTICLE_CONTEXT_TRANSITION_INVALID' });
  assert.doesNotThrow(() => assertArchitectureContextTransition('放弃循环描述的是模型架构；论文说明生成下一个符号时使用先前生成的符号。', true));
});

test('summary focus is source-bound separately and an oversized recap or out-of-focus summary stops at the first call', async () => {
  for (const [code, mutate] of [
    ['AGENT_PAPER_ARTICLE_SUMMARY_OPENING_DUPLICATE', out => { out.article.summary = out.text; }],
    ['AGENT_PAPER_ARTICLE_SUMMARY_FOCUS_INVALID', (out, payload) => { out.article.summary = '论文指出，' + payload.claims[0].text; }],
  ]) {
    const h = await setup((out, payload) => { if (out.article) mutate(out, payload); });
    await assert.rejects(h.compose(), { code }); assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 0);
  }
  const h = await setup(), composed = await h.compose();
  const first = [...h.rows.values()].find(r => r.artifactKey === 'paper.article.paragraph.section-01.paragraph-01');
  const focusKeys = h.plans[0].claims.filter(c => c.primary && c.narrativeRole === 'proposal').map(c => c.findingKey);
  assert.deepEqual(first.content.summaryEvidenceBindings[0].findingKeys, focusKeys);
  assert.ok(first.content.summaryEvidenceBindings[0].evidence.every(e => e.quoteHash && e.pages.length));
  await h.verify(composed.outputRef);
});

test('author boilerplate stops before another call; verifier rechecks summary separation even with refreshed hashes', async () => {
  const h = await setup((out, payload) => { if (payload.voicePolicy.opening === 'object-first') out.text = '论文作者说明，' + out.text; });
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING' }); assert.equal(h.calls.length, 2);
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const safe = await setup(), composed = await safe.compose(), article = safe.rows.get(composed.outputRef.artifactId);
  const entry = article.content.sectionManifest.entries[0], section = safe.rows.get(entry.artifactId);
  const childEntry = section.content.paragraphEntries[0], child = safe.rows.get(childEntry.artifactId);
  child.content.response.article.summary = child.content.response.text;
  child.contentSha256 = stableHash(child.content); childEntry.contentSha256 = child.contentSha256;
  section.contentSha256 = stableHash(section.content); entry.contentSha256 = section.contentSha256;
  await assert.rejects(safe.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_SUMMARY_OPENING_DUPLICATE' });
});

test('latest raw summary uses assigned background facts but violates its narrower focus plan; parameter explanation remains grouped', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-thematic-live-summary-focus-v1.json')));
  const before = structuredClone(live);
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedParagraphPayload } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { bindDraftParagraphs } = await load('agent-paper-draft-grounding.mjs');
  const { isChinesePaperTitle } = await load('agent-paper-article-title.mjs');
  assert.equal(live.recordedReceipts.length, 2);
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE');
  const call = live.recordedReceipts[1], response = validateIsolatedParagraphResponse(call.receipt.output);
  const section = live.sectionPlans[0], assignment = section.paragraphPlan.paragraphs[0];
  assert.deepEqual(JSON.parse(call.request.messages[1].content), isolatedParagraphPayload(live.evidencePack, section, assignment, 0));
  assert.equal(isChinesePaperTitle(response.article.title), true);
  // This is a presentation-scope failure, not evidence that those background
  // facts were fabricated or unsupported by the original paragraph assignment.
  assert.doesNotThrow(() => bindDraftParagraphs([{ type: 'paragraph', text: response.article.summary,
    findingKeys: assignment.claimIndexes.map(n => section.claims[n - 1].findingKey) }], live.evidencePack,
  { requiredFindingKeys: [], strictTopics: true }));
  assert.throws(() => validateIsolatedParagraph(response, live.evidencePack, section, assignment, 0, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_SUMMARY_FOCUS_INVALID', bindingErrorCode: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  const parameters = live.sectionPlans.find(p => p.topic === 'parameters');
  assert.ok(parameters.paragraphPlan.paragraphs.some(p => {
    const texts = p.primaryClaimIndexes.map(n => parameters.claims[n - 1].text);
    return texts.some(t => /全连接前馈网络/u.test(t)) && texts.some(t => /不同层之间使用不同参数/u.test(t));
  }));
  assert.deepEqual(live, before);
});

test('v8 generates isolated metadata before body; raw outputs stay separate and source-bound through assembly and verification', async () => {
  const h = await setup(() => {}, 8), composed = await h.compose();
  assert.equal(h.calls.length, 12);
  assert.equal(h.calls[0].responseSchema.key, 'paper.article.metadata');
  const payload = JSON.parse(h.calls[0].request.messages[1].content);
  assert.equal(payload.claims.length, 1); assert.match(payload.claims[0].text, /架构/u);
  for (const key of ['previousBody', 'paperTitle', 'summaryPolicy', 'writingTask', 'paragraphPlan']) assert.equal(Object.hasOwn(payload, key), false);
  assert.equal(/顺序计算/u.test(JSON.stringify(payload)), false);
  const metadata = [...h.rows.values()].find(r => r.artifactKey === 'paper.article.metadata');
  assert.deepEqual(metadata.content.response, h.cache.get(h.calls[0].idempotencyKey).output);
  assert.ok(metadata.content.evidenceBindings.every(b => b.findingKeys.every(k => h.plans[0].claims.some(c => c.findingKey === k && c.narrativeRole === 'proposal'))));
  for (const request of h.calls.slice(1)) {
    const p = JSON.parse(request.request.messages[1].content);
    assert.equal(p.writeArticleMetadata, false); assert.equal(Object.hasOwn(p, 'summaryPolicy'), false);
    assert.equal(h.cache.get(request.idempotencyKey).output.article, null);
  }
  const article = h.rows.get(composed.outputRef.artifactId).content;
  assert.equal(article.content.summary, metadata.content.response.summary);
  const first = h.rows.get(article.sectionManifest.entries[0].artifactId);
  assert.equal(first.content.metadataEntry.artifactId, metadata.id);
  await h.verify(composed.outputRef);
  assert.deepEqual(await h.compose(), composed); assert.equal(h.cache.size, 12);
});

test('v8 invalid metadata stops before body generation and invalid body stops after exactly one metadata call', async () => {
  const badMeta = await setup((out, payload, plan, assignment) => { if (!assignment) out.title = '注意力 Transformer 架构'; }, 8);
  await assert.rejects(badMeta.compose(), { code: 'AGENT_PAPER_ARTICLE_SECTION_METADATA_INVALID' });
  assert.equal(badMeta.calls.length, 1); assert.equal(badMeta.rows.size, 0);
  const badBody = await setup((out, payload, plan, assignment) => { if (assignment) out.text += '论文说明机器翻译是本模型的测试任务。'; }, 8);
  await assert.rejects(badBody.compose(), { code: 'AGENT_PAPER_ARTICLE_TOPIC_BINDING_INCOMPLETE' });
  assert.equal(badBody.calls.length, 2); assert.equal(badBody.rows.size, 1);
  assert.equal([...badBody.rows.values()][0].artifactKey, 'paper.article.metadata');
});

test('v8 cannot return article metadata inside a paragraph or omit its separate provenance record', async () => {
  const extra = await setup((out, payload, plan, assignment) => {
    if (assignment && plan.ordinal === 0) out.article = { title: '额外标题', summary: '正文调用不能自行生成并覆盖摘要元数据。' };
  }, 8);
  await assert.rejects(extra.compose(), { code: 'AGENT_PAPER_ARTICLE_PARAGRAPH_PLAN_MISMATCH' });
  assert.equal(extra.calls.length, 2);
  const h = await setup(() => {}, 8), composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId);
  const entry = article.content.sectionManifest.entries[0], first = h.rows.get(entry.artifactId);
  delete first.content.metadataEntry;
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  first.contentSha256 = stableHash(first.content); entry.contentSha256 = first.contentSha256;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_METADATA_MANIFEST_INVALID' });
});

test('v8 verifier rechecks isolated metadata facts even after its and section hashes have been refreshed', async () => {
  const h = await setup(() => {}, 8), composed = await h.compose(), article = h.rows.get(composed.outputRef.artifactId);
  const entry = article.content.sectionManifest.entries[0], first = h.rows.get(entry.artifactId);
  const metadata = h.rows.get(first.content.metadataEntry.artifactId);
  metadata.content.response.summary = '论文作者指出顺序计算这一根本约束仍然存在，并提出不使用循环的架构。';
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  metadata.contentSha256 = stableHash(metadata.content); first.content.metadataEntry.contentSha256 = metadata.contentSha256;
  first.contentSha256 = stableHash(first.content); entry.contentSha256 = first.contentSha256;
  await assert.rejects(h.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
});

test('real v8 metadata stays isolated and distinct from the opening; the raw comparison fails on source absence after the voice false-positive fix', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-absence-v1.json')));
  const before = structuredClone(live);
  const { isolatedMetadataPlan, validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedParagraphPayload } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperMetadata } = await load('agent-paper-article-metadata.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { assertParagraphVoice, paragraphVoicePolicy, assertSummaryOpeningSeparation } = await load('agent-paper-article-readability.mjs');
  assert.equal(live.recordedReceipts.length, 5);
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING');
  const meta = live.recordedReceipts.find(r => r.stage === 'compose-metadata');
  const metaPlan = isolatedMetadataPlan(live.sectionPlans[0]);
  assert.deepEqual(JSON.parse(meta.request.messages[1].content), metaPlan.payload);
  assert.doesNotThrow(() => validatePaperMetadata(meta.receipt.output, live.evidencePack, metaPlan));
  const metadata = live.artifacts.find(a => a.artifactKey === 'paper.article.metadata').content.response;
  const bodies = live.recordedReceipts.filter(r => r.stage.startsWith('compose-section-'));
  for (const [i, call] of bodies.entries()) {
    const response = validateIsolatedParagraphResponse(call.receipt.output), section = live.sectionPlans.find(s => s.sectionKey === response.sectionKey);
    const index = section.paragraphPlan.paragraphs.findIndex(p => p.paragraphId === response.paragraphId), assignment = section.paragraphPlan.paragraphs[index];
    const validate = () => validateIsolatedParagraph(response, live.evidencePack, section, assignment, index, validatePaperArticleSection);
    if (i < 2) assert.doesNotThrow(validate);
    else {
      assert.doesNotThrow(() => assertParagraphVoice(response.text, paragraphVoicePolicy(section)));
      assert.throws(validate, { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
      assert.ok(isolatedParagraphPayload(live.evidencePack, section, assignment, index).claims.some(c => c.narrativeRole === 'architecture-context'));
    }
  }
  assert.doesNotThrow(() => assertSummaryOpeningSeparation(metadata.summary, validateIsolatedParagraphResponse(bodies[0].receipt.output).text, 3));
  assert.deepEqual(live, before);
});

test('attributive author noun phrases are allowed, but unsupported negative descriptions of the paper remain rejected clause by clause', async () => {
  const { assertParagraphVoice, paragraphVoicePolicy } = await load('agent-paper-article-readability.mjs');
  const { assertTextOnlyDraftProseClarity } = await load('agent-paper-text-draft.mjs');
  const policy = paragraphVoicePolicy({ ordinal: 2, topic: 'concepts' });
  assert.doesNotThrow(() => assertParagraphVoice('论文作者描述的该模型在每一步是自回归的。', policy));
  assert.throws(() => assertParagraphVoice('论文作者描述，该模型在每一步是自回归的。', policy), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING' });
  for (const text of ['文中并未把二者描述为同一项设计行动。', '论文未将架构与生成描述成同一动作。',
    '文中在本次选入证据范围内未把二者描述为同一行动；论文并未把二者描述为同一行动。']) {
    assert.throws(() => assertTextOnlyDraftProseClarity(text), { code: 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' });
  }
  for (const text of ['模型不使用循环，生成时使用先前输出。', '论文没有改变结构，继续描述输出过程。',
    '文中在本次选入证据范围内未把二者描述为同一行动。']) assert.doesNotThrow(() => assertTextOnlyDraftProseClarity(text));
});

test('latest unmodified comparison still fails ambiguity; its new pre-generation plan names both objects and has consistent attribution placement', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-ambiguous-v1.json')));
  const before = structuredClone(live);
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedParagraphPayload } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  assert.equal(live.recordedReceipts.length, 5);
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE');
  const call = live.recordedReceipts.at(-1), out = validateIsolatedParagraphResponse(call.receipt.output);
  const section = live.sectionPlans.find(p => p.sectionKey === out.sectionKey), index = section.paragraphPlan.paragraphs.findIndex(p => p.paragraphId === out.paragraphId);
  const assignment = section.paragraphPlan.paragraphs[index];
  assert.throws(() => validateIsolatedParagraph(out, live.evidencePack, section, assignment, index, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
  const payload = isolatedParagraphPayload(live.evidencePack, section, assignment, index);
  assert.deepEqual(payload.contrastPolicy.objectNames, ['模型架构', '逐步生成过程']);
  assert.match(payload.writingTask, /^以模型架构或逐步生成过程起句/u);
  assert.match(payload.contrastPolicy.ending, /不另加结尾对照总结/u);
  assert.match(payload.connectionPolicy.attribution, /论文归属放在句中或句末/u);
  assert.doesNotMatch(payload.connectionPolicy.attribution, /段首一次/u);
  assert.deepEqual(payload.claims.map(c => c.text), JSON.parse(call.request.messages[1].content).claims.map(c => c.text));
  assert.deepEqual(live, before);
});

test('comparison ambiguity stops generation immediately and is checked again during verification', async () => {
  const h = await setup((out, payload) => {
    if (payload.contrastPolicy) out.text += '前者描述生成顺序，后者描述模型结构。';
  }, 8);
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
  assert.equal(h.calls.length, 4);
  assert.equal([...h.rows.values()].some(r => r.artifactKey === 'blog.composition'), false);
  const safe = await setup(() => {}, 8), composed = await safe.compose(), article = safe.rows.get(composed.outputRef.artifactId);
  const entry = article.content.sectionManifest.entries[1], section = safe.rows.get(entry.artifactId);
  const childEntry = section.content.paragraphEntries[1], child = safe.rows.get(childEntry.artifactId);
  child.content.response.text += '前者描述生成顺序，后者描述模型结构。';
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  child.contentSha256 = stableHash(child.content); childEntry.contentSha256 = child.contentSha256;
  section.contentSha256 = stableHash(section.content); entry.contentSha256 = section.contentSha256;
  await assert.rejects(safe.verify(composed.outputRef), { code: 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE' });
});

test('real version10 comparison and grouped parameter prose pass unchanged; positional paragraph still fails its opening policy', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-position-style-v1.json')));
  const before = structuredClone(live);
  const { isolatedMetadataPlan, validateIsolatedParagraph, validateIsolatedParagraphResponse } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperMetadata } = await load('agent-paper-article-metadata.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { assertTextOnlyDraftProseClarity } = await load('agent-paper-text-draft.mjs');
  const { assertPlannedParagraphCoverage } = await load('agent-paper-article-paragraph-plan.mjs');
  assert.equal(live.recordedReceipts.length, 11);
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING');
  assert.equal(live.artifacts.filter(a => a.artifactKey.startsWith('paper.article.paragraph.')).length, 8);
  const meta = live.recordedReceipts.find(c => c.stage === 'compose-metadata');
  assert.doesNotThrow(() => validatePaperMetadata(meta.receipt.output, live.evidencePack, isolatedMetadataPlan(live.sectionPlans[0])));
  const calls = live.recordedReceipts.filter(c => c.stage.startsWith('compose-section-'));
  for (const [i, call] of calls.entries()) {
    const response = validateIsolatedParagraphResponse(call.receipt.output), section = live.sectionPlans.find(s => s.sectionKey === response.sectionKey);
    const index = section.paragraphPlan.paragraphs.findIndex(p => p.paragraphId === response.paragraphId), assignment = section.paragraphPlan.paragraphs[index];
    const validate = () => validateIsolatedParagraph(response, live.evidencePack, section, assignment, index, validatePaperArticleSection);
    if (i === calls.length - 1) {
      assert.doesNotThrow(() => assertTextOnlyDraftProseClarity(response.text));
      assert.doesNotThrow(() => assertPlannedParagraphCoverage(response.text, assignment.claimIndexes.map(n => section.claims[n - 1])));
      assert.throws(validate, { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING' });
    } else assert.doesNotThrow(validate);
  }
  const comparison = validateIsolatedParagraphResponse(calls.find(c => c.stage === 'compose-section-02-paragraph-02').receipt.output);
  assert.match(comparison.text, /^模型架构/u); assert.match(comparison.text, /逐步生成过程/u);
  assert.doesNotMatch(comparison.text, /前者|后者|文中并未/u);
  const parameters = validateIsolatedParagraphResponse(calls.find(c => c.stage === 'compose-section-05-paragraph-01').receipt.output);
  assert.match(parameters.text, /全连接前馈网络/u); assert.match(parameters.text, /不同层使用不同参数/u);
  assert.deepEqual(live, before);
});

test('position opening objects come only from assigned facts and prefer dropout over its positional input', async () => {
  const { paragraphOpeningObject } = await load('agent-paper-article-readability.mjs');
  const section = { topic: 'position-output' };
  assert.equal(paragraphOpeningObject(section, [{ text: '作者将位置编码加到输入嵌入上。' }]), '位置编码');
  assert.equal(paragraphOpeningObject(section, [{ text: '作者对嵌入与位置编码之和应用 dropout。' }]), 'dropout');
  assert.equal(paragraphOpeningObject(section, [{ text: '作者说明随机失活的应用位置。' }]), '随机失活');
  assert.equal(paragraphOpeningObject(section, [{ text: '作者说明另一项明确事实。' }]), null);
  assert.equal(paragraphOpeningObject({ topic: 'other' }, [{ text: '位置编码' }]), null);
});

test('positional generation now receives a literal opening object without editing old output or exempting report-style starts', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-position-style-v1.json'))), before = structuredClone(live);
  const { isolatedParagraphPayload, validateIsolatedParagraph, validateIsolatedParagraphResponse } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const call = live.recordedReceipts.at(-1), response = validateIsolatedParagraphResponse(call.receipt.output);
  const section = live.sectionPlans.find(p => p.sectionKey === response.sectionKey), assignment = section.paragraphPlan.paragraphs[0];
  const payload = isolatedParagraphPayload(live.evidencePack, section, assignment, 0);
  assert.deepEqual(payload.voicePolicy.objectNames, ['位置编码']);
  assert.match(payload.writingTask, /^以位置编码作为说明对象起句/u);
  assert.deepEqual(payload.claims, JSON.parse(call.request.messages[1].content).claims);
  assert.throws(() => validateIsolatedParagraph(response, live.evidencePack, section, assignment, 0, validatePaperArticleSection),
    { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING' });
  assert.deepEqual(live, before);
  const h = await setup((out, p) => { if (p.voicePolicy?.objectNames?.[0] === '位置编码') out.text = '论文作者指出，' + out.text; }, 8);
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING' });
  const position = h.plans.findIndex(p => p.topic === 'position-output');
  assert.equal(h.calls.length, 2 + h.plans.slice(0, position).reduce((n, p) => n + p.paragraphPlan.paragraphs.length, 0));
  assert.equal([...h.rows.values()].some(r => r.artifactKey === 'blog.composition'), false);
});

test('complete v8 live article remains immutable; all original paragraphs except the additive-component misstatement pass current checks', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-complete-v1.json'))), before = structuredClone(live);
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedMetadataPlan } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperMetadata } = await load('agent-paper-article-metadata.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { assertSummaryOpeningSeparation } = await load('agent-paper-article-readability.mjs');
  assert.equal(live.originalStatus, 'generated-awaiting-human-review'); assert.equal(live.recordedReceipts.length, 13);
  const composition = live.artifacts.find(a => a.artifactKey === 'blog.composition').content;
  assert.equal(composition.sectionManifest.entries.length, 7); assert.equal(composition.paragraphEvidenceBindings.length, 11);
  assert.equal(new Set(composition.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, live.evidencePack.findings.length);
  const metadata = live.recordedReceipts.find(c => c.stage === 'compose-metadata');
  assert.doesNotThrow(() => validatePaperMetadata(metadata.receipt.output, live.evidencePack, isolatedMetadataPlan(live.sectionPlans[0])));
  const calls = live.recordedReceipts.filter(c => c.stage.startsWith('compose-section-'));
  for (const call of calls) {
    const response = validateIsolatedParagraphResponse(call.receipt.output), section = live.sectionPlans.find(s => s.sectionKey === response.sectionKey);
    const index = section.paragraphPlan.paragraphs.findIndex(p => p.paragraphId === response.paragraphId), assignment = section.paragraphPlan.paragraphs[index];
    const validate = () => validateIsolatedParagraph(response, live.evidencePack, section, assignment, index, validatePaperArticleSection);
    if (call.stage === 'compose-section-05-paragraph-01') assert.throws(validate, { code: 'AGENT_PAPER_ARTICLE_COMPONENT_ADDITION_MISSTATED' });
    else assert.doesNotThrow(validate);
  }
  const opening = validateIsolatedParagraphResponse(calls[0].receipt.output).text;
  assert.doesNotThrow(() => assertSummaryOpeningSeparation(composition.content.summary, opening, 3));
  assert.match(validateIsolatedParagraphResponse(calls.find(c => c.stage === 'compose-section-06-paragraph-01').receipt.output).text, /^位置编码/u);
  assert.match(validateIsolatedParagraphResponse(calls.find(c => c.stage === 'compose-section-06-paragraph-02').receipt.output).text, /^dropout/u);
  assert.deepEqual(live, before);
});

test('component addition comes from literal supporting source, survives renamed keys, and never rewrites an exception into valid prose', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-complete-v1.json')));
  const { paragraphComponentRelations, assertParagraphComponentAddition } = await load('agent-paper-article-readability.mjs');
  const { isolatedParagraphPayload } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const section = live.sectionPlans.find(p => p.topic === 'parameters'), assignment = section.paragraphPlan.paragraphs[0];
  const claims = assignment.claimIndexes.map(n => section.claims[n - 1]), evidence = structuredClone(live.evidencePack);
  const relations = paragraphComponentRelations(claims, evidence);
  assert.equal(relations[0].relation, 'additional-component');
  assert.deepEqual(isolatedParagraphPayload(evidence, section, assignment, 0).componentRelations, relations);
  for (const text of ['每层都设有前馈网络，注意力子层除外。', '除了注意力子层之外，其他层包含前馈网络。']) {
    const before = text;
    assert.throws(() => assertParagraphComponentAddition(text, claims, evidence), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_ADDITION_MISSTATED' });
    assert.equal(text, before);
  }
  for (const text of ['除注意力子层外，每层还包含全连接前馈网络。', '每层在注意力子层之外还包含前馈网络。']) {
    assert.doesNotThrow(() => assertParagraphComponentAddition(text, claims, evidence));
  }
  const renamed = structuredClone(claims);
  for (const [i, c] of renamed.entries()) {
    const f = evidence.findings.find(f => f.key === c.findingKey); c.findingKey = `fresh-${i}`; f.key = c.findingKey;
  }
  assert.deepEqual(paragraphComponentRelations(renamed, evidence), relations);
  for (const e of evidence.evidence) e.quoteText = e.quoteText.replace('In addition to attention sub-layers', 'Unlike attention sub-layers');
  assert.deepEqual(paragraphComponentRelations(renamed, evidence), []);
  const h = await setup((out, p) => { if (p.componentRelations) out.text += '注意力子层除外。'; }, 8);
  await assert.rejects(h.compose(), { code: 'AGENT_PAPER_ARTICLE_COMPONENT_ADDITION_MISSTATED' });
  assert.equal([...h.rows.values()].some(r => r.artifactKey === 'blog.composition'), false);
});

test('bounded recurrence aliases share coverage, binding and literal reference projection without accepting missing source claims', async () => {
  const { recurrenceFreeFacet } = await load('agent-paper-recurrence.mjs');
  const { assertPlannedParagraphCoverage } = await load('agent-paper-article-paragraph-plan.mjs');
  const { assertDraftCallbackBindings } = await load('agent-paper-draft-grounding.mjs');
  const { paragraphInputFact } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const source = { findingKey: 'source-free', text: '作者提出不采用循环的模型架构。' };
  for (const alias of ['避开循环', '避开了循环结构', '放弃了循环', '摒弃了循环网络', '绕开了循环结构',
    '舍弃了循环神经网络', '去除了循环', '不再采用循环结构', '没有使用循环', '并未采用循环', '以注意力机制替代了循环网络']) {
    const text = `模型架构${alias}。`;
    assert.equal(recurrenceFreeFacet(text), alias);
    assert.doesNotThrow(() => assertPlannedParagraphCoverage(text, [source]));
    assert.doesNotThrow(() => assertDraftCallbackBindings(text, [source]));
    assert.throws(() => assertDraftCallbackBindings(text, [{ text: '作者说明该模型是自回归的。' }]), { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
    assert.equal(paragraphInputFact({ text, narrativeRole: 'proposal' }, false), alias);
  }
});

test('negated, uncertain and unrelated loop expressions cannot satisfy recurrence-free coverage or reverse a supported claim', async () => {
  const { recurrenceFreeFacet } = await load('agent-paper-recurrence.mjs');
  const { assertPlannedParagraphCoverage } = await load('agent-paper-article-paragraph-plan.mjs');
  const { assertDraftCallbackBindings } = await load('agent-paper-draft-grounding.mjs');
  const source = { findingKey: 'free', text: '作者提出避开循环的模型架构。' };
  for (const text of ['模型并未避开循环结构。', '模型没有完全避开循环。', '这不是无循环的架构。',
    '模型避开了循环中的某个位置。', '系统绕开了循环依赖。', '模型去除了循环次数。',
    '如果避开循环，模型可能改变。', '模型是否不采用循环？', '模型避开了训练过程中的循环。']) {
    assert.equal(recurrenceFreeFacet(text), null, text);
    assert.throws(() => assertPlannedParagraphCoverage(text, [source]), { code: 'AGENT_PAPER_ARTICLE_PLANNED_FACT_OMITTED' });
  }
  const denial = '模型并未避开循环结构。';
  assert.throws(() => assertDraftCallbackBindings(denial, [source]), { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  assert.doesNotThrow(() => assertDraftCallbackBindings(denial, [{ text: denial }]));
  assert.throws(() => assertDraftCallbackBindings('模型避开了循环结构。', [{ text: denial }]), { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
});

test('the unchanged real aspect-form response now passes all local checks while its original failed report remains intact', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-recurrence-aspect-v1.json'))), before = structuredClone(live);
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedMetadataPlan } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperMetadata } = await load('agent-paper-article-metadata.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  assert.equal(live.originalErrorCode, 'AGENT_PAPER_ARTICLE_PLANNED_FACT_OMITTED');
  assert.equal(live.recordedReceipts.length, 5);
  assert.doesNotThrow(() => validatePaperMetadata(live.recordedReceipts.find(r => r.stage === 'compose-metadata').receipt.output,
    live.evidencePack, isolatedMetadataPlan(live.sectionPlans[0])));
  for (const call of live.recordedReceipts.filter(r => r.stage.startsWith('compose-section-'))) {
    const response = validateIsolatedParagraphResponse(call.receipt.output), section = live.sectionPlans.find(s => s.sectionKey === response.sectionKey);
    const index = section.paragraphPlan.paragraphs.findIndex(p => p.paragraphId === response.paragraphId);
    assert.doesNotThrow(() => validateIsolatedParagraph(response, live.evidencePack, section, section.paragraphPlan.paragraphs[index], index, validatePaperArticleSection));
  }
  assert.match(validateIsolatedParagraphResponse(live.recordedReceipts.at(-1).receipt.output).text, /避开了循环结构/u);
  assert.deepEqual(live, before);
});

test('new aliases cannot introduce an unbound architectural recall or contradict its assigned polarity during generation', async () => {
  const extra = await setup((out, p, plan, assignment) => {
    if (assignment && plan.topic === 'concepts' && p.writeHeading) out.text += '模型避开了循环结构。';
  }, 8);
  await assert.rejects(extra.compose(), { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  assert.equal(extra.calls.length, 3);
  const opposite = await setup((out, p) => { if (p.contrastPolicy) out.text += '模型并未避开循环结构。'; }, 8);
  await assert.rejects(opposite.compose(), { code: 'AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE' });
  assert.equal(opposite.calls.length, 4);
  assert.equal([...opposite.rows.values()].some(r => r.artifactKey === 'blog.composition'), false);
});

test('latest complete real v8 draft keeps additive components correct and all selected facts bound without changing raw outputs', async () => {
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paper-metadata-split-live-addition-success-v1.json'))), before = structuredClone(live);
  const { validateIsolatedParagraph, validateIsolatedParagraphResponse, isolatedMetadataPlan } = await load('agent-paper-article-isolated-paragraphs.mjs');
  const { validatePaperMetadata } = await load('agent-paper-article-metadata.mjs');
  const { validatePaperArticleSection } = await load('agent-paper-article-sections.mjs');
  const { assertSummaryOpeningSeparation } = await load('agent-paper-article-readability.mjs');
  assert.equal(live.originalStatus, 'generated-awaiting-human-review'); assert.equal(live.recordedReceipts.length, 14);
  const composition = live.artifacts.find(a => a.artifactKey === 'blog.composition').content;
  assert.equal(composition.paragraphEvidenceBindings.length, 12); assert.equal(composition.sectionManifest.entries.length, 8);
  assert.equal(new Set(composition.paragraphEvidenceBindings.flatMap(b => b.findingKeys)).size, live.evidencePack.findings.length);
  const metadata = live.recordedReceipts.find(c => c.stage === 'compose-metadata');
  assert.doesNotThrow(() => validatePaperMetadata(metadata.receipt.output, live.evidencePack, isolatedMetadataPlan(live.sectionPlans[0])));
  const calls = live.recordedReceipts.filter(c => c.stage.startsWith('compose-section-'));
  for (const call of calls) {
    const response = validateIsolatedParagraphResponse(call.receipt.output), section = live.sectionPlans.find(s => s.sectionKey === response.sectionKey);
    const index = section.paragraphPlan.paragraphs.findIndex(p => p.paragraphId === response.paragraphId);
    assert.doesNotThrow(() => validateIsolatedParagraph(response, live.evidencePack, section, section.paragraphPlan.paragraphs[index], index, validatePaperArticleSection));
  }
  const parameters = validateIsolatedParagraphResponse(calls.find(c => c.stage === 'compose-section-05-paragraph-01').receipt.output).text;
  assert.match(parameters, /每一层在注意力子层之外，还包含/u);
  assert.match(parameters, /不同层之间使用不同参数/u);
  assert.doesNotMatch(parameters, /注意力子层除外/u);
  assert.doesNotThrow(() => assertSummaryOpeningSeparation(composition.content.summary, validateIsolatedParagraphResponse(calls[0].receipt.output).text, 3));
  assert.deepEqual(live, before);
});

test('real final-section failure keeps its raw response rejected and receives a separate proposal and future-plan instruction', async () => {
  const live=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/paper-study-live-outlook-reporting-failure-v1.json'))), before=structuredClone(live);
  const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
  const {isolatedParagraphPayload,validateIsolatedParagraphResponse}=await load('agent-paper-article-isolated-paragraphs.mjs');
  const {assertParagraphVoice,paragraphVoicePolicy}=await load('agent-paper-article-readability.mjs');
  assert.equal(stableHash(live.response),live.responseSha256);
  const claims=live.claims.map((c,i)=>({...c,index:i+1,findingKey:'renamed-'+i,primary:true}));
  const section={sectionKey:'section-any',ordinal:7,topic:'outlook',topicHeading:live.requiredHeading,editorialVersion:2,metadataGeneration:'isolated-focus-v1',claims};
  const assignment={paragraphId:'paragraph-01',claimIndexes:[1,2],primaryClaimIndexes:[1,2]};
  const payload=isolatedParagraphPayload({findings:[]},section,assignment,0);
  assert.deepEqual(payload.claims,live.claims);
  assert.equal(payload.statementPlan.steps[0].subject,'Transformer');
  assert.equal(payload.statementPlan.steps[1].subject,null);
  assert.match(payload.statementPlan.temporalSeparation,/不把拟开展的工作写成已完成/);
  assert.match(payload.writingTask,/后续计划/);
  assert.equal(payload.voicePolicy.maxReportingStarts,1);
  assert.throws(()=>assertParagraphVoice(validateIsolatedParagraphResponse(live.response).text,paragraphVoicePolicy(section)),{code:'AGENT_PAPER_ARTICLE_REPETITIVE_REPORTING_CLAUSES'});
  const historic=isolatedParagraphPayload({findings:[]},{...section,editorialVersion:1},assignment,0);
  assert.equal(historic.statementPlan,undefined);
  assert.deepEqual(live,before);
});

test('future-plan organization applies to unrelated domains and allows attribution without repeated author reports', async () => {
  const {isolatedParagraphPayload}=await load('agent-paper-article-isolated-paragraphs.mjs');
  const {assertParagraphVoice}=await load('agent-paper-article-readability.mjs');
  const {assertParagraphAuthorAttribution}=await load('agent-paper-article-paragraph-plan.mjs');
  const claims=[{text:'作者提出 Atlas，一种检索方法。',narrativeRole:'proposal'},
    {text:'作者计划研究跨语言检索，并将该方法扩展到其他文档类型。',narrativeRole:'supported-fact'}];
  const section={sectionKey:'different',ordinal:2,topic:'outlook',topicHeading:'检索方法与后续研究',editorialVersion:2,metadataGeneration:'isolated-focus-v1',claims};
  const payload=isolatedParagraphPayload({findings:[]},section,{paragraphId:'p',claimIndexes:[1,2],primaryClaimIndexes:[1,2]},0);
  assert.equal(payload.statementPlan.steps[0].subject,'Atlas');
  assert.deepEqual(payload.claims.map(c=>c.text),['提出 Atlas，一种检索方法。','计划研究跨语言检索，并将该方法扩展到其他文档类型。']);
  const text='Atlas 是作者提出的一种检索方法。作者的后续计划包括研究跨语言检索，并将该方法扩展到其他文档类型。';
  assert.doesNotThrow(()=>{assertParagraphVoice(text,payload.voicePolicy);assertParagraphAuthorAttribution(text);});
  assert.throws(()=>assertParagraphAuthorAttribution('Atlas 是一种检索方法。后续计划包括研究跨语言检索。'),{code:'AGENT_PAPER_ARTICLE_AUTHOR_ATTRIBUTION_MISSING'});
});


test('raw relation-opening failure remains rejected while planning uses literal visible component subjects', async () => {
  const live=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/paper-study-live-relation-opening-failure-v1.json'))),before=structuredClone(live);
  const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
  const {isolatedParagraphPayload,validateIsolatedParagraphResponse}=await load('agent-paper-article-isolated-paragraphs.mjs');
  const {assertParagraphVoice}=await load('agent-paper-article-readability.mjs');
  const claims=live.claims.map((c,i)=>({...c,findingKey:'changed-'+i}));
  const section={sectionKey:'any',ordinal:3,topic:live.topic,editorialVersion:2,metadataGeneration:'isolated-focus-v1',claims};
  const assignment={paragraphId:'p',claimIndexes:[1,2,3],primaryClaimIndexes:[1,2,3]};
  const payload=isolatedParagraphPayload({findings:[]},section,assignment,1);
  assert.equal(stableHash(live.response),live.responseSha256);
  assert.deepEqual(payload.claims,live.claims);
  assert.deepEqual(payload.relationSubjectPlan.steps.map(s=>s.subject),['编码器-解码器注意力层','编码器','解码器中的自注意力层']);
  assert.deepEqual(payload.voicePolicy.objectNames,['编码器-解码器注意力层']);
  assert.match(payload.writingTask,/论文作者归属/);
  assert.throws(()=>assertParagraphVoice(validateIsolatedParagraphResponse(live.response).text,payload.voicePolicy),{code:'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING'});
  assert.equal(isolatedParagraphPayload({findings:[]},{...section,editorialVersion:1},assignment,1).relationSubjectPlan,undefined);
  assert.deepEqual(live,before);
});

test('relation subjects generalize across domains and unknown primary objects cannot borrow reference subjects', async () => {
  const {paragraphRelationSubjectPlan,assertParagraphVoice,paragraphVoicePolicy}=await load('agent-paper-article-readability.mjs');
  const {assertParagraphAuthorAttribution}=await load('agent-paper-article-paragraph-plan.mjs');
  const claims=[{text:'作者说明，在检索模块内，查询来自调用方，候选来自当前索引。',narrativeRole:'method-relation'},
    {text:'缓存模块只访问当前分区。',narrativeRole:'supported-fact'}];
  const before=structuredClone(claims),plan=paragraphRelationSubjectPlan(claims,[1,2]);
  assert.equal(plan.openingObject,'检索模块');
  assert.deepEqual(plan.steps.map(s=>s.subject),['检索模块','缓存模块']);
  assert.ok(plan.steps.every((s,i)=>claims[i].text.includes(s.subject)));
  assert.equal(paragraphRelationSubjectPlan([{text:'这里采用另一种连接方式。',narrativeRole:'method-relation'},...claims],[1]),null);
  assert.equal(paragraphRelationSubjectPlan(claims.map(c=>({...c,narrativeRole:'supported-fact'})),[1]),null);
  const text='检索模块内的查询在论文中被说明为来自调用方，候选来自当前索引。缓存模块只访问当前分区。';
  assert.doesNotThrow(()=>{assertParagraphVoice(text,paragraphVoicePolicy({ordinal:2,editorialVersion:2}));assertParagraphAuthorAttribution(text);});
  assert.throws(()=>assertParagraphAuthorAttribution('检索模块的查询来自调用方。'),{code:'AGENT_PAPER_ARTICLE_AUTHOR_ATTRIBUTION_MISSING'});
  assert.deepEqual(claims,before);
});

test('relation planning preserves narrowed references and core-first object selection', async () => {
  const {isolatedParagraphPayload}=await load('agent-paper-article-isolated-paragraphs.mjs');
  const section={sectionKey:'test',ordinal:2,topic:'attention',editorialVersion:2,metadataGeneration:'isolated-focus-v1',claims:[
    {text:'作者提出不使用循环、完全依赖注意力的模型架构。',narrativeRole:'proposal'},
    {text:'在检索模块中，查询来自调用方。',narrativeRole:'method-relation'}]};
  const payload=isolatedParagraphPayload({findings:[]},section,{paragraphId:'p',claimIndexes:[1,2],primaryClaimIndexes:[2]},1);
  assert.equal(payload.relationSubjectPlan.openingObject,'检索模块');
  assert.equal(payload.claims[0].text,'不使用循环');
  assert.equal(payload.claims[0].usage,'brief-context');
  assert.equal(payload.relationSubjectPlan.steps[0].subject,null);
  assert.equal(JSON.stringify(payload.relationSubjectPlan).includes('完全依赖注意力'),false);
});

test('relation paragraph author opening stops the workflow before saving a composition; valid bindings still verify', async () => {
  const good=await setup(()=>{},9),ref=await good.compose();
  await assert.doesNotReject(good.verify(ref.outputRef));
  const bad=await setup((out,p)=>{if(p.relationSubjectPlan)out.text='论文作者说明，'+out.text;},9);
  await assert.rejects(bad.compose(),{code:'AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING'});
  assert.equal([...bad.rows.values()].some(r=>r.artifactKey==='blog.composition'),false);
  assert.equal(bad.calls.filter(c=>JSON.parse(c.request.messages[1].content).relationSubjectPlan).length,1);
});


test('raw successful v16 response remains immutable and its location-like attribution is rejected only by the new style policy', async () => {
  const live=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/paper-study-live-awkward-attribution-v1.json'))),before=structuredClone(live);
  const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
  const {isolatedParagraphPayload,validateIsolatedParagraphResponse}=await load('agent-paper-article-isolated-paragraphs.mjs');
  const {assertParagraphVoice}=await load('agent-paper-article-readability.mjs');
  assert.equal(live.originalPassed,true);assert.equal(stableHash(live.response),live.responseSha256);
  const section={sectionKey:'renamed',ordinal:3,topic:live.topic,topicHeading:live.requiredHeading,editorialVersion:2,metadataGeneration:'isolated-focus-v1',claims:live.claims};
  const assignment={paragraphId:'p',claimIndexes:[1,2,3],primaryClaimIndexes:[1,2,3]};
  const payload=isolatedParagraphPayload({findings:[]},section,assignment,0);
  assert.deepEqual(payload.claims,live.claims);
  assert.match(payload.voicePolicy.naturalAttribution.instruction,/定义保持作者定义的范围/);
  const raw=validateIsolatedParagraphResponse(live.response).text;
  assert.throws(()=>assertParagraphVoice(raw,payload.voicePolicy),{code:'AGENT_PAPER_ARTICLE_AWKWARD_ATTRIBUTION'});
  const legacy=isolatedParagraphPayload({findings:[]},{...section,editorialVersion:1},assignment,0);
  assert.equal(legacy.voicePolicy.naturalAttribution,undefined);
  assert.doesNotThrow(()=>assertParagraphVoice(raw,legacy.voicePolicy));
  assert.deepEqual(live,before);
});

test('natural attribution accepts ordinary definitions, proposals and future plans without dropping source attribution', async () => {
  const {assertParagraphVoice,paragraphVoicePolicy}=await load('agent-paper-article-readability.mjs');
  const {assertParagraphAuthorAttribution}=await load('agent-paper-article-paragraph-plan.mjs');
  const policy=paragraphVoicePolicy({ordinal:2,editorialVersion:2});
  for(const text of ['检索函数在论文中被定义为把查询映射到候选集合。','检索函数的定义来自论文：输入为查询，输出为候选集合。',
    'Atlas 是作者提出的检索方法。作者的后续计划包括研究跨语言检索。','缓存模块在作者看来需要单独验证。',
    '实验数据保存在作者那里，论文注明了访问方式。','查询在论文中被说明为来自调用方。']){
    assert.doesNotThrow(()=>{assertParagraphVoice(text,policy);assertParagraphAuthorAttribution(text);});
  }
  for(const text of ['检索函数在作者那里被描述为候选映射。','缓存模块在作者那儿被定义为中间组件。','检索模块在论文作者那边被解释为查询入口。']){
    const original=text;
    assert.throws(()=>assertParagraphVoice(text,policy),{code:'AGENT_PAPER_ARTICLE_AWKWARD_ATTRIBUTION'});
    assert.equal(text,original);
  }
  assert.throws(()=>assertParagraphAuthorAttribution('检索函数把查询映射到候选集合。'),{code:'AGENT_PAPER_ARTICLE_AUTHOR_ATTRIBUTION_MISSING'});
});

test('awkward attribution stops composition immediately and never causes an automatic response rewrite or retry', async () => {
  let original;
  const h=await setup((out,p)=>{if(p.paragraphId&&!original){out.text+='该函数在论文作者那里被描述为一种映射。';original=out.text;}},9);
  await assert.rejects(h.compose(),{code:'AGENT_PAPER_ARTICLE_AWKWARD_ATTRIBUTION'});
  assert.equal(h.calls.length,2);
  const receipt=[...h.cache.values()].at(-1);
  assert.equal(receipt.output.text,original);
  assert.equal([...h.rows.values()].some(r=>r.artifactKey==='blog.composition'),false);
});
