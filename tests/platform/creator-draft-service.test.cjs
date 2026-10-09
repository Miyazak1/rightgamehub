const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const actor = { userId: '11111111-1111-4111-8111-111111111111', scopes: ['works:read','works:write','upload'], profile: { canPublish: true } };

test('fixed Bingo builder escapes content and produces a validator-ready self-contained Web ZIP', async t => {
  const { buildBingoPackage } = await import('../../apps/api/src/creator-bingo-builder.mjs');
  const { validateWebZip } = await import('../../apps/api/src/web-zip-validator.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-bingo-build-')); t.after(()=>fs.rm(directory,{ recursive:true,force:true }));
  const built = buildBingoPackage({ tableTitle:'动漫 <表>',subtitle:'测试',columnHeaders:['年代','动画'],rowHeaders:['童年'],cells:{ '0:1':'<img src=x onerror=alert(1)>' } },{ draftId:'22222222-2222-4222-8222-222222222222',revision:'3' });
  assert.equal(built.zip.subarray(0,2).toString(),'PK'); assert.doesNotMatch(built.html,/<img src=x/u); assert.match(built.html,/&lt;img src=x/u);
  const archive=path.join(directory,'bingo.zip'); const output=path.join(directory,'expanded'); await fs.writeFile(archive,built.zip);
  const report=await validateWebZip(archive,output); assert.equal(report.entry,'index.html'); assert.deepEqual(Object.keys(report.assets).sort(),['bingo.json','gamehub-bingo.json','index.html']);
});

