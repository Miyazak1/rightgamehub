const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const uuid = () => crypto.randomUUID();
const scores = { readerValue: 82, handsOnPotential: 78, novelty: 70, explainability: 88,
  evidenceStrength: 90 };

test('public selection repairs contextual index errors once without approving invalid references',async t=>{
 const {createAgentBlogFoundationGenerationHandlers}=await load('agent-blog-foundation-generation.mjs');
 for(const invalidIndexes of [[0],[2],['1'],[1,1],[]])await t.test(JSON.stringify(invalidIndexes),async()=>{
  const id=uuid(),calls=[],saved=[];
  const valid={mode:'single',selectedIndexes:[1],angle:'从第一次体验的具体路径判断项目价值',
   rationale:'官方固定版本资料给出了清楚的安装步骤、可观察的输出结果和具体使用边界，适合独立研究。',
   interestSignals:['可以快速体验'],comparisonAxes:[],scores,decisionReasonCodes:['EVIDENCE_STRONG']};
  const handlers=createAgentBlogFoundationGenerationHandlers({workflowKey:'blog.project.single',
   providerGateway:{invoke:async input=>{calls.push(input);return {actionId:uuid(),output:{...valid,selectedIndexes:calls.length===1?invalidIndexes:[1]}};}},
   artifactRepository:{readToolArtifact:async()=>evidence(id),save:async input=>{saved.push(input);return {id:uuid(),artifactKey:input.artifactKey,contentSha256:'a'.repeat(64)};}}});
  await handlers['blog.project.single:select-subject'](context(uuid(),uuid(),'select-subject',[
   {stageKey:'collect-evidence',status:'succeeded',outputRef:{artifactIds:[id]}}]),{workerId:'worker',leaseToken:uuid()});
  assert.equal(calls.length,2);assert.equal(saved.length,1);
  const first=JSON.parse(calls[0].request.messages[1].content),repair=JSON.parse(calls[1].request.messages[1].content);
  assert.deepEqual(first.selectionContract.allowedIndexes,[1]);assert.equal(first.candidates[0].discoverySourceIndex,undefined);
  assert.deepEqual(repair.correction.validation.allowedIndexes,[1]);
  assert.deepEqual(saved[0].content.selection.selectedIndexes,[1]);
 });
 await t.test('a schema repair that still has invalid indexes cannot request a third call',async()=>{
  const id=uuid();let calls=0,saves=0;
  const handlers=createAgentBlogFoundationGenerationHandlers({workflowKey:'blog.project.single',
   providerGateway:{invoke:async()=>({actionId:uuid(),output:++calls===1?{}:{mode:'single',selectedIndexes:[2],angle:'足够具体的研究角度用于校验',rationale:'官方固定版本资料给出了清楚的安装步骤、可观察的输出结果和具体使用边界，适合独立研究。',interestSignals:['可以快速体验'],comparisonAxes:[],scores,decisionReasonCodes:['EVIDENCE_STRONG']}})},
   artifactRepository:{readToolArtifact:async()=>evidence(id),save:async()=>{saves++;}}});
  await assert.rejects(handlers['blog.project.single:select-subject'](context(uuid(),uuid(),'select-subject',[
   {stageKey:'collect-evidence',status:'succeeded',outputRef:{artifactIds:[id]}}]),{workerId:'worker',leaseToken:uuid()}),error=>error.code==='AGENT_BLOG_SELECTION_INDEX_INVALID');
  assert.equal(calls,2);assert.equal(saves,0);
 });
 await t.test('filtered original candidate two is exposed only as current source one and remains bound to its artifact',async()=>{
  const ids=[uuid(),uuid(),uuid()],sources=ids.map((id,index)=>evidence(id,'owner/project'+index));
  sources[0].content.metadata.licenseSpdx=null;sources[2].content.metadata.archived=true;
  let saved;
  const handlers=createAgentBlogFoundationGenerationHandlers({workflowKey:'blog.project.single',
   providerGateway:{invoke:async input=>{const view=JSON.parse(input.request.messages[1].content);
    assert.deepEqual(view.selectionContract.allowedIndexes,[1]);assert.equal(view.candidates.length,1);
    assert.equal(view.candidates[0].sourceIndex,1);assert.equal(view.candidates[0].discoverySourceIndex,undefined);
    return {actionId:uuid(),output:{mode:'single',selectedIndexes:[1],angle:'通过首次体验路径判断开放项目的价值',rationale:'官方资料有明确的安装步骤、可观察的结果和使用边界，适合以首次体验路径开展独立研究。',interestSignals:['可以快速体验'],comparisonAxes:[],scores,decisionReasonCodes:['EVIDENCE_STRONG']}};}},
   artifactRepository:{readToolArtifact:async({artifactId})=>sources[ids.indexOf(artifactId)],save:async input=>{saved=input;return{id:uuid(),artifactKey:input.artifactKey,contentSha256:'a'.repeat(64)};}}});
  await handlers['blog.project.single:select-subject'](context(uuid(),uuid(),'select-subject',[
   {stageKey:'collect-evidence',status:'succeeded',outputRef:{artifactIds:ids}}]),{workerId:'worker',leaseToken:uuid()});
  assert.deepEqual(saved.content.selection.selectedToolArtifactIds,[ids[1]]);
 });
});

