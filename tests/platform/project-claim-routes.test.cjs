const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const moduleUrl=pathToFileURL(path.resolve(__dirname,'../../apps/api/src/app.mjs'));
const workId=crypto.randomUUID(),claimId=crypto.randomUUID(),connectionId=crypto.randomUUID();
const user={userId:crypto.randomUUID(),scopes:['works:write'],profile:{role:'user',canPublish:true,displayName:'作者'}};
const admin={...user,userId:crypto.randomUUID(),profile:{...user.profile,role:'admin'}};

const create=async()=>{
  const {createApp}=await import(moduleUrl);
  const calls=[];
  const projectClaimService={
    publicStatus:async id=>({workId:id,ingestionMethod:'zip_upload',attributionKind:'community_catalog',eligible:true,status:'unclaimed',relationship:null,claimantDisplayName:null,claimantHandle:null,verifiedAt:null}),
    submit:async(actor,id,body)=>(calls.push(['submit',actor,id,body]),{id:claimId,status:'pending'}),
    listMine:async()=>[],cancel:async()=>({id:claimId,status:'cancelled'}),listAdmin:async()=>[],
    decide:async(actor,id,body)=>(calls.push(['decide',actor,id,body]),{id,status:body.action==='approve'?'verified':'rejected'}),
  };
  const app=createApp({config:{requestBodyLimit:65536,corsOrigins:[],cloudSaveEnabled:false},projectClaimService,authService:{authenticateBearer:async header=>header==='Bearer admin'?admin:user}});
  return{app,calls};
};

test('project claim routes expose public status and authenticate mutations',async t=>{
  const {app,calls}=await create();t.after(()=>app.close());
  const publicResponse=await app.inject({method:'GET',url:`/v1/works/${workId}/claim`});
  assert.equal(publicResponse.statusCode,200);assert.equal(publicResponse.json().data.status,'unclaimed');assert.match(publicResponse.headers['cache-control'],/max-age=30/);
  const created=await app.inject({method:'POST',url:`/v1/works/${workId}/claims`,headers:{authorization:'Bearer user'},payload:{evidenceType:'github',connectionId,repositoryId:'42',relationship:'owner'}});
  assert.equal(created.statusCode,201);assert.equal(calls[0][0],'submit');assert.equal(calls[0][1].userId,user.userId);
  const manual=await app.inject({method:'POST',url:`/v1/works/${workId}/claims`,headers:{authorization:'Bearer user'},payload:{evidenceType:'storefront',evidenceUrl:'https://example.com/my-game',relationship:'owner',note:'这是公开的作者发行页面'}});
  assert.equal(manual.statusCode,201);assert.equal(calls[1][3].evidenceType,'storefront');
  const decided=await app.inject({method:'POST',url:`/v1/admin/project-claims/${claimId}/decision`,headers:{authorization:'Bearer admin'},payload:{action:'approve',note:'GitHub repository verified'}});
  assert.equal(decided.statusCode,200);assert.equal(calls[2][1].userId,admin.userId);assert.equal(calls[2][3].action,'approve');
});

test('project claim route schemas reject unknown evidence fields',async t=>{
  const {app,calls}=await create();t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:`/v1/works/${workId}/claims`,headers:{authorization:'Bearer user'},payload:{evidenceType:'github',connectionId,repositoryId:'42',relationship:'owner',trusted:true}});
  assert.equal(response.statusCode,400);assert.equal(calls.length,0);
});
