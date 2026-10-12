const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const moduleUrl=pathToFileURL(path.resolve(__dirname,'../../apps/api/src/discovery-campaign-service.mjs'));
const apiModuleUrl=name=>pathToFileURL(path.resolve(__dirname,`../../apps/api/src/${name}`));
const actor={userId:crypto.randomUUID(),profile:{role:'admin'},scopes:[]};
const workId=crypto.randomUUID(),campaignId=crypto.randomUUID();
const work={id:workId,title:'开放游戏',description:'可以直接游玩',kind:'game',targets:[]};
const input={slug:'weekly-open-game-01',eyebrow:'OPEN GAME',title:'本周开放游戏推荐',summary:'这是一段长度足够的专题摘要，用于说明本周为什么值得体验这款作品。',campaignKind:'weekly_open_game',startsAt:null,endsAt:null,items:[{workId,pitch:'无需安装，打开即可体验完整玩法。'}]};

test('discovery campaigns require admin and normalize an auditable draft',async()=>{
  const {createDiscoveryCampaignService,DiscoveryCampaignError}=await import(moduleUrl);
  let received;
  const ids=[campaignId,crypto.randomUUID()];
  const service=createDiscoveryCampaignService({repository:{create:async value=>(received=value,{id:value.campaignId,slug:value.slug,eyebrow:value.eyebrow,title:value.title,summary:value.summary,campaignKind:value.campaignKind,publicationState:'draft',version:1,items:value.items})},catalogService:{get:async()=>work},ids:()=>ids.shift()});
  assert.throws(()=>service.create({...actor,profile:{role:'user'}},input),error=>error instanceof DiscoveryCampaignError&&error.code==='ADMIN_REQUIRED');
  const result=await service.create(actor,{...input,title:'  本周开放游戏推荐  ',items:[{workId,pitch:'  无需安装，打开即可体验完整玩法。  '}]});
  assert.equal(received.title,'本周开放游戏推荐');
  assert.equal(received.items[0].pitch,'无需安装，打开即可体验完整玩法。');
  assert.equal(result.publicUrl,'https://mooyu.fun/discover/c/weekly-open-game-01');
  assert.equal(result.items[0].work.id,workId);
});

test('campaign publication uses optimistic versions and does not accept edit fields for state actions',async()=>{
  const {createDiscoveryCampaignService,DiscoveryCampaignError}=await import(moduleUrl);
  let received;
  const service=createDiscoveryCampaignService({repository:{update:async value=>(received=value,{id:value.campaignId,slug:'weekly-open-game-01',publicationState:'published',version:2,items:[]})},catalogService:{get:async()=>work},ids:()=>crypto.randomUUID()});
  assert.throws(()=>service.update(actor,campaignId,{action:'publish',expectedVersion:0}),error=>error instanceof DiscoveryCampaignError&&error.code==='DISCOVERY_CAMPAIGN_INVALID');
  await service.update(actor,campaignId,{action:'publish',expectedVersion:3,title:'不应进入仓库'});
  assert.deepEqual({action:received.action,expectedVersion:received.expectedVersion},{action:'publish',expectedVersion:3});
  assert.equal('title' in received,false);
});

test('public campaign listing fails closed when all referenced works become unavailable',async()=>{
  const {createDiscoveryCampaignService}=await import(moduleUrl);
  const service=createDiscoveryCampaignService({
    repository:{listPublic:async()=>[{id:campaignId,slug:input.slug,eyebrow:input.eyebrow,title:input.title,summary:input.summary,campaignKind:input.campaignKind,publicationState:'published',version:1,items:input.items}]},
    catalogService:{get:async()=>{throw new Error('withdrawn');}},
  });
  assert.deepEqual(await service.listPublic({limit:3}),[]);
});

test('campaign routes expose public reading and protect admin mutations',async t=>{
  const {createApp}=await import(apiModuleUrl('app.mjs'));
  const {AuthError}=await import(apiModuleUrl('auth-service.mjs'));
  const calls=[];
  const campaign={id:campaignId,slug:'weekly-open-game-01',eyebrow:'OPEN GAME',title:'本周开放游戏推荐',summary:input.summary,campaignKind:'weekly_open_game',publicationState:'published',version:1,items:[{workId,pitch:input.items[0].pitch,position:0,work}],publicUrl:'https://mooyu.fun/discover/c/weekly-open-game-01'};
  const service={listPublic:async query=>(calls.push(['list',query]),[campaign]),getPublic:async slug=>(calls.push(['get',slug]),campaign),listAdmin:async viewer=>(calls.push(['admin',viewer]),[campaign]),create:async()=>campaign,update:async()=>campaign};
  const app=createApp({config:{requestBodyLimit:65536,gameShareSiteOrigin:'https://mooyu.fun'},database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},authService:{authenticateBearer:async authorization=>{if(!authorization)throw new AuthError('AUTH_REQUIRED',401,'Authentication required.');return actor;}},discoveryCampaignService:service});
  t.after(()=>app.close());
  const list=await app.inject({url:'/v1/discovery/campaigns?limit=1'});assert.equal(list.statusCode,200);assert.equal(list.headers['cache-control'],'public, max-age=30');
  const page=await app.inject({url:'/discover/c/weekly-open-game-01'});assert.equal(page.statusCode,200);assert.match(page.body,/本周开放游戏推荐/);assert.match(page.headers['content-security-policy'],/nonce-/);
  assert.match(page.body,/\/v1\/discovery\/campaigns\/weekly-open-game-01\/share-card\.png/);
  assert.match(page.body,/name="robots" content="index,follow,max-image-preview:large"/);
  assert.match(page.body,/type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"CollectionPage"/);
  assert.match(page.body,new RegExp(`https://mooyu\\.fun/w/${workId}`));
  const card=await app.inject({url:'/v1/discovery/campaigns/weekly-open-game-01/share-card.png?download=1'});assert.equal(card.statusCode,200);assert.match(card.headers['content-type'],/^image\/png/);assert.match(card.headers['content-disposition'],/^attachment/);
  assert.equal(card.rawPayload.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(card.rawPayload.readUInt32BE(16),1200);assert.equal(card.rawPayload.readUInt32BE(20),630);
  const denied=await app.inject({url:'/v1/admin/discovery-campaigns'});assert.equal(denied.statusCode,401);
  const admin=await app.inject({url:'/v1/admin/discovery-campaigns',headers:{authorization:'Bearer token'}});assert.equal(admin.statusCode,200);assert.equal(calls.at(-1)[0],'admin');
});
