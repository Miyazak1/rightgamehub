const test = require('node:test');
const assert = require('node:assert/strict');

test('moderation service validates reports and restricts decisions and audit to admins', async () => {
  const { createModerationService, ModerationError } = await import('../../apps/api/src/moderation-service.mjs');
  const calls = [];
  const service = createModerationService({ repository: {
    createReport: async input => { calls.push(['report', input]); return { id: input.reportId, status: 'open' }; },
    listReports: async (status, limit) => { calls.push(['list', status, limit]); return []; },
    decide: async input => { calls.push(['decide', input]); return { id: input.reportId, status: 'resolved' }; },
    listAudit: async limit => { calls.push(['audit', limit]); return []; },
  } });
  const user = { userId: 'user', profile: { role: 'user' } };
  const admin = { userId: 'admin', profile: { role: 'admin' } };
  const workId = '00000000-0000-4000-8000-000000000123';
  const report = await service.report(user, workId, { category: 'malware', details: ' opens an unexpected window ' });
  assert.equal(report.status, 'open');
  assert.equal(calls[0][1].details, 'opens an unexpected window');
  await assert.rejects(service.report(user, 'gamehub-guess-baike', { category: 'other' }), error => error instanceof ModerationError && error.code === 'REPORT_UNAVAILABLE');
  await assert.rejects(service.list(user), error => error instanceof ModerationError && error.code === 'ADMIN_REQUIRED');
  await service.list(admin, { status: 'all', limit: 999 });
  assert.deepEqual(calls[1], ['list', null, 100]);
  await assert.rejects(service.decide(admin, report.id, { action: 'dismiss', note: ' ' }), error => error.code === 'NOTE_REQUIRED');
  await service.decide(admin, report.id, { action: 'suspend', note: 'Confirmed unsafe behavior.' });
  assert.equal(calls[2][1].action, 'suspend');
  await service.audit(admin, { limit: 4 });
  assert.deepEqual(calls[3], ['audit', 4]);
});
