const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const id = () => crypto.randomUUID();

test('paper article workflow is a private draft pipeline with no publish stage', async () => {
  const { PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW, normalizePaperArticleDraftInput } =
    await load('agent-paper-article-workflow.mjs');
  assert.deepEqual(PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.stages.map(stage => stage.key),
    ['freeze-input', 'collect-evidence', 'compose', 'verify', 'persist-draft']);
  assert.equal(PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.stages.some(stage => stage.key === 'publish'), false);
  assert.equal(PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.requiredCapabilities
    .some(item => item.key === 'blog.article.publish'), false);
  const input = { schemaVersion: 'paper-article-draft-input-v1', analysisId: id() };
  assert.deepEqual(normalizePaperArticleDraftInput(input), input);
  assert.throws(() => normalizePaperArticleDraftInput({ ...input, publish: true }),
    error => error.code === 'AGENT_PAPER_ARTICLE_INPUT_INVALID');
});

test('paper article workflow archives governed evidence and hands verified content to the existing draft gateway', async () => {
  const { createAgentPaperArticleDraftHandlers } = await load('agent-paper-article-workflow.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const runId = id(), agentUserId = id(), analysisId = id(), toolArtifactId = id();
  const verificationId = id(), compositionId = id(), bindingId = id();
  const input = { schemaVersion: 'paper-article-draft-input-v1', analysisId };
  let toolRequest, archiveRequest, draftRequest;
  const content = { slug: `paper-research-${runId.replaceAll('-', '').slice(0, 24)}`,
    locale: 'zh-CN', title: '论文研究草稿',
    summary: '这是一份经过论文证据约束的中文科普草稿，用于验证现有草稿网关能够复用。',
    blocks: [{ type: 'paragraph', text: '正文事实由论文逐页证据支持。', citationIds: [id()] }],
    citations: [] };
  content.citations.push({ id: content.blocks[0].citationIds[0], label: '论文原文', title: 'Paper',
    url: 'https://arxiv.org/pdf/2601.12345v1.pdf', publisher: 'arXiv', publishedAt: null,
    accessedAt: '2026-10-29T02:00:00.000Z', excerpt: '原文证据。', locator: '第 3 页' });
  const composition = { id: compositionId, artifactKey: 'blog.composition', contentSha256: 'b'.repeat(64),
    content: { schemaVersion: 'blog-article-composition-v1', selection: { mode: 'paper' }, content,
      followUpQuestions: ['问题一？', '问题二？', '问题三？'], bodyCharacters: 900,
      sourceToolArtifactIds: [toolArtifactId] } };
  const verification = { id: verificationId, artifactKey: 'blog.verification', content: {
    schemaVersion: 'blog-article-verification-v1', approved: true,
    compositionArtifactId: compositionId, contentSha256: composition.contentSha256,
    sourceToolArtifactIds: [toolArtifactId], checks: {} } };
  const handlers = createAgentPaperArticleDraftHandlers({
    toolGateway: { invoke: async value => { toolRequest = value; return { status: 'succeeded',
      actionId: id(), artifactId: toolArtifactId }; } },
    providerGateway: { invoke: async () => assert.fail('provider is not part of this edge test') },
    artifactRepository: { read: async ({ artifactId }) => artifactId === verificationId
      ? verification : artifactId === compositionId ? composition : assert.fail('unexpected artifact') },
    draftGateway: { persist: async value => { draftRequest = value; return { status: 'succeeded',
      publicationState: 'draft', articleId: id(), revisionId: id(), contentSha256: 'c'.repeat(64) }; } },
    researchEvidenceRepository: { archivePaperAnalysisArtifact: async value => {
      archiveRequest = value; return { id: bindingId, evidenceCount: 2 };
    } },
  });
  const execution = { workerId: 'paper-worker', leaseToken: id() };
  const run = { id: runId, agentUserId, input, inputSha256: stableHash(input), configSnapshot: {} };
  const frozen = await handlers['paper.article.draft-shadow:freeze-input']({ run, prerequisites: [] });
  const collected = await handlers['paper.article.draft-shadow:collect-evidence']({ run,
    stage: { id: id() }, prerequisites: [{ stageKey: 'freeze-input', status: 'succeeded',
      outputRef: frozen.outputRef }] }, execution);
  assert.equal(toolRequest.request.analysisId, analysisId);
  assert.equal(toolRequest.tool.toolKey, 'research.paper.analysis.read');
  assert.equal(archiveRequest.toolArtifactId, toolArtifactId);
  assert.deepEqual(collected.outputRef.researchEvidenceBindingIds, [bindingId]);
  const persisted = await handlers['paper.article.draft-shadow:persist-draft']({ run,
    stage: { id: id() }, prerequisites: [{ stageKey: 'verify', status: 'succeeded', outputRef: {
      artifactId: verificationId, artifactKey: 'blog.verification', approved: true,
      compositionArtifactId: compositionId } }] }, execution);
  assert.equal(persisted.outputRef.publicationState, 'draft');
  assert.equal(persisted.runOutput.type, 'blog.private-draft');
  assert.deepEqual(draftRequest.sourceArtifactIds, [toolArtifactId]);
  assert.equal(draftRequest.verificationArtifactId, verificationId);
  assert.equal(Object.hasOwn(handlers, 'paper.article.draft-shadow:publish'), false);
});
