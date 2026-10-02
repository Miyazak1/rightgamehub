const test = require('node:test');
const assert = require('node:assert/strict');

test('analytics service accepts bounded privacy-preserving events', async () => {
  const { createAnalyticsService } = await import('../../apps/api/src/analytics-service.mjs');
  const inserted = []; const now = new Date('2026-09-30T12:00:00.000Z');
  const service = createAnalyticsService({ repository: { insert: async rows => inserted.push(...rows) }, clock: () => now, ids: () => '11111111-1111-4111-8111-111111111111' });
  const result = await service.record(null, { events: [{
    type: 'page_view', anonymousId: '22222222-2222-4222-8222-222222222222', sessionId: '33333333-3333-4333-8333-333333333333',
    hostKind: 'browser', route: 'discover', occurredAt: now.toISOString(),
  }] });
  assert.deepEqual(result, { accepted: 1 });
  assert.equal(inserted[0].userId, null);
  assert.equal(inserted[0].route, 'discover');
  assert.equal('url' in inserted[0], false);
  assert.equal('ip' in inserted[0], false);
});

test('analytics overview is admin-only and range-bound', async () => {
  const { createAnalyticsService } = await import('../../apps/api/src/analytics-service.mjs');
  const service = createAnalyticsService({ repository: { overview: async input => input }, clock: () => new Date('2026-09-30T00:00:00Z') });
  await assert.rejects(() => service.overview({ profile: { role: 'user' } }, { days: 7 }), error => error.code === 'ADMIN_REQUIRED');
  await assert.rejects(() => service.overview({ profile: { role: 'admin' } }, { days: 365 }), error => error.code === 'ANALYTICS_INVALID');
  const result = await service.overview({ profile: { role: 'admin' } }, { days: 30 });
  assert.equal(result.days, 30);
  assert.equal(result.since.toISOString(), '2026-08-31T16:00:00.000Z');
});

test('creator analytics requires publishing access and is scoped to the actor', async () => {
  const { createAnalyticsService } = await import('../../apps/api/src/analytics-service.mjs');
  const service = createAnalyticsService({ repository: { creatorOverview: async input => input }, clock: () => new Date('2026-09-30T12:00:00Z') });
  await assert.rejects(() => service.creatorOverview({ userId: 'creator', scopes: ['works:read'], profile: { canPublish: false } }), error => error.code === 'CREATOR_REQUIRED');
  await assert.rejects(() => service.creatorOverview({ userId: 'creator', scopes: [], profile: { canPublish: true } }), error => error.code === 'CREATOR_REQUIRED');
  const result = await service.creatorOverview({ userId: 'creator', scopes: ['works:read'], profile: { canPublish: true } }, { days: 30 });
  assert.equal(result.userId, 'creator');
  assert.equal(result.days, 30);
  assert.equal(result.since.toISOString(), '2026-08-31T16:00:00.000Z');
});

test('creator analytics repository returns aggregate rates and a complete daily series', async () => {
  const { PostgresAnalyticsRepository } = await import('../../apps/api/src/analytics-repository.mjs');
  const pool = { query: async sql => sql.includes('WITH owned AS') ? { rows: [{ work_id: '00000000-0000-4000-8000-000000000111', title: '测试游戏', state: 'published', views: 12, starts: 5, engaged_sessions: 3, repeat_players: 2, saves: 4, builds: 2, successful_builds: 1 }] } : { rows: [{ day: '2026-09-30', views: 12, starts: 5, engaged_sessions: 3 }] } };
  const result = await new PostgresAnalyticsRepository(pool).creatorOverview({ userId: 'creator', days: 7, since: new Date('2026-09-24T16:00:00Z'), now: new Date('2026-10-01T12:00:00Z') });
  assert.equal(result.daily.length, 7);
  assert.equal(result.works[0].title, '测试游戏');
  assert.equal(result.totals.engagementRate, 60);
  assert.equal(result.totals.repeatPlayers, 2);
  assert.equal(result.totals.buildSuccessRate, 50);
});
