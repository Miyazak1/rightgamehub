const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const url = process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
test('existing work PATCH changes public metadata only, with ETags, replay, ownership and schema guards', { skip: !url, timeout: 300000 }, async t => {
  const f = await require('../work-edit-fixture.cjs').createWorkEditFixture(url); t.after(() => f.close());
  const before = await f.protectedState(), { app, actors, workId } = f;
  const payload = { title: '新版纸飞机', description: '修改后的公开介绍', instructions: '鼠标点击或方向键移动', estimatedMinutes: 12, tags: ['竞速','休闲'], agentLabel: 'Cursor', repositoryUrl: 'https://github.com/example/plane-next', licenseSpdx: 'Apache-2.0' };
  const headers = { authorization: 'Bearer ' + actors.owner.userId, 'idempotency-key': crypto.randomUUID(), 'if-match': `"work-${workId}-0"` };
  const request = { method: 'PATCH', url: '/v1/creator/works/' + workId, headers, payload };
  const updated = await app.inject(request); assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().data.revision, '1'); assert.equal(updated.headers.etag, `"work-${workId}-1"`);
  const publicWork = (await app.inject({ url: '/v1/works/' + workId })).json().data;
  for (const [key, value] of Object.entries(payload)) assert.deepEqual(publicWork[key], value);
  assert.equal(publicWork.targets[0].currentReleaseId, f.releaseId);
  const replay = await app.inject(request); assert.equal(replay.statusCode, 200); assert.equal(replay.json().data.revision, '1');
  assert.equal((await app.inject({ ...request, headers: { ...headers, 'idempotency-key': crypto.randomUUID() } })).statusCode, 412);
  assert.equal((await app.inject({ ...request, payload: { title: 'changed body' } })).statusCode, 409);
  assert.equal((await app.inject({ ...request, headers: { authorization: headers.authorization, 'idempotency-key': crypto.randomUUID() } })).statusCode, 428);
  assert.equal((await app.inject({ ...request, headers: { ...headers, authorization: 'Bearer ' + actors.other.userId, 'idempotency-key': crypto.randomUUID() } })).statusCode, 404);
  const fresh = { ...headers, 'if-match': updated.headers.etag };
  for (const invalid of [{ kind: 'tool' }, { state: 'published' }, { title: '' }, { tags: Array.from({length:7},(_,i)=>'tag'+i) }, { estimatedMinutes: 31 }, { repositoryUrl: null }, { licenseSpdx: null }]) {
    const result = await app.inject({ ...request, headers: { ...fresh, 'idempotency-key': crypto.randomUUID() }, payload: invalid }); assert.equal(result.statusCode, 400, result.body);
  }
  const cleared = await app.inject({ ...request, headers: { ...fresh, 'idempotency-key': crypto.randomUUID() }, payload: { repositoryUrl: null, licenseSpdx: null, agentLabel: null, instructions: '', tags: [] } });
  assert.equal(cleared.statusCode, 200, cleared.body); assert.equal(cleared.json().data.repositoryUrl, null);
  assert.equal(cleared.json().data.kind, 'game'); assert.equal(cleared.json().data.revision, '2');
  assert.deepEqual(await f.protectedState(), before);
});