function evidence(artifactId, name = 'owner/project') {
  return {
    id: artifactId,
    content: {
      schemaVersion: 'github-repository-evidence-v1',
      repository: { key: name, canonicalUrl: `https://github.com/${name}`, owner: name.split('/')[0], name: name.split('/')[1] },
      sourceVersion: { revision: 'a'.repeat(40), canonicalUri: `https://github.com/${name}/tree/${'a'.repeat(40)}`,
        fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: 'b'.repeat(64) },
      metadata: { name: name.split('/')[1], fullName: name, description: '一个可以快速体验并展示直观结果的开源工具。',
        homepage: null, defaultBranch: 'main', stars: 10, forks: 2, openIssues: 1, topics: ['tool'],
        licenseSpdx: 'MIT', archived: false, pushedAt: '2026-10-25T00:00:00.000Z' },
      readme: { canonicalUri: `https://github.com/${name}/blob/${'a'.repeat(40)}/README.md`, path: 'README.md',
        text: '这是经过服务器固定版本读取的项目说明。它介绍安装方式、主要用途、输出结果和适用边界，足以支持文章中的项目事实。'.repeat(8) },
    },
  };
}

function context(runId, stageId, stageKey, prerequisites) {
  return {
    run: { id: runId, agentUserId: uuid(), configSnapshot: {}, input: {
      topicScope: '寻找有趣而且实用的开源人工智能工具', recentTitles: [], previousRepositoryUrls: [],
    } },
    stage: { id: stageId, stageKey }, prerequisites,
  };
}

