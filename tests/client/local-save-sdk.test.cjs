const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createSaveBridge}=require('../helpers/game-save-bridge.cjs');
const id=()=>crypto.randomUUID();
async function fixture(t,{anonymous=false}={}){
  const {createSqliteSaveStore}=await import('../../packages/save-cache/src/sqlite-store.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-local-sdk-'));
  const store=await createSqliteSaveStore({root}),bridges=[];
  t.after(async()=>{for(const b of bridges)b.close();await store.close();await fs.rm(root,{recursive:true,force:true});});
  const descriptor={workId:id(),releaseId:id(),channel:'production',capabilities:{cloudSave:true}},user=id();
  let offline=false,cloud=null,loseAck=false,calls=0,sessions=0,revoked=false;
  const receipts=new Map();
  const api={
    createGameSession:async()=>{sessions++;return {data:{gameSessionId:'secret-session',expiresAt:new Date(Date.now()+300000).toISOString(),capabilities:['cloudSave']}};},
    revokeGameSession:async()=>({}),
    getGameSaveMetadata:async()=>{
      if(offline)throw Object.assign(Error('offline'),{code:'NETWORK_ERROR',retryable:true});
      if(!cloud)throw Object.assign(Error('missing'),{code:'SAVE_SLOT_NOT_FOUND'});
      return {data:cloud.meta};
    },
    readGameSave:async()=>({...cloud.meta,data:cloud.body}),
    writeGameSave:async(scope,input)=>{
      calls++;
      if(revoked)throw Object.assign(Error('revoked'),{code:'AUTH_REQUIRED'});
      if(offline)throw Object.assign(Error('offline'),{code:'NETWORK_ERROR',retryable:true});
      if(receipts.has(input.idempotencyKey))return receipts.get(input.idempotencyKey);
      if((cloud?.meta.etag??null)!==input.expectedEtag)throw Object.assign(Error('conflict'),{code:'SAVE_CONFLICT'});
      const meta={namespace:scope.namespace,slot:scope.slotKey,etag:'"rev-'+(Number(cloud?.meta.revision??0)+1)+'"',revision:String(Number(cloud?.meta.revision??0)+1),
        revisionId:id(),bytes:input.bytes.length,schemaVersion:input.schemaVersion,sha256:input.sha256,contentType:input.contentType,deleted:false};
      cloud={meta,body:input.bytes};receipts.set(input.idempotencyKey,{data:meta});
      if(loseAck){loseAck=false;throw Object.assign(Error('lost'),{code:'NETWORK_ERROR',retryable:true});}
      return {data:meta};
    },
  };
  const owner=(anonymous?'anonymous:':'user:')+(anonymous?await store.anonymousId():user);
  const open=async(options={})=>{
    const b=await createSaveBridge({api,descriptor,saveCache:store,getSaveOwner:async()=>owner,saveOrigin:'http://127.0.0.1:3086',...options});
    bridges.push(b);return b;
  };
  return {open,store,owner,user,descriptor,api,offline:v=>offline=v,lose:()=>loseAck=true,revoke:()=>revoked=true,cloud:()=>cloud,calls:()=>calls,sessions:()=>sessions};
}
test('local SDK chunks survive a launch restart offline, original cloud ACK loss and reconnect',async t=>{
  const f=await fixture(t),h=await f.open(),api=h.client.cloudSave.local;
  const empty=await api.read({slot:'autosave'});
  f.offline(true);const data={text:'中'.repeat(20000)};
  const saved=await api.write({slot:'autosave',schemaVersion:1,data,expectedEtag:empty.etag,idempotencyKey:id()});
  assert.equal(saved.durability,'local');assert.equal((await api.sync({slot:'autosave'})).state,'error_retryable');h.close();
  const next=await f.open(),restored=await next.client.cloudSave.local.read({slot:'autosave'});
  assert.deepEqual(restored.data,data);
  f.offline(false);f.lose();await next.client.cloudSave.local.sync({slot:'autosave'});
  assert.equal(f.cloud().meta.revision,'1');
  const result=await next.client.cloudSave.local.sync({slot:'autosave'});assert.equal(result.state,'cloud');assert.equal(f.cloud().meta.revision,'1');
  for(const b of [h,next]){
    assert.ok(b.wire.every(frame=>Buffer.byteLength(JSON.stringify(frame))<=32768));
    assert.doesNotMatch(JSON.stringify(b.wire),new RegExp('secret-session|'+f.user+'|127.0.0.1|gameSessionId'));
  }
});
test('anonymous local SDK never requires a network session; forged identity and cross-work requests are rejected',async t=>{
  const f=await fixture(t,{anonymous:true}),h=await f.open(),api=h.client.cloudSave.local;
  f.offline(true);const empty=await api.read({slot:'autosave'});
  const saved=await api.write({slot:'autosave',schemaVersion:1,data:{guest:true},expectedEtag:empty.etag,idempotencyKey:id()});
  assert.equal(saved.state,'local_only');assert.equal((await api.sync({slot:'autosave'})).state,'local_only');assert.equal(f.sessions(),0);
  for(const field of ['owner','userId','workId','origin','channel']){
    assert.equal((await h.raw('cloudSave.local.read',{slot:'autosave',[field]:id()})).error.code,'SAVE_REQUEST_INVALID');
  }
  const {runSaveStoreRequest}=await import('../../packages/save-cache/src/store-rpc.mjs');
  const scope={origin:'http://127.0.0.1:3086',owner:'user:'+id(),workId:f.descriptor.workId,namespace:'default',slot:'autosave',channel:'production'};
  await assert.rejects(runSaveStoreRequest({store:f.store,operation:'read',payload:{scope},origin:scope.origin,getTokens:async()=>null}),{code:'BRIDGE_ACCOUNT_CHANGED'});
});
test('local collision retains a readable recovery and cloud conflict requires inspected resolution',async t=>{
  const f=await fixture(t),a=await f.open(),b=await f.open(),slot={slot:'autosave'};
  const av=await a.client.cloudSave.local.read(slot),bv=await b.client.cloudSave.local.read(slot);
  await a.client.cloudSave.local.write({...slot,schemaVersion:1,data:{step:1},expectedEtag:av.etag,idempotencyKey:id()});
  await assert.rejects(b.client.cloudSave.local.write({...slot,schemaVersion:1,data:{step:2},expectedEtag:bv.etag,idempotencyKey:id()}),{code:'SAVE_LOCAL_CONFLICT'});
  const copies=await b.client.cloudSave.local.recoveries(slot);assert.equal(copies.length,1);
  assert.deepEqual((await b.client.cloudSave.local.readRecovery({...slot,recoveryId:copies[0].id})).data,{step:2});
  // Another device committed after our initial empty read.
  const bytes=Buffer.from('{"step":3}');
  await f.api.writeGameSave({slotKey:'autosave',namespace:'default'},{idempotencyKey:id(),expectedEtag:null,bytes,schemaVersion:1,contentType:'application/json',sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  assert.equal((await a.client.cloudSave.local.sync(slot)).state,'conflict');
  const pair=await a.client.cloudSave.local.compare(slot);assert.deepEqual(pair.cloud.data,{step:3});
  await a.client.cloudSave.local.resolve({...slot,choice:'local',token:pair.token,expectedEtag:pair.etag});
  assert.equal((await a.client.cloudSave.local.sync(slot)).state,'cloud');assert.equal(JSON.parse(Buffer.from(f.cloud().body)).step,1);
});
test('revocation blocks local fallback after the server reports it',async t=>{
  const f=await fixture(t),h=await f.open(),slot={slot:'autosave'},api=h.client.cloudSave.local;
  const v=await api.read(slot);await api.write({...slot,schemaVersion:1,data:{x:1},expectedEtag:v.etag,idempotencyKey:id()});
  f.revoke();await assert.rejects(api.sync(slot),{code:'BRIDGE_CLOSED'});
  await assert.rejects(api.read(slot),e=>['AUTH_REQUIRED','BRIDGE_CLOSED'].includes(e.code));
});

test('trusted management restores through the real host while destructive methods stay outside the iframe bridge',async t=>{
  const f=await fixture(t,{anonymous:true});let controller;
  const h=await f.open({onLocalSaveController:value=>controller=value}),local=h.client.cloudSave.local;
  const resource={namespace:'default',slot:'autosave'},empty=await local.read(resource);
  const first=await local.write({...resource,schemaVersion:1,data:{step:1},expectedEtag:empty.etag,idempotencyKey:id()});
  const exported=await controller.exportSave(resource);
  await local.write({...resource,schemaVersion:1,data:{step:2},expectedEtag:first.etag,idempotencyKey:id()});
  const plan=await controller.prepareRestore(exported,resource);await controller.restore(plan.token);
  assert.deepEqual((await local.read(resource)).data,{step:1});
  const copies=(await controller.list())[0].recoveries;assert.equal(copies.length,1);
  const copy=JSON.parse(await controller.exportSave(resource,copies[0].id));assert.deepEqual(JSON.parse(Buffer.from(copy.payload.body,'base64')),{step:2});
  for(const method of ['cloudSave.local.restore','cloudSave.local.removeRecovery','cloudSave.local.importAnonymous'])assert.equal((await h.raw(method,{})).error.code,'BRIDGE_METHOD_NOT_ALLOWED');
  await controller.removeRecovery(resource,copies[0]);assert.equal((await local.recoveries(resource)).length,0);
  const old=controller;h.close();assert.equal(controller,null);await assert.rejects(old.list(),{code:'BRIDGE_CLOSED'});
});