test('creator draft service creates, reads and updates versioned structured drafts', async () => {
  const { createCreatorDraftService, creatorDraftEtag } = await import('../../apps/api/src/creator-draft-service.mjs');
  let stored = null;
  const repository = {
    list: async () => stored ? [{ id: stored.id,title: stored.title,studio: stored.studio,revision: stored.revision }] : [],
    get: async (_userId,id) => stored?.id === id ? stored : null,
    createIdempotent: async input => (stored = { id: input.draftId,studio: input.body.studio,schemaVersion: input.body.schemaVersion,title: input.body.title,content: input.body.content,status: 'active',revision: '1' }),
    updateIdempotent: async input => (stored = { ...stored,...input.body,revision: String(Number(stored.revision) + 1) }),
  };
  const ids = ['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
  const service = createCreatorDraftService({ repository,ids: () => ids.shift() });
  const created = await service.create(actor,{ studio:'bingo',title:'动漫年代表',content:{ tableTitle:'动漫年代表',subtitle:'测试',columnHeaders:['年代','作品'],rowHeaders:['1990s'],cells:{ '0:1':'看过' } } },'creator-draft-create-0001');
  assert.equal(created.draft.revision,'1');
  assert.equal(created.etag,creatorDraftEtag(created.draft));
  assert.equal((await service.list(actor,'bingo')).length,1);
  assert.equal((await service.get(actor,created.draft.id)).draft.title,'动漫年代表');
  const updated = await service.update(actor,created.draft.id,{ title:'我的动漫年代表',content:{ tableTitle:'我的动漫年代表',subtitle:'测试',columnHeaders:['年代','作品'],rowHeaders:['1990s','2000s'],cells:{} } },'creator-draft-update-0001',created.etag);
  assert.equal(updated.draft.revision,'2');
  assert.equal(updated.draft.content.rowHeaders.length,2);
});

test('creator draft service enforces studio, scope, size and optimistic version contracts', async () => {
  const { createCreatorDraftService, CreatorDraftError } = await import('../../apps/api/src/creator-draft-service.mjs');
  const service = createCreatorDraftService({ repository: { list: async()=>[],get:async()=>null,createIdempotent:async()=>{},updateIdempotent:async()=>{} } });
  await assert.rejects(() => service.list({ ...actor,scopes:[] }), error => error instanceof CreatorDraftError && error.code === 'FORBIDDEN');
  await assert.rejects(() => service.create(actor,{ studio:'unknown',title:'x',content:{} },'creator-draft-create-0002'), error => error.code === 'STUDIO_NOT_SUPPORTED');
  await assert.rejects(() => service.create(actor,{ studio:'bingo',title:'x',content:{ text:'x'.repeat(1024*1024) } },'creator-draft-create-0003'), error => error.code === 'DRAFT_CONTENT_TOO_LARGE');
  await assert.rejects(() => service.create(actor,{ studio:'bingo',title:'x',content:{ tableTitle:'x',columnHeaders:['分类','A'],rowHeaders:['年代'],cells:{ '9:1':'越界' } } },'creator-draft-create-0004'), error => error.code === 'BINGO_CONTENT_INVALID');
  await assert.rejects(() => service.update(actor,'22222222-2222-4222-8222-222222222222',{ title:'x' },'creator-draft-update-0002','bad-etag'), error => error.code === 'PRECONDITION_REQUIRED');
});

test('creator draft build reuses the work pipeline and queues its generated package for validation', async () => {
  const { createCreatorDraftService } = await import('../../apps/api/src/creator-draft-service.mjs');
  const draft={ id:'22222222-2222-4222-8222-222222222222',studio:'bingo',schemaVersion:1,title:'动漫表',status:'active',content:{ tableTitle:'动漫表',subtitle:'一起点亮',columnHeaders:['年代','动画'],rowHeaders:['童年'],cells:{ '0:1':'看过' } },workId:null,revision:'2' };
  const events=[]; const repository={ get:async()=>draft,bindWork:async(_user,id,workId)=>{ events.push(['bind',id,workId]); draft.workId=workId; return draft; } };
  let uploadState='created';
  const workService={ create:async(_actor,body,key)=>{ events.push(['work',body,key]); return { work:{ id:'33333333-3333-4333-8333-333333333333' } }; } };
  const uploadService={
    create:async(_actor,workId,body,key)=>{ events.push(['upload',workId,body,key]); return { id:'44444444-4444-4444-8444-444444444444' }; },
    get:async()=>({ id:'44444444-4444-4444-8444-444444444444',state:uploadState }), grant:async()=>({ token:'x'.repeat(43) }),
    receive:async(_id,_auth,stream)=>{ const chunks=[]; for await (const chunk of stream) chunks.push(chunk); assert.equal(Buffer.concat(chunks).subarray(0,2).toString(),'PK'); uploadState='uploaded'; return { id:'44444444-4444-4444-8444-444444444444',state:'uploaded' }; },
    complete:async()=>({ id:'44444444-4444-4444-8444-444444444444',state:'queued',publicationOutcome:'pending' }),
  };
  const service=createCreatorDraftService({ repository,workService,uploadService });
  const result=await service.build(actor,draft.id,{ releaseLabel:'1.0.0' },'creator-bingo-build-0001',`"creator-draft-${draft.id}-2"`);
  assert.equal(result.workId,'33333333-3333-4333-8333-333333333333'); assert.equal(result.upload.state,'queued'); assert.match(result.artifactSha256,/^[a-f0-9]{64}$/u); assert.deepEqual(events.map(item=>item[0]),['work','bind','upload']);
});

test('creator draft HTTP routes preserve auth, no-store and ETag contracts', async t => {
  const { createApp } = await import('../../apps/api/src/app.mjs');
  const draftId = '22222222-2222-4222-8222-222222222222'; const calls = [];
  const draft = { id:draftId,studio:'bingo',schemaVersion:1,title:'动漫表',content:{ rows:['童年'] },revision:'1' };
  const app = createApp({
    config:{ requestBodyLimit:65536,corsOrigins:[] },database:{ ping:async()=>true },migrations:{ status:async()=>({ ready:true }) },
    authService:{ authenticateBearer:async header => { assert.equal(header,'Bearer draft-token'); return actor; } },
    creatorDraftService:{
      list:async(viewer,studio)=>{ calls.push(['list',viewer,studio]); return [draft]; },
      create:async(viewer,body,key)=>{ calls.push(['create',viewer,body,key]); return { draft,etag:`"creator-draft-${draftId}-1"` }; },
      get:async(viewer,id)=>{ calls.push(['get',viewer,id]); return { draft,etag:`"creator-draft-${draftId}-1"` }; },
      preview:async(viewer,id)=>{ calls.push(['preview',viewer,id]); return { draftId:id,revision:'1',html:'<!doctype html><p>preview</p>' }; },
      update:async(viewer,id,body,key,etag)=>{ calls.push(['update',viewer,id,body,key,etag]); return { draft:{ ...draft,...body,revision:'2' },etag:`"creator-draft-${draftId}-2"` }; },
      build:async(viewer,id,body,key,etag)=>{ calls.push(['build',viewer,id,body,key,etag]); return { draft,workId:'33333333-3333-4333-8333-333333333333',upload:{ id:'44444444-4444-4444-8444-444444444444',workId:'33333333-3333-4333-8333-333333333333',targetKey:'web',packageType:'web_zip',state:'queued',publicationOutcome:'pending',declaredBytes:'100',actualBytes:'100',createdAt:new Date().toISOString(),expiresAt:new Date().toISOString(),errorCode:null },artifactSha256:'a'.repeat(64),artifactBytes:'100' }; },
    },
  });
  t.after(()=>app.close());
  const headers={ authorization:'Bearer draft-token','idempotency-key':'creator-draft-route-0001' };
  const created=await app.inject({ method:'POST',url:'/v1/creator/drafts',headers,payload:{ studio:'bingo',title:'动漫表',content:{ rows:['童年'] } } });
  const listed=await app.inject({ method:'GET',url:'/v1/creator/drafts?studio=bingo',headers:{ authorization:'Bearer draft-token' } });
  const read=await app.inject({ method:'GET',url:`/v1/creator/drafts/${draftId}`,headers:{ authorization:'Bearer draft-token' } });
  const preview=await app.inject({ method:'GET',url:`/v1/creator/drafts/${draftId}/preview`,headers:{ authorization:'Bearer draft-token' } });
  const updated=await app.inject({ method:'PUT',url:`/v1/creator/drafts/${draftId}`,headers:{ ...headers,'if-match':`"creator-draft-${draftId}-1"` },payload:{ title:'我的动漫表' } });
  const built=await app.inject({ method:'POST',url:`/v1/creator/drafts/${draftId}/builds`,headers:{ ...headers,'if-match':`"creator-draft-${draftId}-1"` },payload:{ releaseLabel:'1.0.0' } });
  assert.deepEqual([created.statusCode,listed.statusCode,read.statusCode,preview.statusCode,updated.statusCode,built.statusCode],[200,200,200,200,200,202]);
  assert.equal(created.headers.etag,`"creator-draft-${draftId}-1"`); assert.equal(updated.headers.etag,`"creator-draft-${draftId}-2"`);
  assert.ok([created,listed,read,preview,updated,built].every(response=>response.headers['cache-control']==='no-store'));
  assert.deepEqual(calls.map(call=>call[0]),['create','list','get','preview','update','build']);
});

test('platform API client exposes creator draft list, preview, save and build operations', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  const requests=[]; const draftId='22222222-2222-4222-8222-222222222222';
  const client=createApiClient({ getAccessToken:()=> 'draft-token',fetchImpl:async(url,init)=>{ requests.push({ url,init }); return new Response(JSON.stringify({ data:{ id:draftId,revision:'2' } }),{ status:200,headers:{ 'content-type':'application/json' } }); } });
  await client.listCreatorDrafts('bingo');
  await client.createCreatorDraft({ studio:'bingo',title:'动漫表',content:{} });
  await client.getCreatorDraft(draftId);
  await client.previewCreatorDraft(draftId);
  await client.updateCreatorDraft(draftId,{ title:'我的动漫表' },'1');
  await client.buildCreatorDraft(draftId,{ releaseLabel:'1.0.0' },'2');
  assert.deepEqual(requests.map(item=>item.init.method),['GET','POST','GET','GET','PUT','POST']);
  assert.match(requests[0].url,/\/v1\/creator\/drafts\?studio=bingo$/u);
  assert.ok(requests[1].init.headers['Idempotency-Key'].length>=16);
  assert.equal(requests[4].init.headers['If-Match'],`"creator-draft-${draftId}-1"`); assert.equal(requests[5].init.headers['If-Match'],`"creator-draft-${draftId}-2"`);
  assert.ok(requests.every(item=>item.init.headers.Authorization==='Bearer draft-token'));
});