test('foundation generation separates provider selection and composition from deterministic verification', async () => {
  const { createAgentBlogFoundationGenerationHandlers } = await load('agent-blog-foundation-generation.mjs');
  const runId = uuid();
  const toolArtifactId = uuid();
  const stored = new Map();
  const tool = evidence(toolArtifactId);
  let counter = 0;
  const artifactRepository = {
    readToolArtifact: async ({ artifactId }) => artifactId === toolArtifactId ? structuredClone(tool) : assert.fail('unexpected tool artifact'),
    read: async ({ artifactId }) => structuredClone(stored.get(artifactId)),
    save: async input => {
      const id = uuid();
      const item = { id, artifactKey: input.artifactKey, contentSha256: String(++counter).padStart(64, '0'),
        content: structuredClone(input.content) };
      stored.set(id, item);
      return { ...item, existing: false };
    },
  };
  const providerCalls = [];
  const articleParagraph = '这个项目把复杂步骤收进清楚的流程，让第一次接触它的读者也能看到输入、处理和输出之间的关系。资料能够确认它提供明确的使用说明和可观察结果，因此文章把重点放在实际体验、适用边界和验证方法上，而不是热词。'.repeat(5);
  const providerGateway = {
    invoke: async input => {
      providerCalls.push(input);
      if (input.action.actionKey === 'select-subject') return {
        status: 'succeeded', actionId: uuid(), output: { mode: 'single', selectedIndexes: [1],
          angle: '从普通用户第一次完成体验的路径观察项目价值',
          rationale: '资料同时展示了清楚说明、可观察结果和常见使用场景，符合小墨鱼关注快速体验与结果直观的兴趣方向。',
          interestSignals: ['可以快速体验：安装后能够很快看到可验证结果。'], comparisonAxes: [],
          scores, decisionReasonCodes: ['EVIDENCE_STRONG', 'USE_CASE_CONCRETE'] },
      };
      return { status: 'succeeded', actionId: uuid(), output: {
        title: '让复杂工具真正动手做事', summary: '这篇文章依据固定版本的项目资料，说明它如何把复杂工作整理成可理解、可验证的实践路径，并分析适用对象和使用边界。',
        blocks: [
          { type: 'heading', level: 2, text: '它解决了什么问题' },
          { type: 'paragraph', text: articleParagraph, citationIndexes: [1] },
          { type: 'heading', level: 2, text: '如何判断是否适合自己' },
          { type: 'paragraph', text: articleParagraph, citationIndexes: [1] },
          { type: 'heading', level: 2, text: '先做一次小规模验证' },
          { type: 'list', text: articleParagraph, citationIndexes: [1] },
        ],
        followUpQuestions: ['第一次体验应该从哪里开始？', '这个项目更适合哪些使用者？', '验证结果时最容易忽略什么？'],
      } };
    },
  };
  const handlers = createAgentBlogFoundationGenerationHandlers({ providerGateway, artifactRepository });
  const execution = { workerId: 'worker', leaseToken: uuid() };
  const selectContext = context(runId, uuid(), 'select-subject', [{ stageKey: 'collect-evidence', status: 'succeeded',
    outputRef: { artifactIds: [toolArtifactId] } }]);
  const selected = await handlers['blog.project.single.draft-shadow:select-subject'](selectContext, execution);
  assert.equal(selected.outputRef.artifactKey, 'blog.selection');
  assert.deepEqual(stored.get(selected.outputRef.artifactId).content.selection.interestSignals, ['可以快速体验']);
  const composeContext = context(runId, uuid(), 'compose', [{ stageKey: 'select-subject', status: 'succeeded',
    outputRef: selected.outputRef }]);
  const composed = await handlers['blog.project.single.draft-shadow:compose'](composeContext, execution);
  assert.equal(composed.outputRef.artifactKey, 'blog.composition');
  assert.equal(stored.get(composed.outputRef.artifactId).content.content.blocks[5].type, 'paragraph');
  const verifyContext = context(runId, uuid(), 'verify', [{ stageKey: 'compose', status: 'succeeded',
    outputRef: composed.outputRef }]);
  const verified = await handlers['blog.project.single.draft-shadow:verify'](verifyContext, execution);
  assert.equal(verified.outputRef.approved, true);
  assert.equal(providerCalls.length, 2);
  assert.deepEqual(providerCalls.map(item => item.action.actionKey), ['select-subject', 'compose']);
  assert.deepEqual(providerCalls[0].promptTemplate, { key: 'blog.subject.select', version: 7 });
  assert.deepEqual(providerCalls[1].promptTemplate, { key: 'blog.article.compose', version: 5 });
  assert(providerCalls[0].request.messages[1].content.includes('allowedInterestSignals'));
  assert(providerCalls[0].request.messages[1].content.includes('eligibleModes'));
  assert.equal(stored.get(selected.outputRef.artifactId).content.gateReport.acceptedCount, 1);
  assert(providerCalls.every(item => item.action.capabilityKey === 'provider.text.generate' && item.action.riskLevel === 'L2'));
  assert.equal(providerCalls.some(item => item.action.actionKey === 'verify'), false);
  const verification = stored.get(verified.outputRef.artifactId).content;
  assert.equal(verification.approved, true);
  assert.equal(Object.hasOwn(verification, 'content'), false);
});

async function citationFixture({ outputs, count = 1, workflowKey = 'blog.project.single', providerError } = {}) {
  const { createAgentBlogFoundationGenerationHandlers } = await load('agent-blog-foundation-generation.mjs');
  const runId = uuid(), selectionId = uuid(), tools = Array.from({ length: count }, () => uuid());
  const selection = { mode: count === 1 ? 'single' : 'comparison', selectedIndexes: count === 1 ? [2] : [2, 4],
    selectedToolArtifactIds: tools, repositories: tools.map((_id, index) => `owner/tool${index}`),
    repositoryUrls: tools.map((_id, index) => `https://github.com/owner/tool${index}`),
    angle: '用可验证的实际体验理解开放工具', rationale: '仅根据已选项目的固定版本官方资料组织文章。' };
  const calls = [], saves = [];
  const handlers = createAgentBlogFoundationGenerationHandlers({ workflowKey,
    artifactRepository: {
      read: async () => ({ content: { schemaVersion: 'blog-subject-selection-v2', selection } }),
      readToolArtifact: async ({ artifactId }) => evidence(artifactId, selection.repositories[tools.indexOf(artifactId)]),
      save: async value => { saves.push(value); return { id: uuid(), artifactKey: value.artifactKey, contentSha256: 'c'.repeat(64) }; },
    },
    providerGateway: { invoke: async input => {
      calls.push(structuredClone(input));
      if (calls.length === 2 && providerError) throw providerError;
      return { actionId: `fixture-action-${calls.length}`, output: structuredClone(outputs[Math.min(calls.length - 1, outputs.length - 1)]) };
    } },
  });
  const input = context(runId, uuid(), 'compose', [{ stageKey: 'select-subject', status: 'succeeded',
    outputRef: { artifactId: selectionId, artifactKey: 'blog.selection' } }]);
  return { calls, saves, selection, run: () => handlers[`${workflowKey}:compose`](input, { workerId: 'worker', leaseToken: uuid() }) };
}

