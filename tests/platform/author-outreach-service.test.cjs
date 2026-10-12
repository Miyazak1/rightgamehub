const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..');

test('author outreach discovers only repository candidates and writes truthful drafts',async()=>{
  const {createAuthorOutreachService}=await import(pathToFileURL(path.join(root,'apps/api/src/author-outreach-service.mjs')));
  let synced;
  const repository={
    candidates:async()=>[{work_id:'00000000-0000-4000-8000-000000000001',title:'轨道秩序',description:'解谜',repository_url:'https://github.com/Open-Team/Orbital.git',license_spdx:'MIT'}],
    sync:async input=>{synced=input;return 1;},list:async()=>[{id:'saved'}],
    update:async input=>input,events:async()=>[],
  };
  let sequence=0;
  const service=createAuthorOutreachService({repository,siteOrigin:'https://mooyu.fun',ids:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,clock:()=>new Date('2026-10-12T08:00:00.000Z')});
  const actor={userId:'admin',profile:{role:'admin'}};
  const result=await service.sync(actor);
  assert.equal(result.inserted,1);
  assert.equal(synced.records[0].repositoryKey,'open-team/orbital');
  assert.equal(synced.records[0].repositoryUrl,'https://github.com/Open-Team/Orbital');
  assert.match(synced.records[0].draftBody,/MIT/u);
  assert.match(synced.records[0].draftBody,/平台代收录、等待作者认领/u);
  assert.match(synced.records[0].draftBody,/gh_campaign=author-outreach/u);
  await assert.rejects(()=>service.sync({userId:'user',profile:{role:'member'}}),error=>error.code==='ADMIN_REQUIRED');
});

test('author outreach requires an actual contact record before marking sent',async()=>{
  const {createAuthorOutreachService}=await import(pathToFileURL(path.join(root,'apps/api/src/author-outreach-service.mjs')));
  let updated;
  const repository={candidates:async()=>[],sync:async()=>0,list:async()=>[],events:async()=>[],update:async input=>{updated=input;return input;}};
  const service=createAuthorOutreachService({repository,ids:()=>crypto.randomUUID(),clock:()=>new Date('2026-10-12T08:00:00.000Z')});
  const actor={userId:'admin',profile:{role:'admin'}},id='00000000-0000-4000-8000-000000000065';
  const base={status:'contacted',draftSubject:'邀请作者认领作品',draftBody:'这是一份长度足够且需要人工确认后才会发送的作者联络正文，内容包含作品页面、原始仓库、许可证和退出方式，请在发送前逐项检查。',contactMethod:'github_issue',expectedVersion:'1'};
  assert.throws(()=>service.update(actor,id,base),error=>error.code==='OUTREACH_CONTACT_REQUIRED');
  assert.throws(()=>service.update(actor,id,{...base,contactReference:'https://example.com/not-a-github-issue'}),error=>error.code==='OUTREACH_CONTACT_INVALID');
  await service.update(actor,id,{...base,contactReference:'https://github.com/example/game/issues/12',note:'已人工核对并发送'});
  assert.equal(updated.contactMethod,'github_issue');
  assert.equal(updated.contactReference,'https://github.com/example/game/issues/12');
  assert.equal(updated.now.toISOString(),'2026-10-12T08:00:00.000Z');
});

test('outreach migration and query preserve eligibility, deduplication and append-only audit',async()=>{
  const [migration,service]=await Promise.all([fs.readFile(path.join(root,'apps/api/migrations/0065_author_outreach_queue.sql'),'utf8'),fs.readFile(path.join(root,'apps/api/src/author-outreach-service.mjs'),'utf8')]);
  assert.match(migration,/repository_key text NOT NULL UNIQUE/u);
  assert.match(migration,/author outreach events are append-only/u);
  assert.match(service,/w\.attribution_kind='community_catalog'/u);
  assert.match(service,/w\.state='published'/u);
  assert.match(service,/w\.license_spdx IS NOT NULL/u);
  assert.match(service,/c\.status IN \('pending','verified','disputed','suspended'\)/u);
  assert.doesNotMatch(service,/api\.github\.com/u);
});

test('author outreach HTTP routes are admin-authenticated, no-store and schema-bound',async t=>{
  const [{createApp},{AuthError}]=await Promise.all([import(pathToFileURL(path.join(root,'apps/api/src/app.mjs'))),import(pathToFileURL(path.join(root,'apps/api/src/auth-service.mjs')))]);
  let updated;
  const app=createApp({
    config:{requestBodyLimit:65536,corsOrigins:[],cloudSaveEnabled:false,nodeEnv:'test',gameShareSiteOrigin:'https://mooyu.fun'},database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},
    authService:{authenticateBearer:async value=>{if(!value)throw new AuthError('AUTH_REQUIRED',401,'Authentication required.');return{userId:'admin',profile:{role:'admin'}};}},
    authorOutreachService:{list:async()=>[{id:'one'}],sync:async()=>({inserted:0,totalCandidates:0,items:[]}),events:async()=>[],update:async(_actor,id,body)=>{updated={id,body};return{id,...body};}},
  });
  t.after(()=>app.close());
  const denied=await app.inject({method:'GET',url:'/v1/admin/author-outreach'});assert.equal(denied.statusCode,401);
  const listed=await app.inject({method:'GET',url:'/v1/admin/author-outreach?status=all&limit=100',headers:{authorization:'Bearer admin'}});assert.equal(listed.statusCode,200);assert.equal(listed.headers['cache-control'],'no-store');
  const id='00000000-0000-4000-8000-000000000065',payload={status:'ready',draftSubject:'邀请作者核对作品',draftBody:'这是一份需要人工核对后发送、长度满足要求的作者联络正文，内容包含作品页面、原始仓库、许可证和退出方式，请在发送前逐项检查。',contactMethod:'github_issue',contactReference:null,note:null,expectedVersion:'1'};
  const saved=await app.inject({method:'PATCH',url:`/v1/admin/author-outreach/${id}`,headers:{authorization:'Bearer admin'},payload});assert.equal(saved.statusCode,200);assert.equal(updated.id,id);
  const extra=await app.inject({method:'PATCH',url:`/v1/admin/author-outreach/${id}`,headers:{authorization:'Bearer admin'},payload:{...payload,unexpected:true}});assert.equal(extra.statusCode,400);
});
