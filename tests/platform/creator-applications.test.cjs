const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = name => pathToFileURL(path.resolve(__dirname, '../../apps/api/src', name)).href;
const actor = { userId: '10000000-0000-4000-8000-000000000001', grantId: '20000000-0000-4000-8000-000000000001', profile: { role: 'user', canPublish: false } };
const admin = { userId: '30000000-0000-4000-8000-000000000001', grantId: '40000000-0000-4000-8000-000000000001', profile: { role: 'admin', canPublish: true } };

test('creator applications validate statements and require an administrator for decisions', async () => {
  const { createAuthService } = await import(moduleUrl('auth-service.mjs'));
  const calls = [];
  const repository = {
    createCreatorApplication: async input => { calls.push(['create', input]); return { canPublish: false, application: { id: input.id, status: 'pending', statement: input.statement } }; },
    listCreatorApplications: async input => { calls.push(['list', input]); return []; },
    decideCreatorApplication: async input => { calls.push(['decide', input]); return { ok: true, application: { id: input.applicationId, status: input.decision === 'approve' ? 'approved' : 'rejected' } }; },
  };
  const service = createAuthService({ repository, mailer: {}, otpHmacKey: 'x'.repeat(32), ids: () => '50000000-0000-4000-8000-000000000001' });

  await assert.rejects(service.applyForCreator(actor, { statement: 'too short' }), error => error.code === 'SCHEMA_INVALID');
  const created = await service.applyForCreator(actor, { statement: '  我计划制作尊重版权并遵守平台规范的浏览器小游戏。  ' });
  assert.equal(created.application.status, 'pending');
  assert.equal(calls[0][1].statement, '我计划制作尊重版权并遵守平台规范的浏览器小游戏。');

  await assert.rejects(service.listCreatorApplications(actor), error => error.code === 'ADMIN_REQUIRED');
  assert.deepEqual(await service.listCreatorApplications(admin), []);
  const decided = await service.decideCreatorApplication(admin, { applicationId: '50000000-0000-4000-8000-000000000001' }, { decision: 'approve', note: '内容方向清晰，同意开通。' });
  assert.equal(decided.status, 'approved');
  assert.equal(calls.at(-1)[1].actorUserId, admin.userId);
});
