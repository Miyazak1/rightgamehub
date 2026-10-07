const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

test('save payload validation preserves bytes and bounds UTF-8, JSON shape and complexity',async()=>{
  const {validateSavePayload}=await import('../../apps/api/src/game-save-service.mjs');
  const valid=Buffer.from(' { "chapter": 2, "text": "进度" }\n');
  assert.equal(validateSavePayload(valid,'application/json',hash(valid)),hash(valid));
  for(const bytes of [Buffer.from('[]'),Buffer.from('null'),Buffer.from('{"x":1e999}'),Buffer.from('{"x":}'),Buffer.from([0x7b,0xff,0x7d]),Buffer.from('{"x":'.repeat(65)+'0'+'}'.repeat(65))])
    assert.throws(()=>validateSavePayload(bytes,'application/json',hash(bytes)),{code:'SAVE_CONTENT_INVALID'});
  assert.throws(()=>validateSavePayload(valid,'application/json','0'.repeat(64)),{code:'SAVE_CONTENT_INVALID'});
  const oversized=Buffer.alloc(1048577);
  assert.throws(()=>validateSavePayload(oversized,'application/octet-stream',hash(oversized)),{code:'SAVE_DOCUMENT_TOO_LARGE'});
  assert.equal(validateSavePayload(Buffer.alloc(0),'application/octet-stream',hash(Buffer.alloc(0))),hash(Buffer.alloc(0)));
});

test('save requests require exact CAS and bind the full request into idempotency',async()=>{
  const {createGameSaveService}=await import('../../apps/api/src/game-save-service.mjs');
  const seen=[],tx={};const service=createGameSaveService({
    repository:{transaction:fn=>fn(tx),mutate:async(_tx,_scope,input)=>{seen.push(input);return input;}},
    gameSessionService:{resolve:async(_actor,_token,expected,transaction)=>{assert.equal(transaction,tx);assert.equal(expected.capability,'cloudSave');return {};}},
  });
  const bytes=Buffer.from('{}');
  const base={workId:crypto.randomUUID(),namespace:'default',slotKey:'autosave',idempotencyKey:crypto.randomUUID(),schemaVersion:1,contentType:'application/json',bytes,sha256:hash(bytes)};
  for(const condition of [{},{ifMatch:'*'},{ifMatch:'W/"weak"'},{ifMatch:'"a", "b"'},{ifNoneMatch:'*',ifMatch:'"a"'},{ifNoneMatch:'bogus'}])
    await assert.rejects(service.write({},'token',{...base,...condition}),{code:'SAVE_PRECONDITION_REQUIRED'});
  await service.write({},'token',{...base,ifNoneMatch:'*'});
  await service.write({},'token',{...base,ifMatch:'"a"'});
  assert.notDeepEqual(seen[0].requestDigest,seen[1].requestDigest);
  await service.write({},'token',{...base,ifMatch:'"a"',schemaVersion:2});
  assert.notDeepEqual(seen[1].requestDigest,seen[2].requestDigest);
  await assert.rejects(service.write({},'token',{...base,ifNoneMatch:'*',namespace:'_gamehub.recovery'}),{code:'SCHEMA_INVALID'});
});

