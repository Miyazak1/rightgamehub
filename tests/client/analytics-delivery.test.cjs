const test = require('node:test');
const assert = require('node:assert/strict');

test('analytics delivery serializes requests and opens a circuit after a failure', async () => {
  const { enqueueAnalytics } = await import('../../packages/platform-client/src/analytics-delivery.mjs');
  let calls = 0, clock = 1_000;
  const api = { trackAnalytics: async () => { calls += 1; throw new Error('temporary analytics outage'); } };
  const now = () => clock;
  const results = await Promise.all([
    enqueueAnalytics(api, [{ type: 'page_view' }], { now }),
    enqueueAnalytics(api, [{ type: 'session_ping' }], { now }),
    enqueueAnalytics(api, [{ type: 'page_view' }], { now }),
  ]);
  assert.deepEqual(results, [false, false, false]);
  assert.equal(calls, 1, 'queued telemetry must stop after the first failed delivery');
  clock += 59_999;
  assert.equal(await enqueueAnalytics(api, [{ type: 'session_ping' }], { now }), false);
  assert.equal(calls, 1);
});

test('analytics delivery retries after backoff and resets the circuit on success', async () => {
  const { enqueueAnalytics } = await import('../../packages/platform-client/src/analytics-delivery.mjs');
  let calls = 0, clock = 10_000;
  const api = { trackAnalytics: async () => { calls += 1; if (calls === 1) throw new Error('temporary analytics outage'); } };
  const now = () => clock;
  assert.equal(await enqueueAnalytics(api, [{ type: 'page_view' }], { now }), false);
  clock += 60_000;
  assert.equal(await enqueueAnalytics(api, [{ type: 'session_ping' }], { now }), true);
  assert.equal(await enqueueAnalytics(api, [{ type: 'page_view' }], { now }), true);
  assert.equal(calls, 3);
});
