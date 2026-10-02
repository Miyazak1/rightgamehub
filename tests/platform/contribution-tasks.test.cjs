const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = file => pathToFileURL(path.join(root, 'apps/api/src', file));
const actor = { userId: crypto.randomUUID(), scopes: ['profile:read','works:read'], profile: { canPublish: true } };

test('contribution tasks start as explicit creator drafts and validate public submissions', async () => {
  const { createContributionTaskService } = await import(moduleUrl('contribution-task-service.mjs'));
  const calls = []; let sequence = 0;
  const repository = {
    createFromFeedback: async input => { calls.push(['create', input]); return { id: input.taskId, title: input.title }; },
    contributorAction: async input => { calls.push(['contributor', input]); return input; },
    claim: async input => input, listPublic: async () => [], listForCreator: async () => [], creatorAction: async input => input,
    recordIssueDraft: async () => ({ id: crypto.randomUUID(), title: '补充键盘操作说明', description: '在 README 中补充清晰的键盘操作说明和验证步骤。', difficulty: 'starter', skills: ['文档'], workTitle: '像素迷阵', repositoryUrl: 'https://github.com/example/pixel-maze' }),
  };
  const service = createContributionTaskService({ repository, ids: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` });
  const feedbackId = crypto.randomUUID();
  assert.throws(() => service.createFromFeedback(null, feedbackId, {}), error => error.code === 'UNAUTHORIZED');
  assert.throws(() => service.createFromFeedback(actor, feedbackId, { title: '短', description: '不足', difficulty: 'starter', skills: [] }), error => error.code === 'CONTRIBUTION_TASK_INVALID');
  const created = await service.createFromFeedback(actor, feedbackId, { title: '  补充键盘操作说明  ', description: '  在 README 中补充清晰的键盘操作说明和验证步骤。  ', difficulty: 'starter', skills: [' 文档 ', '文档'] });
  assert.equal(created.title, '补充键盘操作说明');
  assert.deepEqual(calls[0][1].skills, ['文档']);
  assert.throws(() => service.submit({ userId: crypto.randomUUID() }, crypto.randomUUID(), { url: 'http://localhost/result', note: '已经完成修改' }), error => error.code === 'SUBMISSION_INVALID');
  await service.submit({ userId: crypto.randomUUID() }, crypto.randomUUID(), { url: 'https://github.com/example/pixel-maze/pull/7', note: '已经完成修改并验证。' });
  assert.equal(calls.at(-1)[1].action, 'submit');
  assert.match(calls.at(-1)[1].submissionUrl, /^https:\/\/github\.com/);
});

test('GitHub issue generation is a creator-reviewed prefill and never a repository write', async () => {
  const { createContributionTaskService } = await import(moduleUrl('contribution-task-service.mjs'));
  const calls = [];
  const taskId = crypto.randomUUID();
  const service = createContributionTaskService({ repository: {
    recordIssueDraft: async input => { calls.push(input); return { id: taskId, title: '补充键盘操作说明', description: '在 README 中补充清晰的键盘操作说明和验证步骤。', difficulty: 'starter', skills: ['文档'], workTitle: '像素迷阵', repositoryUrl: 'https://github.com/example/pixel-maze' }; },
  } });
  const draft = await service.issueDraft(actor, taskId);
  assert.equal(calls.length, 1);
  assert.match(draft.createUrl, /^https:\/\/github\.com\/example\/pixel-maze\/issues\/new\?/);
  assert.match(decodeURIComponent(draft.createUrl), /good first issue/);
  assert.match(draft.body, /请在 GitHub 提交前再次检查内容/);
});

test('contribution routes keep public browsing anonymous and all mutations authenticated', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const { AuthError } = await import(moduleUrl('auth-service.mjs'));
  const taskId = crypto.randomUUID(); const feedbackId = crypto.randomUUID(); const calls = [];
  const contributionTaskService = {
    createFromFeedback: async (viewer, id, body) => { calls.push(['create', viewer, id, body]); return { id: taskId }; },
    listForCreator: async (viewer, query) => { calls.push(['creator-list', viewer, query]); return []; },
    creatorAction: async (viewer, id, body) => { calls.push(['creator-action', viewer, id, body]); return { id }; },
    issueDraft: async (viewer, id) => { calls.push(['issue', viewer, id]); return { taskId: id, title: 'title', body: 'body', repositoryUrl: null, createUrl: null }; },
    listPublic: async (viewer, query) => { calls.push(['public-list', viewer, query]); return []; },
    claim: async (viewer, id) => { calls.push(['claim', viewer, id]); return { id }; },
    release: async (viewer, id) => { calls.push(['release', viewer, id]); return { id }; },
    submit: async (viewer, id, body) => { calls.push(['submit', viewer, id, body]); return { id }; },
  };
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async authorization => { if (!authorization) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication required.'); return actor; } },
    contributionTaskService,
  });
  t.after(() => app.close());
  const listed = await app.inject({ method: 'GET', url: '/v1/contribution-tasks?status=open' });
  assert.equal(listed.statusCode, 200); assert.equal(listed.headers['cache-control'], 'public, max-age=30'); assert.equal(calls[0][0], 'public-list');
  const denied = await app.inject({ method: 'POST', url: `/v1/contribution-tasks/${taskId}/claim` });
  assert.equal(denied.statusCode, 401);
  const created = await app.inject({ method: 'POST', url: `/v1/creator/feedback/${feedbackId}/contribution-task`, headers: { authorization: 'Bearer token' }, payload: { title: '补充键盘操作说明', description: '在 README 中补充清晰的键盘操作说明和验证步骤。', difficulty: 'starter', skills: ['文档'] } });
  assert.equal(created.statusCode, 201); assert.equal(calls[1][0], 'create');
  const submitted = await app.inject({ method: 'POST', url: `/v1/contribution-tasks/${taskId}/submission`, headers: { authorization: 'Bearer token' }, payload: { url: 'https://github.com/example/pixel-maze/pull/7', note: '已经完成修改并验证。' } });
  assert.equal(submitted.statusCode, 200); assert.equal(calls[2][0], 'submit');
});
