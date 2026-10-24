const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const url = name => pathToFileURL(path.join(root, 'apps/api/src', name)).href;

test('blog target workflow separates research, generation, private draft and publication authority', async () => {
  const { normalizeWorkflowManifest } = await import(url('agent-runtime-contracts.mjs'));
  const { BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW, BLOG_PROJECT_SINGLE_WORKFLOW,
    BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW } = await import(url('agent-blog-foundation-workflows.mjs'));
  assert.deepEqual(normalizeWorkflowManifest(BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW), BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW);
  assert.deepEqual(normalizeWorkflowManifest(BLOG_PROJECT_SINGLE_WORKFLOW), BLOG_PROJECT_SINGLE_WORKFLOW);
  assert.deepEqual(normalizeWorkflowManifest(BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW), BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW);
  assert.deepEqual(BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.defaultBudget,
    { providerCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 });
  assert.deepEqual(BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.requiredCapabilities, []);
  assert.equal(BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.stages.some(stage => stage.key === 'publish'), false);
  assert.deepEqual(BLOG_PROJECT_SINGLE_WORKFLOW.requiredCapabilities.map(item => item.key), [
    'research.github.read', 'provider.text.generate', 'blog.article.draft', 'blog.article.publish',
  ]);
  assert.equal(BLOG_PROJECT_SINGLE_WORKFLOW.stages.at(-1).key, 'publish');
  assert.equal(BLOG_PROJECT_SINGLE_WORKFLOW.stages.at(-1).capability.key, 'blog.article.publish');
  assert.deepEqual(BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.requiredCapabilities.map(item => item.key), [
    'research.github.read', 'provider.text.generate', 'blog.article.draft',
  ]);
  assert.equal(BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.stages.at(-1).key, 'persist-draft');
  assert.equal(BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.stages.some(stage => stage.key === 'publish'), false);
  assert.equal(BLOG_PROJECT_SINGLE_DRAFT_SHADOW_WORKFLOW.requiredCapabilities.some(item => item.key === 'blog.article.publish'), false);
});

test('shadow replay handler persists a private parity report without an external action', async () => {
  const { stableHash } = await import(url('researcher-qa-protocol/stable-json.mjs'));
  const { createBlogShadowReplayHandlers, BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW } = await import(url('agent-blog-foundation-workflows.mjs'));
  const snapshot = {
    schemaVersion: 'agent-blog-legacy-run-v1', legacyRunId: 'legacy', agentUserId: 'agent', requestedByUserId: null,
    triggerKind: 'manual', status: 'rejected', model: 'deepseek-flash', topicScope: '有趣且有用的开源项目',
    behaviorProfileId: 'profile', behaviorProfileVersion: 1, article: null,
    reasonCodes: ['MODEL_REVIEW_REJECTED'],
    providerUsage: { selectionDecision: { mode: 'single', repositories: ['owner/project'] } }, error: null,
    startedAt: '2026-10-24T01:00:00.000Z', finishedAt: '2026-10-24T01:02:00.000Z',
    createdAt: '2026-10-24T00:59:00.000Z', updatedAt: '2026-10-24T01:02:00.000Z',
  };
  const sourceSha256 = stableHash(snapshot);
  let saved = null;
  const handlers = createBlogShadowReplayHandlers({ artifactRepository: { save: async input => {
    saved = input;
    return { id: '00000000-0000-4000-8000-000000000001', existing: false };
  } } });
  const handler = handlers[`${BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.workflowKey}:verify-legacy-run`];
  const result = await handler({ run: { id: 'run', agentUserId: 'agent', input: {
    schemaVersion: 'blog-shadow-replay-input-v1', projectionMode: 'shadow', sourceSha256, legacySnapshot: snapshot,
  } } });
  assert.equal(saved.verdict, 'exact');
  assert.equal(saved.report.providerInvocation, false);
  assert.equal(saved.report.publicationAttempt, false);
  assert.equal(result.runOutput.type, 'blog.shadow-report');
  await assert.rejects(handler({ run: { id: 'run', agentUserId: 'agent', input: {
    schemaVersion: 'blog-shadow-replay-input-v1', projectionMode: 'shadow', sourceSha256,
    legacySnapshot: { ...snapshot, providerUsage: { selectionDecision: { mode: 'comparison' } } },
  } } }), /AGENT_BLOG_SHADOW_REPLAY_INPUT_INVALID/u);
});

test('blog foundation mode fails closed and defaults to passive', async () => {
  const { loadConfig } = await import(url('config.mjs'));
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://db/test', OTP_HMAC_KEY: 'x'.repeat(32) };
  assert.equal(loadConfig(base).agentBlogFoundationMode, 'passive');
  assert.equal(loadConfig({ ...base, AGENT_BLOG_FOUNDATION_MODE: 'shadow' }).agentBlogFoundationMode, 'shadow');
  assert.throws(() => loadConfig({ ...base, AGENT_BLOG_FOUNDATION_MODE: 'foundation' }), /must be passive or shadow/u);
});
