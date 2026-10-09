const test = require('node:test'), assert = require('node:assert/strict');
test('updateWork sends PATCH with an automatic stable idempotency key and current work ETag', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests = []; let token = 'expired';
  const client = createApiClient({ getAccessToken: () => token, getRefreshToken: () => 'refresh', setTokens: value => { token = value.accessToken; }, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/auth/refresh')) return new Response(JSON.stringify({ data: { accessToken: 'fresh' } }), { status: 200 });
    return new Response(JSON.stringify(token === 'expired' ? { error: { code: 'AUTH_REQUIRED' } } : { data: { id: 'work/id', revision: '8' } }), { status: token === 'expired' ? 401 : 200, headers: { etag: '"work-work/id-8"' } });
  } });
  const body = { title: '新的标题' };
  const result = await client.updateWork('work/id', '7', body);
  const patches = requests.filter(item => item.init.method === 'PATCH');
  assert.equal(patches.length, 2); assert.equal(patches[0].url, '/v1/creator/works/work%2Fid');
  assert.equal(patches[0].init.headers['If-Match'], '"work-work/id-7"');
  assert.ok(patches[0].init.headers['Idempotency-Key'].length >= 16);
  assert.equal(patches[0].init.headers['Idempotency-Key'], patches[1].init.headers['Idempotency-Key']);
  assert.equal(patches[1].init.headers.Authorization, 'Bearer fresh');
  assert.deepEqual(JSON.parse(patches[1].init.body), body); assert.equal(result.etag, '"work-work/id-8"');
  await client.updateWork('work/id', '8', body, { headers: { 'Idempotency-Key': 'retry-the-same-save', 'If-Match': 'cannot-override' } });
  assert.equal(requests.at(-1).init.headers['Idempotency-Key'], 'retry-the-same-save');
  assert.equal(requests.at(-1).init.headers['If-Match'], '"work-work/id-8"');
});
test('metadata form preserves custom values, pairs nullable links and never sends work kind', async () => {
  const { workMetadataForm, workMetadataPayload } = await import('../../packages/platform-client/src/work-metadata.mjs');
  const form = workMetadataForm({ title: '标题', description: '介绍', kind: 'tool', estimatedMinutes: 7, agentLabel: '自定义工具', tags: ['像素'], repositoryUrl: 'https://github.com/example/game', licenseSpdx: 'MIT' });
  assert.equal(form.estimatedMinutes, '7'); assert.equal(form.agentLabel, '自定义工具');
  const payload = workMetadataPayload({ ...form, kind: 'game', tags: '像素, 像素，休闲', repositoryUrl: '', licenseSpdx: '', agentLabel: '' });
  assert.equal('kind' in payload, false); assert.equal(payload.repositoryUrl, null); assert.equal(payload.licenseSpdx, null); assert.equal(payload.agentLabel, null); assert.deepEqual(payload.tags, ['像素','休闲']);
  for (const patch of [{ repositoryUrl: '' }, { estimatedMinutes: '31' }, { estimatedMinutes: '1.5' }, { title: ' ' }, { tags: '1,2,3,4,5,6,7' }]) assert.throws(() => workMetadataPayload({ ...form, ...patch }));
});
