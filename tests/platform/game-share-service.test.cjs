const test = require('node:test');
const assert = require('node:assert/strict');

test('game shares deduplicate playable content and remain public to readers', async () => {
  const { createGameShareService } = await import('../../apps/api/src/game-share-service.mjs');
  const rows = new Map(); let inserts = 0;
  const repository = {
    async findByDigest({ userId,workId,payloadSha256 }) { return rows.get(`${userId}:${workId}:${payloadSha256}`) ?? null; },
    async create(input) {
      inserts += 1;
      const row = { code:input.code,workId:input.workId,title:input.title,payload:input.payload,createdAt:'2026-10-09T00:00:00.000Z' };
      rows.set(`${input.userId}:${input.workId}:${input.payloadSha256}`, row); rows.set(input.code,row); return row;
    },
    async get(code) { return rows.get(code) ?? null; },
  };
  const service = createGameShareService({ repository,catalogService: { get: async id => ({ id }) },ids: () => '00000000-0000-4000-8000-000000000001',randomBytes: () => Buffer.from('123456789') });
  const actor = { userId:'00000000-0000-4000-8000-000000000002' };
  const workId = '00000000-0000-4000-8000-000000000003';
  const payload = { kind:'bingo-pack',schemaVersion:1,pack:{ title:'动画 Bingo' } };
  const first = await service.create(actor,workId,{ title:'动画 Bingo',payload });
  const second = await service.create(actor,workId,{ title:'改名不会产生重复链接',payload });
  assert.equal(first.code, second.code);
  assert.equal(inserts,1);
  assert.deepEqual((await service.get(first.code)).payload,payload);
});

test('game shares reject oversized or missing content', async () => {
  const { createGameShareService } = await import('../../apps/api/src/game-share-service.mjs');
  const service = createGameShareService({ repository: { findByDigest:async()=>null,get:async()=>null },catalogService: { get:async()=>({}) } });
  const actor = { userId:'00000000-0000-4000-8000-000000000002' };
  await assert.rejects(service.create(actor,'00000000-0000-4000-8000-000000000003',{ title:'Too large',payload:{ data:'x'.repeat(49 * 1024) } }), error => error.code === 'SHARE_TOO_LARGE');
  await assert.rejects(service.get('not-found-code'), error => error.code === 'SHARE_NOT_FOUND');
});

test('game share API creates authenticated links and resolves them publicly', async t => {
  const { createApp } = await import('../../apps/api/src/app.mjs');
  const workId = '00000000-0000-4000-8000-000000000003';
  const code = 'BingoLink123'; let createArgs;
  const app = createApp({
    config:{ requestBodyLimit:65536,corsOrigins:[] },database:{ ping:async()=>true },migrations:{ status:async()=>({ ready:true }) },
    authService:{ authenticateBearer:async header => { assert.equal(header,'Bearer account-token'); return { userId:'00000000-0000-4000-8000-000000000002' }; } },
    gameShareService:{
      create:async (...args) => { createArgs=args; return { code,workId,title:'动画 Bingo',payload:args[2].payload,createdAt:'2026-10-09T00:00:00.000Z' }; },
      get:async received => ({ code:received,workId,title:'动画 Bingo',payload:{ kind:'bingo-pack' },createdAt:'2026-10-09T00:00:00.000Z' }),
    },
  });
  t.after(() => app.close());
  const created = await app.inject({ method:'POST',url:`/v1/works/${workId}/game-shares`,headers:{ authorization:'Bearer account-token' },payload:{ title:'动画 Bingo',payload:{ kind:'bingo-pack' } } });
  assert.equal(created.statusCode,200,created.body);
  assert.equal(created.json().data.code,code);
  assert.equal(createArgs[1],workId);
  const opened = await app.inject({ url:`/v1/game-shares/${code}` });
  assert.equal(opened.statusCode,200,opened.body);
  assert.equal(opened.json().data.payload.kind,'bingo-pack');
});