test('save HTTP boundary requires authentication, validates scope, preserves raw bytes and error details',async t=>{
  const {createApp}=await import('../../apps/api/src/app.mjs');
  const {AuthError}=await import('../../apps/api/src/auth-service.mjs');
  const {GameSaveError}=await import('../../apps/api/src/game-save-service.mjs');
  const {loadConfig}=await import('../../apps/api/src/config.mjs');
  const config=loadConfig({NODE_ENV:'test',CLOUD_SAVE_ENABLED:'true',DATABASE_URL:'postgres://unused/test',OTP_HMAC_KEY:'x'.repeat(32),CORS_ORIGINS:'https://gamehub.test'});
  const bytes=Buffer.from(' { "chapter" : 3 }\n'),etag='"example-etag"';let writes=0;
  const app=createApp({config,authService:{authenticateBearer:async h=>{if(h!=='Bearer host-only')throw new AuthError('AUTH_REQUIRED',401,'Sign in');return {userId:crypto.randomUUID()};}},
    gameSaveService:{
      write:async(_actor,_token,input)=>{writes++;assert.deepEqual(input.bytes,bytes);return {etag,revision:'1'};},
      delete:async()=>{throw new GameSaveError('SAVE_CONFLICT',412,'Conflict',{expectedEtag:etag,currentRevision:'2'});},
      content:async()=>({metadata:{etag,sha256:hash(bytes),schemaVersion:1,contentType:'application/json'},bytes}),
    }});
  t.after(()=>app.close());
  const base='/v1/me/game-saves/'+crypto.randomUUID()+'/slots/autosave';
  const url=base+'?namespace=default';
  const headers={authorization:'Bearer host-only','x-gamehub-session':'a'.repeat(43),'content-type':'application/json',
    'x-gamehub-save-schema':'1','x-content-sha256':hash(bytes),'if-none-match':'*','idempotency-key':crypto.randomUUID()};
  assert.equal((await app.inject({method:'PUT',url,headers:{...headers,authorization:''},payload:bytes})).statusCode,401);
  assert.equal((await app.inject({method:'PUT',url:url+'&userId=spoof',headers,payload:bytes})).statusCode,400);
  const saved=await app.inject({method:'PUT',url,headers,payload:bytes});
  assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.headers.etag,etag);assert.equal(writes,1);
  for(const [payload,extra,code] of [[Buffer.alloc(1048577),{},413],[bytes,{'content-encoding':'gzip'},422]]) {
    const response=await app.inject({method:'PUT',url,headers:{...headers,...extra},payload});
    assert.equal(response.statusCode,code,response.body);
  }
  assert.equal(writes,1);
  const read=await app.inject({url:base+'/content?namespace=default',headers:{authorization:headers.authorization,'x-gamehub-session':headers['x-gamehub-session']}});
  assert.deepEqual(read.rawPayload,bytes);assert.equal(read.headers['cache-control'],'private, no-store');
  assert.equal(read.headers['x-content-type-options'],'nosniff');assert.match(read.headers['content-disposition'],/attachment/);
  const conflict=await app.inject({method:'DELETE',url,headers:{authorization:headers.authorization,'x-gamehub-session':headers['x-gamehub-session']}});
  assert.equal(conflict.statusCode,412);assert.equal(conflict.json().error.details.expectedEtag,etag);
});

test('account save library HTTP boundary authenticates without game sessions and keeps downloads private',async t=>{
  const {createApp}=await import('../../apps/api/src/app.mjs');const {loadConfig}=await import('../../apps/api/src/config.mjs');const {AuthError}=await import('../../apps/api/src/auth-service.mjs');const {GameSaveError}=await import('../../apps/api/src/game-save-service.mjs');
  const actor={userId:crypto.randomUUID(),grantId:crypto.randomUUID()},slotId=crypto.randomUUID(),revisionId=crypto.randomUUID(),etag='"revision"',bytes=Buffer.from('{}');let restores=0;
  const app=createApp({config:loadConfig({NODE_ENV:'test',CLOUD_SAVE_ENABLED:'true',DATABASE_URL:'postgres://unused/test',OTP_HMAC_KEY:'x'.repeat(32)}),authService:{authenticateBearer:async h=>{if(h!=='Bearer account')throw new AuthError('AUTH_REQUIRED',401,'Sign in');return actor;}},saveLibraryService:{
    list:async who=>{assert.deepEqual(who,actor);return {items:[],nextAfterSlotId:null};},
    content:async(who,input)=>{assert.deepEqual(who,actor);assert.equal(input.slotId,slotId);assert.equal(input.revisionId,revisionId);return {metadata:{etag,sha256:hash(bytes),schemaVersion:1,contentType:'application/json'},bytes};},
    restore:async(_who,input)=>{restores++;assert.equal(input.idempotencyKey,'fixed-key');throw new GameSaveError('SAVE_CONFLICT',412,'Changed');},
  }});t.after(()=>app.close());
  assert.equal((await app.inject({url:'/v1/me/save-library'})).statusCode,401);
  const headers={authorization:'Bearer account'};assert.equal((await app.inject({url:'/v1/me/save-library',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/v1/me/save-library?userId='+actor.userId,headers})).statusCode,400);
  const result=await app.inject({url:'/v1/me/save-library/'+slotId+'/revisions/'+revisionId+'/content',headers});assert.equal(result.statusCode,200);assert.equal(result.body,'{}');assert.equal(result.headers['cache-control'],'private, no-store');assert.equal(result.headers['x-content-sha256'],hash(bytes));
  const restore={method:'POST',url:'/v1/me/save-library/'+slotId+'/restore',headers:{...headers,'idempotency-key':'fixed-key','if-match':etag},payload:{revisionId}};
  assert.equal((await app.inject({...restore,payload:{revisionId,userId:actor.userId}})).statusCode,400);assert.equal(restores,0);
  assert.equal((await app.inject(restore)).statusCode,412);assert.equal(restores,1);
});
