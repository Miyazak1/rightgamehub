const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);

test('paper article manual runner creates one private draft run and never publishes', async () => {
  const { createAgentPaperArticleManualRunner } = await load('agent-paper-article-manual-run.mjs');
  const agentUserId = crypto.randomUUID(), analysisId = crypto.randomUUID();
  const requestId = crypto.randomUUID(), runId = crypto.randomUUID(), articleId = crypto.randomUUID();
  const behaviorProfileId = crypto.randomUUID(), calls = [];
  let step = 0, stopped = false;
  const runner = createAgentPaperArticleManualRunner({
    config: { agentUserId, provider: 'deepseek', modelId: 'deepseek-flash' },
    inputRepository: { snapshot: async () => ({
      schemaVersion: 'agent-blog-private-canary-input-snapshot-v2', agentUserId,
      configuredModelId: 'deepseek-flash', behaviorProfileId, behaviorProfileVersion: 4,
      behaviorProfile: { schemaVersion: 'agent-behavior-profile-v1', mission: '读论文',
        personality: '严谨', voice: '清晰', audience: '普通读者',
        selectionPersona: '重视证据', interestSignals: ['论文'], allowComparisons: true },
    }) },
    runtimeRepository: { createRun: async input => (calls.push(input), { id: runId, existing: false }) },
    createWorker: () => ({ runOnce: async () => {
      step += 1;
      return { status: 'completed', run: step === 5
        ? { id: runId, status: 'succeeded', outputType: 'blog.private-draft', outputId: articleId }
        : undefined };
    }, stop: async () => { stopped = true; } }),
    readRun: async () => null,
  });
  const result = await runner.run({ analysisId, requestId });
  assert.equal(result.articleId, articleId);
  assert.equal(result.publicationState, 'draft');
  assert.equal(result.publicationAttempted, false);
  assert.equal(stopped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workflowKey, 'paper.article.draft-shadow');
  assert.equal(calls[0].input.analysisId, analysisId);
  assert.equal(calls[0].config.behaviorProfileVersion, 4);
});

test('paper article manual runner rejects invalid ids before creating a run', async () => {
  const { createAgentPaperArticleManualRunner } = await load('agent-paper-article-manual-run.mjs');
  let created = false;
  const runner = createAgentPaperArticleManualRunner({
    config: { agentUserId: crypto.randomUUID(), provider: 'deepseek', modelId: 'deepseek-flash' },
    inputRepository: { snapshot: async () => ({}) },
    runtimeRepository: { createRun: async () => { created = true; } },
    createWorker: () => ({}),
    readRun: async () => null,
  });
  await assert.rejects(() => runner.run({ analysisId: 'not-an-id', requestId: crypto.randomUUID() }),
    error => error.code === 'AGENT_PAPER_ARTICLE_RUNTIME_INPUT_INVALID');
  assert.equal(created, false);
});

test('paper article manual runner returns an existing successful run without invoking a worker', async () => {
  const { createAgentPaperArticleManualRunner } = await load('agent-paper-article-manual-run.mjs');
  const agentUserId = crypto.randomUUID(), analysisId = crypto.randomUUID();
  const requestId = crypto.randomUUID(), runId = crypto.randomUUID(), articleId = crypto.randomUUID();
  let workerCreated = false;
  const runner = createAgentPaperArticleManualRunner({
    config: { agentUserId, provider: 'deepseek', modelId: 'deepseek-flash' },
    inputRepository: { snapshot: async () => ({
      schemaVersion: 'agent-blog-private-canary-input-snapshot-v2', agentUserId,
      configuredModelId: 'deepseek-flash', behaviorProfileId: crypto.randomUUID(),
      behaviorProfileVersion: 3, behaviorProfile: { mission: '读论文' },
    }) },
    runtimeRepository: { createRun: async () => ({ id: runId, existing: true }) },
    createWorker: () => { workerCreated = true; },
    readRun: async () => ({ id: runId, status: 'succeeded', outputType: 'blog.private-draft',
      outputId: articleId }),
  });
  const result = await runner.run({ analysisId, requestId });
  assert.equal(result.articleId, articleId);
  assert.equal(workerCreated, false);
});
