import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeApiClient } from '../../packages/platform-api-client/src/practice.mjs';

test('practice transport refreshes an expired session and preserves the operation key', async () => {
  let token = 'expired'; const calls = [];
  const api = createPracticeApiClient({ baseUrl: 'https://example.test', getAccessToken: () => token,
    getRefreshToken: () => 'refresh', setTokens: value => { token = value.accessToken; },
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (url.endsWith('/auth/refresh')) return Response.json({ data: { accessToken: 'renewed' } });
      if (options.headers.Authorization === 'Bearer expired') return Response.json({ error: {} }, { status: 401 });
      return Response.json({ data: { id: 'batch' } });
    },
  });
  assert.equal((await api.startPractice({ count: 3 }, 'operation-key')).data.id, 'batch');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers['Idempotency-Key'], 'operation-key');
  assert.equal(calls[2].headers['Idempotency-Key'], 'operation-key');
  assert.equal(calls[2].headers.Authorization, 'Bearer renewed');
});

test('practice transport keeps server errors and refuses cancelled requests', async () => {
  let calls = 0;
  const api = createPracticeApiClient({ fetchImpl: async () => { calls++; return Response.json({ error: { code: 'PRACTICE_NOT_FOUND', message: 'Missing' } }, { status: 404 }); } });
  await assert.rejects(api.getPractice('other/account'), { code: 'PRACTICE_NOT_FOUND', status: 404 });
  await assert.rejects(api.listPracticeHistory({ signal: AbortSignal.abort() }), { code: 'REQUEST_CANCELLED' });
  assert.equal(calls, 1);
});