function citationArticle(indexes = [1]) {
  const text = '项目官方资料介绍了清楚的输入输出、具体的使用步骤以及适用边界，读者应当先完成一次可验证的小规模体验，再根据实际结果决定是否继续使用。'.repeat(4);
  return { title: '从实际体验理解开放工具', summary: '根据固定版本的官方资料，分析项目用途、使用步骤、结果验证和适用边界。',
    blocks: Array.from({ length: 6 }, () => ({ type: 'paragraph', text, citationIndexes: [...indexes] })),
    followUpQuestions: ['第一次体验从哪里开始？', '什么情况不适合使用？', '如何验证实际输出结果？'] };
}

test('public composition repairs the observed one-source citation overflow once, with explicit local numbering and audited provenance', async () => {
  const invalid = citationArticle();
  invalid.blocks[2].citationIndexes = [1, 2];
  invalid.blocks[3].citationIndexes = [1, 3];
  invalid.blocks[4].citationIndexes = [3];
  const original = structuredClone(invalid);
  const f = await citationFixture({ outputs: [invalid, citationArticle()] });
  await f.run();
  assert.equal(f.calls.length, 2);
  const request = JSON.parse(f.calls[0].request.messages[1].content);
  assert.deepEqual(request.citationContract.allowedIndexes, [1]);
  assert.equal(request.verifiedSources[0].sourceIndex, 1);
  assert.equal(Object.hasOwn(request.selectionDecision, 'selectedIndexes'), false);
  assert.equal(Object.hasOwn(request.selectionDecision, 'selectedToolArtifactIds'), false);
  assert.match(f.calls[0].request.messages[0].content, /不是候选选题编号/u);
  const correction = JSON.parse(f.calls[1].request.messages[1].content);
  assert.deepEqual(correction.correction.previousDraft, original);
  assert.deepEqual(correction.verifiedSources, request.verifiedSources);
  assert.equal(f.calls[1].action.actionKey, 'compose-citation-repair');
  assert.notEqual(f.calls[1].idempotencyKey, f.calls[0].idempotencyKey);
  assert.ok(f.calls[0].timeoutSeconds + f.calls[1].timeoutSeconds < 600);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].actionId, 'fixture-action-2');
  assert.deepEqual(f.saves[0].content.selection.selectedIndexes, [2]);
  assert.equal(f.saves[0].content.content.citations.length, 1);
  assert.deepEqual(invalid, original);
});

test('valid single and comparison citations never add a provider call or renumber original audit selections', async () => {
  for (const count of [1, 2]) {
    const allowed = count === 1 ? [1] : [1, 2];
    const f = await citationFixture({ count, outputs: [citationArticle(allowed)] });
    await f.run();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(JSON.parse(f.calls[0].request.messages[1].content).citationContract.allowedIndexes, allowed);
    assert.deepEqual(f.saves[0].content.selection, f.selection);
    assert.equal(f.saves[0].content.content.citations.length, count);
  }
});

test('unresolved or malformed citation indexes stay blocked after one repair and never save a composition', async () => {
  for (const indexes of [[], [2], [1, 3], ['1'], [0]]) {
    const f = await citationFixture({ outputs: [citationArticle(indexes)] });
    await assert.rejects(f.run(), error => error.code === 'AGENT_BLOG_COMPOSITION_CITATION_INVALID');
    assert.equal(f.calls.length, 2);
    assert.equal(f.saves.length, 0);
  }
});

