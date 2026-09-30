const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('administrator storage overview is authenticated and never cached', async t => {
  const { createApp } = await import('../../apps/api/src/app.mjs');
  const actor = { userId: crypto.randomUUID(),scopes: [],profile: { role: 'admin' } };
  let receivedActor;
  const app = createApp({
    config: { requestBodyLimit: 65536 },database: { ping: async () => true },migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => actor },
    storageCapacityService: { adminOverview: async value => { receivedActor = value; return { level: 'healthy',acceptingUploads: true }; } },
  });
  t.after(() => app.close());
  const response = await app.inject({ url: '/v1/admin/storage',headers: { authorization: 'Bearer valid' } });
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.json().data.level,'healthy');
  assert.equal(receivedActor,actor);
});

test('storage gate errors preserve retryable 507 responses on upload creation', async t => {
  const { createApp } = await import('../../apps/api/src/app.mjs');
  const { StorageCapacityError } = await import('../../apps/api/src/storage-capacity-service.mjs');
  const workId = crypto.randomUUID();
  const app = createApp({
    config: { requestBodyLimit: 65536 },database: { ping: async () => true },migrations: { status: async () => ({ ready: true }) },
    authService: { authenticateBearer: async () => ({ userId: crypto.randomUUID(),scopes: ['upload'],profile: {} }) },
    uploadService: { create: async () => { throw new StorageCapacityError('STORAGE_CAPACITY_EXCEEDED',507,'存储空间不足。',true); } },
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',url: `/v1/creator/works/${workId}/uploads`,headers: { authorization: 'Bearer valid','idempotency-key': 'capacity-api-test-0001' },
    payload: { fileName: 'game.zip',declaredBytes: '1024',sha256: 'a'.repeat(64),releaseLabel: '1.0.0',autoPublish: true,targetKey: 'web',packageType: 'web_zip' },
  });
  assert.equal(response.statusCode,507);
  assert.equal(response.json().error.code,'STORAGE_CAPACITY_EXCEEDED');
  assert.equal(response.json().error.retryable,true);
});
