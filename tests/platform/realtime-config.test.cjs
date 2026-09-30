const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const configUrl = pathToFileURL(path.join(root, 'apps/realtime/src/config.mjs'));

test('realtime configuration requires Redis and PostgreSQL and bounds reconnect grace', async () => {
  const { loadRealtimeConfig } = await import(configUrl);
  assert.throws(() => loadRealtimeConfig({ REDIS_URL: 'redis://localhost:6379' }), /DATABASE_URL/u);
  assert.throws(() => loadRealtimeConfig({ REDIS_URL: 'redis://localhost:6379', DATABASE_URL: 'postgresql://localhost/gamehub', REALTIME_RECONNECT_GRACE_MS: '1000' }), /REALTIME_RECONNECT_GRACE_MS/u);
  assert.throws(() => loadRealtimeConfig({ REDIS_URL: 'redis://localhost:6379', DATABASE_URL: 'postgresql://localhost/gamehub', REALTIME_MATCH_TIMEOUT_SWEEP_MS: '100' }), /REALTIME_MATCH_TIMEOUT_SWEEP_MS/u);
  const config = loadRealtimeConfig({ REDIS_URL: 'redis://localhost:6379', DATABASE_URL: 'postgresql://localhost/gamehub', REALTIME_RECONNECT_GRACE_MS: '90000', REALTIME_MATCH_TIMEOUT_BATCH_SIZE: '75' });
  assert.equal(config.databaseUrl, 'postgresql://localhost/gamehub');
  assert.equal(config.reconnectGraceMs, 90_000);
  assert.equal(config.matchTimeoutSweepMs, 1_000);
  assert.equal(config.matchTimeoutBatchSize, 75);
});