test('composition repair preserves gateway budget denial, bounded failures and shadow acceptance call counts', async () => {
  const denial = Object.assign(Error('budget exhausted'), { code: 'AGENT_BUDGET_EXCEEDED' });
  const denied = await citationFixture({ outputs: [citationArticle([3])], providerError: denial });
  await assert.rejects(denied.run(), error => error === denial);
  assert.equal(denied.calls.length, 2);
  assert.equal(denied.saves.length, 0);
  const malformed = citationArticle(); malformed.title = 'English title';
  const other = await citationFixture({ outputs: [malformed] });
  await assert.rejects(other.run(), error => error.code === 'AGENT_BLOG_COMPOSITION_INVALID');
  assert.equal(other.calls.length, 2);
  const shadow = await citationFixture({ workflowKey: 'blog.project.single.draft-shadow', outputs: [citationArticle([3])] });
  await assert.rejects(shadow.run(), error => error.code === 'AGENT_BLOG_COMPOSITION_CITATION_INVALID');
  assert.equal(shadow.calls.length, 1);
});

test('actual live title shape receives one audited repair without rewriting model output',async()=>{
 const invalid=citationArticle();invalid.title='用几条样式规则画生成艺术：css-doodle 上手笔记';
 const original=structuredClone(invalid),f=await citationFixture({outputs:[invalid,citationArticle()]});
 await f.run();assert.equal(f.calls.length,2);assert.equal(f.saves.length,1);
 const repair=JSON.parse(f.calls[1].request.messages[1].content);
 assert.equal(repair.correction.validation.titleHasLatinLetters,true);
 assert.equal(repair.compositionContract.title.noLatinLetters,true);
 assert.deepEqual(invalid,original);assert.equal(f.saves[0].actionId,'fixture-action-2');
});

test('foundation selection rejects a repeated repository in single-project mode without human review', async () => {
  const { createAgentBlogFoundationGenerationHandlers } = await load('agent-blog-foundation-generation.mjs');
  const runId = uuid();
  const toolArtifactId = uuid();
  const inputContext = context(runId, uuid(), 'select-subject', [{ stageKey: 'collect-evidence', status: 'succeeded',
    outputRef: { artifactId: toolArtifactId } }]);
  inputContext.run.input.previousRepositoryUrls = ['https://github.com/owner/project'];
  let providerCalled = false;
  const handlers = createAgentBlogFoundationGenerationHandlers({
    providerGateway: { invoke: async () => { providerCalled = true; assert.fail('gate must run before model'); } },
    artifactRepository: { readToolArtifact: async () => evidence(toolArtifactId), save: async () => assert.fail('must not persist') },
  });
  await assert.rejects(handlers['blog.project.single.draft-shadow:select-subject'](inputContext,
    { workerId: 'worker', leaseToken: uuid() }), error => error.code === 'AGENT_BLOG_CANDIDATE_GATE_EMPTY');
  assert.equal(providerCalled, false);
});

test('foundation selection rejects invented interest signals with a specific diagnostic code', async () => {
  const { createAgentBlogFoundationGenerationHandlers } = await load('agent-blog-foundation-generation.mjs');
  const runId = uuid();
  const toolArtifactId = uuid();
  const inputContext = context(runId, uuid(), 'select-subject', [{ stageKey: 'collect-evidence', status: 'succeeded',
    outputRef: { artifactId: toolArtifactId } }]);
  const handlers = createAgentBlogFoundationGenerationHandlers({
    providerGateway: { invoke: async () => ({ actionId: uuid(), output: { mode: 'single', selectedIndexes: [1],
      angle: '从普通用户第一次完成体验的路径观察项目价值',
      rationale: '候选项目资料完整，并且具备可观察的结果与清楚的使用说明，适合独立介绍。',
      interestSignals: ['模型自行编造的兴趣'], comparisonAxes: [], scores,
      decisionReasonCodes: ['EVIDENCE_STRONG'] } }) },
    artifactRepository: { readToolArtifact: async () => evidence(toolArtifactId), save: async () => assert.fail('must not persist') },
  });
  await assert.rejects(handlers['blog.project.single.draft-shadow:select-subject'](inputContext,
    { workerId: 'worker', leaseToken: uuid() }), error => error.code === 'AGENT_BLOG_SELECTION_INTEREST_SIGNAL_INVALID');
});

