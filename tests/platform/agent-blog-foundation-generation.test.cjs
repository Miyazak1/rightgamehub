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
  assert.deepEqual(providerCalls[0].promptTemplate, { key: 'blog.subject.select', version: 4 });
  assert.deepEqual(providerCalls[1].promptTemplate, { key: 'blog.article.compose', version: 2 });
  assert(providerCalls[0].request.messages[1].content.includes('allowedInterestSignals'));
  assert(providerCalls[0].request.messages[1].content.includes('eligibleModes'));
  assert.equal(stored.get(selected.outputRef.artifactId).content.gateReport.acceptedCount, 1);
  assert(providerCalls.every(item => item.action.capabilityKey === 'provider.text.generate' && item.action.riskLevel === 'L2'));
  assert.equal(providerCalls.some(item => item.action.actionKey === 'verify'), false);
  const verification = stored.get(verified.outputRef.artifactId).content;
  assert.equal(verification.approved, true);
  assert.equal(Object.hasOwn(verification, 'content'), false);
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
