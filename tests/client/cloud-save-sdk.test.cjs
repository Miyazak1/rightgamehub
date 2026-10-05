const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createSaveBridge}=require('../helpers/game-save-bridge.cjs');
const id=()=>crypto.randomUUID();
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const descriptor=()=>({workId:id(),releaseId:id(),channel:'production',capabilities:{cloudSave:true}});
const policy={namespace:'default',status:'active',maxSlots:10,maxDocumentBytes:262144,maxLiveBytes:1048576,maxHistoryBytes:5242880,historyVersions:5,historyDays:7,schemaMin:1,schemaMax:2,contentTypes:['application/json','application/octet-stream']};
function fakeApi(extra={}) {
  const calls=[],api={
    createGameSession:async()=>({data:{gameSessionId:'private-game-session',expiresAt:new Date(Date.now()+300000).toISOString(),capabilities:['cloudSave']}}),
    revokeGameSession:async()=>({}),
    getGameSaveWriteReceipt:async()=>({data:{result:null}}),
    getGameSavePolicy:async(scope,options)=>{calls.push({scope,options});return {data:policy};},
    writeGameSave:async(scope,input,options)=>{
      calls.push({scope,input,options});
      return {data:{slot:scope.slotKey,namespace:scope.namespace,revisionId:id(),revision:'1',etag:'"saved-etag"',schemaVersion:input.schemaVersion,contentType:input.contentType,
        contentEncoding:'identity',sha256:input.sha256,bytes:input.bytes.length,updatedAt:new Date().toISOString(),deleted:false,restoredFromRevisionId:null,
        historyDegraded:false,durability:'cloud',privateToken:'must-not-reach-game'}};
    },...extra,
  };
  return {api,calls};
}
test('SDK writes actual 256 KiB chunks and empty bytes through the default host without leaking scope credentials',async t=>{
  const {api,calls}=fakeApi(),statuses=[];
  const h=await createSaveBridge({api,descriptor:descriptor(),onStatus:value=>statuses.push(value)});t.after(()=>h.close());
  const bytes=crypto.randomBytes(262144),key=id();
  const result=await h.client.cloudSave.write({slot:'autosave',data:bytes,schemaVersion:1,createOnly:true,idempotencyKey:key});
  const write=calls.find(call=>call.input);
  assert.deepEqual(Buffer.from(write.input.bytes),bytes);assert.equal(write.input.idempotencyKey,key);assert.equal(write.scope.gameSessionId,'private-game-session');
  assert.equal(result.bytes,bytes.length);assert.equal(result.privateToken,undefined);
  assert.equal(statuses.at(-1).state,'cloud');
  assert.ok(h.wire.every(frame=>Buffer.byteLength(JSON.stringify(frame))<=32768));
  assert.doesNotMatch(JSON.stringify(h.wire),/private-game-session|must-not-reach-game|gameSessionId|Bearer/);
  const empty=await h.client.cloudSave.write({slot:'empty',data:new Uint8Array(0),schemaVersion:1,createOnly:true,idempotencyKey:id()});
  assert.equal(empty.bytes,0);
  const json=await h.client.cloudSave.write({slot:'json',data:{chapter:'二'},schemaVersion:1,createOnly:true,idempotencyKey:id()});
  assert.equal(json.contentType,'application/json');
});
test('host rejects scope injection, oversized policy allocation and changed commit metadata before any write',async t=>{
  const {api,calls}=fakeApi();const h=await createSaveBridge({api,descriptor:descriptor()});t.after(()=>h.close());
  assert.equal((await h.raw('cloudSave.policy.get',{namespace:'default',workId:id()})).error.code,'SAVE_REQUEST_INVALID');
  assert.equal((await h.raw('cloudSave.slots.metadata',{slot:'autosave',userId:id()})).error.code,'SAVE_REQUEST_INVALID');
  const input={slot:'autosave',schemaVersion:1,contentType:'application/octet-stream',createOnly:true,idempotencyKey:id(),totalBytes:262145,sha256:'a'.repeat(64)};
  assert.equal((await h.raw('cloudSave.transfer.begin',input)).error.code,'SAVE_DOCUMENT_TOO_LARGE');
  const bytes=Buffer.from([1,2,3]);
  const begin=await h.raw('cloudSave.transfer.begin',{...input,totalBytes:3,sha256:hash(bytes)});
  assert.equal(begin.ok,true,JSON.stringify(begin));
  const transferId=begin.result.transferId;
  assert.equal((await h.raw('cloudSave.transfer.commit',{transferId,slot:'another'})).error.code,'SAVE_REQUEST_INVALID');
  assert.equal((await h.raw('cloudSave.transfer.append',{transferId,index:0,chunk:bytes.toString('base64')})).ok,true);
  assert.equal((await h.raw('cloudSave.transfer.commit',{transferId})).ok,true);
  assert.equal(calls.filter(call=>call.input).length,1);
  assert.equal(calls.find(call=>call.input).scope.slotKey,'autosave');
});
test('a commit holds the transfer until acknowledgement and only then reports cloud durability',async t=>{
  let finish,entered;const ready=new Promise(resolve=>{entered=resolve;});
  const base=fakeApi(),statuses=[];
  const original=base.api.writeGameSave;
  base.api.writeGameSave=async(...args)=>{entered();await new Promise(resolve=>{finish=resolve;});return original(...args);};
  const h=await createSaveBridge({api:base.api,descriptor:descriptor(),onStatus:value=>statuses.push(value)});t.after(()=>h.close());
  const writing=h.client.cloudSave.write({slot:'autosave',data:{x:1},schemaVersion:1,createOnly:true,idempotencyKey:id()});
  await ready;assert.equal(statuses.at(-1).state,'syncing');
  assert.equal((await h.raw('cloudSave.transfer.begin',{slot:'other',schemaVersion:1,createOnly:true,idempotencyKey:id(),totalBytes:0,sha256:hash(Buffer.alloc(0))})).error.code,'SAVE_TRANSFER_BUSY');
  finish();await writing;assert.equal(statuses.at(-1).state,'cloud');
});
test('CAS conflicts deliver only bounded reconciliation metadata and failed saves are never shown as cloud',async t=>{
  const statuses=[],{api}=fakeApi({writeGameSave:async()=>{throw Object.assign(new Error('Conflict'),{code:'SAVE_CONFLICT',status:412,retryable:false,
    details:{expectedEtag:'"current"',currentRevision:'19',currentUpdatedAt:'2026-10-05T00:00:00.000Z',userId:'private-user',payload:{secret:true}}});}});
  const h=await createSaveBridge({api,descriptor:descriptor(),onStatus:value=>statuses.push(value)});t.after(()=>h.close());
  await assert.rejects(h.client.cloudSave.write({slot:'autosave',data:{x:1},schemaVersion:1,expectedEtag:'"old"',idempotencyKey:id()}),error=>{
    assert.equal(error.code,'SAVE_CONFLICT');assert.equal(error.status,412);
    assert.deepEqual(error.details,{expectedEtag:'"current"',currentRevision:'19',currentUpdatedAt:'2026-10-05T00:00:00.000Z'});return true;
  });
  assert.equal(statuses.at(-1).state,'conflict');
  assert.equal((await h.client.cloudSave.getSyncStatus({slot:'autosave'})).state,'conflict');
  assert.doesNotMatch(JSON.stringify(h.wire),/private-user|secret/);
});
test('read verifies metadata, streams a single retained snapshot, and frees its cursor',async t=>{
  const bytes=crypto.randomBytes(100000);
  const meta={slot:'autosave',namespace:'default',revisionId:id(),revision:'7',etag:'"current"',schemaVersion:1,contentType:'application/octet-stream',contentEncoding:'identity',
    sha256:hash(bytes),bytes:bytes.length,updatedAt:new Date().toISOString(),deleted:false,restoredFromRevisionId:null};
  const {api}=fakeApi({getGameSaveMetadata:async()=>({data:meta}),readGameSave:async(_scope,etag)=>{assert.equal(etag,meta.etag);return {data:bytes,etag,sha256:meta.sha256,schemaVersion:1,contentType:meta.contentType};}});
  const h=await createSaveBridge({api,descriptor:descriptor()});t.after(()=>h.close());
  assert.deepEqual(Buffer.from((await h.client.cloudSave.read({slot:'autosave'})).data),bytes);
  assert.deepEqual(Buffer.from((await h.client.cloudSave.read({slot:'autosave'})).data),bytes);
  api.readGameSave=async()=>({data:bytes,etag:'"newer"',sha256:meta.sha256,schemaVersion:1,contentType:meta.contentType});
  await assert.rejects(h.client.cloudSave.read({slot:'autosave'}),{code:'SAVE_RESPONSE_INVALID'});
  api.readGameSave=async()=>({data:Buffer.alloc(bytes.length),etag:meta.etag,sha256:meta.sha256,schemaVersion:1,contentType:meta.contentType});
  await assert.rejects(h.client.cloudSave.read({slot:'autosave'}),{code:'SAVE_CONTENT_INVALID'});
});
test('reconnect and account change discard upload buffers before another launch can use them',async t=>{
  const {api,calls}=fakeApi();let account='a/grant-a';
  const h=await createSaveBridge({api,descriptor:descriptor(),identity:async()=>account});t.after(()=>h.close());
  const bytes=Buffer.from([1]),input={slot:'autosave',schemaVersion:1,contentType:'application/octet-stream',createOnly:true,idempotencyKey:id(),totalBytes:1,sha256:hash(bytes)};
  const first=(await h.raw('cloudSave.transfer.begin',input)).result;
  const next=h.newClient();await next.connect();
  assert.equal((await h.raw('cloudSave.transfer.append',{transferId:first.transferId,index:0,chunk:'AQ=='})).error.code,'SAVE_TRANSFER_EXPIRED');
  const second=(await h.raw('cloudSave.transfer.begin',input)).result;
  account='b/grant-b';
  await assert.rejects(next.cloudSave.getPolicy(),{code:'BRIDGE_CLOSED'});
  assert.equal(calls.filter(call=>call.input).length,0);
  assert.ok(second.transferId);
});
test('API download enforces actual streamed bytes, content length and timeout; errors retain CAS details',async()=>{
  const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');
  const scope={workId:id(),namespace:'default',slotKey:'autosave',gameSessionId:'scope'};
  let cancelled=false;
  const api=createApiClient({getAccessToken:()=> 'host-secret',fetchImpl:async()=>new Response(new ReadableStream({
    pull(controller){controller.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}
  }),{headers:{'content-type':'application/octet-stream'}})});
  await assert.rejects(api.readGameSave(scope,'"etag"'),{code:'SAVE_DOCUMENT_TOO_LARGE'});assert.equal(cancelled,true);
  const declared=createApiClient({fetchImpl:async()=>new Response('body',{headers:{'content-length':'1048577'}})});
  await assert.rejects(declared.readGameSave(scope,'"etag"'),{code:'SAVE_DOCUMENT_TOO_LARGE'});
  const stuck=createApiClient({timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({pull(){}}))});
  await assert.rejects(stuck.readGameSave(scope,'"etag"'),{code:'REQUEST_TIMEOUT'});
  const conflict=createApiClient({fetchImpl:async()=>new Response(JSON.stringify({error:{code:'SAVE_CONFLICT',retryable:false,details:{expectedEtag:'"current"'}}}),{status:412})});
  await assert.rejects(conflict.readGameSave(scope,'"old"'),error=>error.code==='SAVE_CONFLICT'&&error.details.expectedEtag==='"current"');
});
test('API guards run again before a credential retry and never submit a save under the changed account',async()=>{
  const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');
  let account='a',calls=0;
  const api=createApiClient({getAccessToken:()=>account+'-token',fetchImpl:async()=>{calls++;account='b';return new Response('{}',{status:401});}});
  const scope={workId:id(),namespace:'default',slotKey:'autosave',gameSessionId:'a-session'};
  await assert.rejects(api.writeGameSave(scope,{bytes:new Uint8Array(0),contentType:'application/octet-stream',sha256:hash(Buffer.alloc(0)),schemaVersion:1,createOnly:true,idempotencyKey:id()},
    {beforeRequest:()=>{if(account!=='a')throw Object.assign(new Error('Changed'),{code:'BRIDGE_ACCOUNT_CHANGED'});}}),{code:'BRIDGE_ACCOUNT_CHANGED'});
  assert.equal(calls,1);
});