test('foundation response schemas reject prose and unexpected properties', async () => {
  const { validateBlogFoundationSelectionResponse, validateBlogFoundationCompositionResponse } =
    await load('agent-blog-foundation-generation.mjs');
  assert.throws(() => validateBlogFoundationSelectionResponse('not json'), error => error.code === 'AGENT_BLOG_PROVIDER_OUTPUT_INVALID');
  assert.throws(() => validateBlogFoundationSelectionResponse(JSON.stringify({ mode: 'single', selectedIndexes: [1],
    angle: 'x', rationale: 'x', interestSignals: [], comparisonAxes: [], surprise: true })),
  error => error.code === 'AGENT_BLOG_SELECTION_SCHEMA_INVALID');
  assert.throws(() => validateBlogFoundationCompositionResponse({ title: '标题', summary: '摘要', blocks: [],
    followUpQuestions: [], markdown: 'forbidden' }), error => error.code === 'AGENT_BLOG_COMPOSITION_SCHEMA_INVALID');
});

test('deterministic candidate gate rejects missing licenses and keeps prior projects comparison-only', async () => {
  const { evaluateBlogCandidateGate } = await load('agent-blog-foundation-generation.mjs');
  const candidate = (name, overrides = {}) => ({ repositoryKey: name,
    repositoryUrl: `https://github.com/${name}`, title: name, description: '一个用途明确且可以验证结果的开源工具。',
    excerpt: '固定版本的官方说明详细介绍了安装步骤、核心功能、输入输出、适用对象和已知边界。'.repeat(8),
    signals: { licenseSpdx: 'MIT', archived: false, hasReadme: true,
      materialTypes: ['readme', 'license'], topics: ['tool'] }, ...overrides });
  const report = evaluateBlogCandidateGate([
    candidate('new/tool'),
    candidate('old/tool'),
    candidate('closed/tool', { signals: { licenseSpdx: null, archived: false,
      hasReadme: true, materialTypes: ['readme'], topics: ['tool'] } }),
  ], { previousRepositoryUrls: ['https://github.com/old/tool'] });
  assert.equal(report.acceptedCount, 2);
  assert.deepEqual(report.decisions[0].eligibleModes, ['single', 'comparison']);
  assert.deepEqual(report.decisions[1].eligibleModes, ['comparison']);
  assert.deepEqual(report.decisions[1].restrictionCodes, ['SINGLE_PROJECT_PREVIOUSLY_FEATURED']);
  assert.deepEqual(report.decisions[2].reasonCodes, ['LICENSE_NOT_VERIFIED']);
});

test('selection deterministically rejects an active near-duplicate topic cooldown', async () => {
  const { createAgentBlogFoundationGenerationHandlers } = await load('agent-blog-foundation-generation.mjs');
  const runId = uuid(), toolArtifactId = uuid();
  const inputContext = context(runId, uuid(), 'select-subject', [{ stageKey: 'collect-evidence', status: 'succeeded',
    outputRef: { artifactId: toolArtifactId } }]);
  inputContext.run.input.editorialMemory = { schemaVersion: 'blog-editorial-memory-input-v1',
    capturedAt: '2026-10-27T00:00:00.000Z', activeCooldowns: [{ subjectKind: 'topic',
      subjectKey: 'topic:old', label: '从普通用户首次完成体验的路径观察项目价值', occurrenceCount: 1,
      cooldownUntil: '2026-12-01T00:00:00.000Z' }] };
  const handlers = createAgentBlogFoundationGenerationHandlers({
    providerGateway: { invoke: async () => ({ actionId: uuid(), output: { mode: 'single', selectedIndexes: [1],
      angle: '从普通用户第一次完成体验的路径观察项目价值',
      rationale: '项目资料完整，提供了清楚说明、可观察结果和具体使用场景，足以支持面向普通读者的独立研究。',
      interestSignals: ['可以快速体验'], comparisonAxes: [], scores,
      decisionReasonCodes: ['EVIDENCE_STRONG', 'USE_CASE_CONCRETE'] } }) },
    artifactRepository: { readToolArtifact: async () => evidence(toolArtifactId),
      save: async () => assert.fail('cooldown conflict must not persist a selection') },
  });
  await assert.rejects(handlers['blog.project.single.draft-shadow:select-subject'](inputContext,
    { workerId: 'worker', leaseToken: uuid() }),
  error => error.code === 'AGENT_BLOG_EDITORIAL_COOLDOWN_CONFLICT');
});
