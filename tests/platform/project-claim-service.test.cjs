const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,'../../apps/api/src/project-claim-service.mjs'));
const workId=crypto.randomUUID(),connectionId=crypto.randomUUID(),claimId=crypto.randomUUID();
const actor={userId:crypto.randomUUID(),scopes:['works:read','works:write'],profile:{canPublish:true,role:'user',displayName:'作者'}};

test('claim submission requires creator permission and records normalized evidence input',async()=>{
  let received;
  const {createProjectClaimService,ProjectClaimError}=await import(moduleUrl);
  const service=createProjectClaimService({repository:{create:async input=>(received=input,{id:input.claimId,status:'pending'})},ids:(()=>{const ids=[claimId,crypto.randomUUID()];return()=>ids.shift();})(),clock:()=>new Date('2026-10-10T08:00:00Z')});
  assert.throws(()=>service.submit({...actor,profile:{...actor.profile,canPublish:false}},workId,{evidenceType:'github',connectionId,repositoryId:'42',relationship:'owner'}),error=>error instanceof ProjectClaimError&&error.code==='CREATOR_REQUIRED');
  const result=await service.submit(actor,workId,{evidenceType:'github',connectionId,repositoryId:'42',relationship:'maintainer',note:'  Maintains releases  '});
  assert.equal(result.status,'pending');
  assert.equal(received.evidenceType,'github');
  assert.equal(received.repositoryId,'42');
  assert.equal(received.relationship,'maintainer');
  assert.equal(received.note,'Maintains releases');
  assert.equal(received.submittedAt.toISOString(),'2026-10-10T08:00:00.000Z');
});

test('a game without GitHub can be claimed with public manual evidence',async()=>{
  let received;
  const {createProjectClaimService,ProjectClaimError}=await import(moduleUrl);
  const service=createProjectClaimService({repository:{create:async input=>(received=input,{id:input.claimId,status:'pending'})}});
  assert.throws(()=>service.submit(actor,workId,{evidenceType:'website',evidenceUrl:'http://example.com',relationship:'owner',note:'这是我的游戏官方网站'}),error=>error instanceof ProjectClaimError&&error.code==='CLAIM_EVIDENCE_INVALID');
  await service.submit(actor,workId,{evidenceType:'storefront',evidenceUrl:'https://example.com/my-game',relationship:'owner',note:'这是我负责发行的游戏商店页面'});
  assert.equal(received.connectionId,null);assert.equal(received.repositoryId,null);assert.equal(received.evidenceType,'storefront');assert.equal(received.evidenceUrl,'https://example.com/my-game');
});

test('claim decisions require admin and a review note',async()=>{
  let decision;
  const {createProjectClaimService,ProjectClaimError}=await import(moduleUrl);
  const service=createProjectClaimService({repository:{decide:async input=>(decision=input,{id:input.claimId,status:'verified'})},ids:()=>crypto.randomUUID()});
  assert.throws(()=>service.decide(actor,claimId,{action:'approve',note:'verified'}),error=>error instanceof ProjectClaimError&&error.code==='ADMIN_REQUIRED');
  assert.throws(()=>service.decide({...actor,profile:{...actor.profile,role:'admin'}},claimId,{action:'approve',note:'x'}),error=>error.code==='CLAIM_DECISION_NOTE_INVALID');
  await service.decide({...actor,profile:{...actor.profile,role:'admin'}},claimId,{action:'approve',note:'GitHub ownership verified'});
  assert.equal(decision.action,'approve');
  assert.equal(decision.note,'GitHub ownership verified');
});

test('built-in works return a stable publisher provenance state',async()=>{
  const {createProjectClaimService}=await import(moduleUrl);
  const service=createProjectClaimService({repository:{getPublic:async()=>assert.fail('database should not be queried')}});
  assert.deepEqual(await service.publicStatus('gamehub-guess-baike'),{workId:'gamehub-guess-baike',ingestionMethod:'platform',attributionKind:'publisher',eligible:false,status:'publisher',relationship:null,claimantDisplayName:null,claimantHandle:null,verifiedAt:null});
});

test('public provenance keeps ingestion method separate from claimable attribution',async()=>{
  const {PostgresProjectClaimRepository}=await import(moduleUrl);
  const states=[];
  for(const [ingestionMethod,attributionKind] of [['zip_upload','publisher'],['github_import','community_catalog']]){
    let call=0;
    const repository=new PostgresProjectClaimRepository({query:async()=>++call===1?{rows:[{id:workId,repository_url:null,license_spdx:null,ingestion_method:ingestionMethod,attribution_kind:attributionKind}]}:{rows:[]}});
    states.push(await repository.getPublic(workId));
  }
  assert.equal(states[0].ingestionMethod,'zip_upload');assert.equal(states[0].status,'publisher');assert.equal(states[0].eligible,false);
  assert.equal(states[1].ingestionMethod,'github_import');assert.equal(states[1].status,'unclaimed');assert.equal(states[1].eligible,true);
});
