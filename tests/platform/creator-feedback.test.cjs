const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = file => pathToFileURL(path.join(root, 'apps/api/src', file));
const actor = { userId: crypto.randomUUID(), scopes: ['profile:read','works:read'], profile: { canPublish: true } };

test('structured feedback validates player input and does not require creator permission', async () => {
  const { createCreatorFeedbackService } = await import(moduleUrl('creator-feedback-service.mjs'));
  const calls = []; let nextId = 0;
  const service = createCreatorFeedbackService({
    ids: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
    repository: { create: async input => { calls.push(input); return { id: input.feedbackId, summary: input.summary }; } },
  });
  const workId = crypto.randomUUID();
  await assert.rejects(() => service.submit(null, workId, {}), error => error.code === 'UNAUTHORIZED');
  await assert.rejects(() => service.submit({ userId: actor.userId }, workId, { category: 'bug', summary: '短', details: '足够长的详细说明内容' }), error => error.code === 'SUMMARY_INVALID');
  const result = await service.submit({ userId: actor.userId }, workId, { category: 'bug', summary: '  第二关无法移动  ', details: '  点击重新开始后角色无法移动。  ', reproductionSteps: '重新开始', environment: 'Chrome' });
  assert.equal(result.summary, '第二关无法移动');
  assert.equal(calls[0].actor.userId, actor.userId);
  assert.equal(calls[0].category, 'bug');
  assert.notEqual(calls[0].feedbackId, calls[0].eventId);
});

test('creator issue drafts are explicit, repository-scoped and contain no reporter identity', async () => {
  const { createCreatorFeedbackService } = await import(moduleUrl('creator-feedback-service.mjs'));
  const feedbackId = crypto.randomUUID(); const calls = [];
  const item = {
    id: feedbackId, workTitle: '像素赛车', category: 'compatibility', summary: 'Safari 中声音无法播放',
    details: '进入第一关后没有背景音乐。', reproductionSteps: '使用 Safari 打开并开始游戏。', environment: 'Safari 19',
    repositoryUrl: 'https://github.com/miyazaki/pixel-racer', status: 'issue_drafted',
  };
  const repository = {
    issueDrafted: async input => { calls.push(input); return item; },
    getForCreator: async () => item,
    update: async input => input,
    listForCreator: async () => [],
  };
  const service = createCreatorFeedbackService({ repository });
  const draft = await service.issueDraft(actor, feedbackId);
  assert.match(draft.title, /Safari 中声音无法播放/);
  assert.match(draft.createUrl, /^https:\/\/github\.com\/miyazaki\/pixel-racer\/issues\/new\?/);
  assert.match(decodeURIComponent(draft.createUrl), /进入第一关后没有背景音乐/);
  assert.doesNotMatch(draft.body, new RegExp(actor.userId));
  await assert.rejects(() => service.update(actor, feedbackId, { action: 'link_issue', issueUrl: 'https://github.com/other/repo/issues/9' }), error => error.code === 'ISSUE_URL_INVALID');
  const linked = await service.update(actor, feedbackId, { action: 'link_issue', issueUrl: 'https://github.com/miyazaki/pixel-racer/issues/9' });
  assert.equal(linked.issueUrl, 'https://github.com/miyazaki/pixel-racer/issues/9');
});

test('creator feedback routes require authentication and preserve the explicit issue-draft boundary', async t => {
  const { createApp } = await import(moduleUrl('app.mjs'));
  const { AuthError } = await import(moduleUrl('auth-service.mjs'));
  const workId = crypto.randomUUID(); const feedbackId = crypto.randomUUID(); const calls = [];
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async authorization => { if (!authorization) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication required.'); return actor; } },
    creatorFeedbackService: {
      submit: async (viewer, id, body) => { calls.push(['submit', viewer, id, body]); return { id: feedbackId }; },
      list: async (viewer, query) => { calls.push(['list', viewer, query]); return []; },
      issueDraft: async (viewer, id) => { calls.push(['draft', viewer, id]); return { feedbackId: id, title: 'title', body: 'body', markdown: '# title', repositoryUrl: null, createUrl: null }; },
      update: async (viewer, id, body) => { calls.push(['update', viewer, id, body]); return { id }; },
    },
  });
  t.after(() => app.close());
  const denied = await app.inject({ method: 'POST', url: `/v1/works/${workId}/feedback`, payload: { category: 'bug', summary: '这是一个问题', details: '这是足够长的详细问题说明。' } });
  assert.equal(denied.statusCode, 401);
  const created = await app.inject({ method: 'POST', url: `/v1/works/${workId}/feedback`, headers: { authorization: 'Bearer token' }, payload: { category: 'bug', summary: '这是一个问题', details: '这是足够长的详细问题说明。' } });
  assert.equal(created.statusCode, 201); assert.equal(created.headers['cache-control'], 'no-store'); assert.equal(calls[0][0], 'submit');
  const listed = await app.inject({ method: 'GET', url: '/v1/creator/feedback?status=new', headers: { authorization: 'Bearer token' } });
  assert.equal(listed.statusCode, 200); assert.equal(calls[1][2].status, 'new');
  const drafted = await app.inject({ method: 'POST', url: `/v1/creator/feedback/${feedbackId}/issue-draft`, headers: { authorization: 'Bearer token' } });
  assert.equal(drafted.statusCode, 200); assert.equal(drafted.json().data.createUrl, null); assert.equal(calls[2][0], 'draft');
  const updated = await app.inject({ method: 'PATCH', url: `/v1/creator/feedback/${feedbackId}`, headers: { authorization: 'Bearer token' }, payload: { action: 'archive' } });
  assert.equal(updated.statusCode, 200); assert.equal(calls[3][3].action, 'archive');
});
