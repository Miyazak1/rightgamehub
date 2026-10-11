const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const moduleUrl=pathToFileURL(path.resolve(__dirname,'../../apps/api/src/work-service.mjs'));
const baseActor={userId:crypto.randomUUID(),scopes:['works:write'],profile:{canPublish:true,role:'user'}};
const body={title:'Test game',description:'',kind:'game'};

test('ordinary creators own both ZIP uploads and GitHub-linked creations by default',async()=>{
  const {createWorkService}=await import(moduleUrl);
  const received=[];
  const repository={createIdempotent:async input=>(received.push(input),{id:input.workId,revision:1})};
  const service=createWorkService({repository});
  await service.create(baseActor,body,'ordinary-create-key');
  await service.create(baseActor,{...body,repositoryUrl:'https://github.com/creator/game',licenseSpdx:'MIT'},'github-linked-key');
  assert.deepEqual(received.map(input=>input.body.attributionKind),['publisher','publisher']);
});

test('only an administrator can create a claimable catalog entry',async()=>{
  const {createWorkService,WorkError}=await import(moduleUrl);
  const received=[];
  const repository={createIdempotent:async input=>(received.push(input),{id:input.workId,revision:1})};
  const service=createWorkService({repository});
  await assert.rejects(service.create(baseActor,{...body,attributionKind:'community_catalog'},'forbidden-catalog-key'),error=>error instanceof WorkError&&error.code==='ATTRIBUTION_INVALID');
  await service.create({...baseActor,profile:{...baseActor.profile,role:'admin'}},body,'admin-catalog-key');
  assert.equal(received[0].body.attributionKind,'community_catalog');
});

test('remix source and explanation are an explicit pair',async()=>{
  const {createWorkService,WorkError}=await import(moduleUrl);
  const received=[];const repository={createIdempotent:async input=>(received.push(input),{id:input.workId,revision:1}),updateIdempotent:async input=>(received.push(input),{id:input.workId,revision:2})};
  const service=createWorkService({repository});const source=crypto.randomUUID();
  await assert.rejects(service.create(baseActor,{...body,remixSourceWorkId:source},'missing-remix-note'),error=>error instanceof WorkError&&error.code==='REMIX_SOURCE_INVALID');
  await service.create(baseActor,{...body,remixSourceWorkId:source,remixNote:'保留核心玩法并重做了关卡与美术。'},'valid-remix-source');
  assert.equal(received[0].body.remixSourceWorkId,source);assert.match(received[0].remixEventId,/^[0-9a-f-]{36}$/);
});
