const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/development-log-service.mjs'));
const apiModuleUrl = name => pathToFileURL(path.resolve(__dirname, `../../apps/api/src/${name}`));
const workId = crypto.randomUUID();
const entryId = crypto.randomUUID();
const actor = { userId: crypto.randomUUID(), scopes: ['works:read', 'works:write'], profile: { canPublish: true } };

test('development log drafts normalize content and require write permission', async () => {
  const { createDevelopmentLogService, DevelopmentLogError } = await import(moduleUrl);
  let received;
  const ids = [entryId, crypto.randomUUID()];
  const service = createDevelopmentLogService({
    repository: { createDraft: async input => (received = input, { id: input.entryId }) },
    ids: () => ids.shift(),
  });
  assert.throws(
    () => service.createDraft({ ...actor, scopes: ['works:read'] }, workId, { entryKind: 'update', title: '一次有效更新', body: '这是一段长度足够的开发记录正文，用于说明修改内容。' }),
    error => error instanceof DevelopmentLogError && error.code === 'CREATOR_REQUIRED',
  );
  const result = await service.createDraft(actor, workId, {
    entryKind: 'release_notes', title: '  版本 1.2 发布说明  ', body: '  这次修复了启动问题，并补充了玩家可以看到的版本变化。  ', releaseId: null,
  });
  assert.equal(result.id, entryId);
  assert.equal(received.title, '版本 1.2 发布说明');
  assert.equal(received.body, '这次修复了启动问题，并补充了玩家可以看到的版本变化。');
  assert.equal(received.releaseId, null);
});

test('development log publication uses optimistic versions and never accepts feedback payloads', async () => {
  const { createDevelopmentLogService, DevelopmentLogError } = await import(moduleUrl);
  let received;
  const service = createDevelopmentLogService({ repository: { update: async input => (received = input, { id: input.entryId }) }, ids: () => crypto.randomUUID() });
  assert.throws(
    () => service.update(actor, entryId, { action: 'publish', expectedVersion: 0 }),
    error => error instanceof DevelopmentLogError && error.code === 'DEVELOPMENT_ENTRY_INVALID',
  );
  await service.update(actor, entryId, { action: 'publish', expectedVersion: 3, feedbackBody: 'private player feedback' });
  assert.equal(received.action, 'publish');
  assert.equal(received.expectedVersion, 3);
  assert.equal('feedbackBody' in received, false);
});

test('public timeline bounds its page size and validates work identity', async () => {
  const { createDevelopmentLogService, DevelopmentLogError } = await import(moduleUrl);
  let limit;
  const service = createDevelopmentLogService({ repository: { listPublic: async (_workId, value) => (limit = value, []) } });
  await service.listPublic(workId, { limit: 500 });
  assert.equal(limit, 100);
  assert.throws(() => service.listPublic('not-a-work'), error => error instanceof DevelopmentLogError && error.code === 'WORK_NOT_FOUND');
});

test('development log routes keep the timeline public and creator mutations authenticated', async t => {
  const { createApp } = await import(apiModuleUrl('app.mjs'));
  const { AuthError } = await import(apiModuleUrl('auth-service.mjs'));
  const calls = [];
  const service = {
    listPublic: async (id, query) => (calls.push(['public', id, query]), []),
    listForCreator: async (viewer, id) => (calls.push(['creator', viewer, id]), []),
    createDraft: async (viewer, id, body) => (calls.push(['create', viewer, id, body]), { id: entryId }),
    update: async (viewer, id, body) => (calls.push(['update', viewer, id, body]), { id }),
  };
  const app = createApp({
    config: { requestBodyLimit: 65536 }, database: { ping: async () => true }, migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async authorization => { if (!authorization) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication required.'); return actor; } },
    developmentLogService: service,
  });
  t.after(() => app.close());
  const timeline = await app.inject({ url: '/v1/works/gamehub-guess-baike/timeline?limit=10' });
  assert.equal(timeline.statusCode, 200); assert.equal(timeline.headers['cache-control'], 'public, max-age=30'); assert.equal(calls[0][1], 'gamehub-guess-baike');
  const denied = await app.inject({ url: `/v1/creator/works/${workId}/development-entries` });
  assert.equal(denied.statusCode, 401);
  const created = await app.inject({ method: 'POST', url: `/v1/creator/works/${workId}/development-entries`, headers: { authorization: 'Bearer token' }, payload: { entryKind: 'update', title: '一次有效更新', body: '这是一段长度足够的开发记录正文，用于说明修改内容。' } });
  assert.equal(created.statusCode, 201); assert.equal(created.headers['cache-control'], 'no-store'); assert.equal(calls[1][0], 'create');
  const updated = await app.inject({ method: 'PATCH', url: `/v1/creator/development-entries/${entryId}`, headers: { authorization: 'Bearer token' }, payload: { action: 'publish', expectedVersion: 1 } });
  assert.equal(updated.statusCode, 200); assert.equal(calls[2][0], 'update');
});
