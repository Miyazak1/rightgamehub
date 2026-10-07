const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');

test('service approval is independent of manifest claims and schema scopes fail closed',async()=>{
  const {deriveGameSessionScope}=await import('../../apps/api/src/game-session-service.mjs');
  const declared={approved_capabilities:['multiplayer','cloudSave','competition'],namespaces:{default:{readSchema:{min:1,max:3},writeSchema:3}},mode_ids:[crypto.randomUUID()]};
  assert.deepEqual(deriveGameSessionScope(declared),{capabilities:['identity','multiplayer'],namespaces:{},modeIds:[]});
  assert.deepEqual(deriveGameSessionScope({...declared,scope_status:'active'}).capabilities,['identity','multiplayer','cloudSave','competition']);
  assert.deepEqual(deriveGameSessionScope({...declared,scope_status:'active',namespaces:{'../other':{},default:{readSchema:{min:3,max:1},writeSchema:1}},mode_ids:['bogus']}).capabilities,['identity','multiplayer']);
});
test('game sessions reject body scopes and resolve only authenticated actor and expected resource',async()=>{
  const {createGameSessionService}=await import('../../apps/api/src/game-session-service.mjs');
  const actor={userId:crypto.randomUUID(),grantId:crypto.randomUUID()};
  let stored; const repository={
    create:async input=>{stored=input;return {expiresAt:input.expiresAt,capabilities:['identity','cloudSave']};},
    resolve:async input=>input.userId===stored.userId&&input.grantId===stored.grantId&&input.tokenHash.equals(stored.tokenHash)&&input.now<stored.expiresAt?
      {...actor,workId:stored.workId,releaseId:stored.releaseId,channel:stored.channel,capabilities:['identity','cloudSave'],namespaces:{default:{}},modeIds:[],expiresAt:stored.expiresAt.toISOString()}:null,
    revoke:async()=>{},
  };
  let now=new Date();const service=createGameSessionService({cloudSaveEnabled:true,repository,clock:()=>now});
  const input={workId:crypto.randomUUID(),releaseId:crypto.randomUUID(),channel:'production',launchNonce:crypto.randomUUID()};
  await assert.rejects(service.create(actor,{...input,userId:actor.userId}),{code:'SCHEMA_INVALID'});
  const issued=await service.create(actor,input);
  assert.equal(issued.gameSessionId.length,43); assert.equal(stored.tokenHash.length,32);
  assert.notEqual(stored.tokenHash.toString(),issued.gameSessionId);
  const resolved=await service.resolve(actor,issued.gameSessionId,{workId:input.workId,namespace:'default',capability:'cloudSave'});
  assert.equal(resolved.channel,'production');
  for(const expected of [{workId:crypto.randomUUID()},{channel:'preview'},{capability:'competition'},{namespace:'__proto__'},{modeId:crypto.randomUUID()},{userId:actor.userId}]){
    await assert.rejects(service.resolve(actor,issued.gameSessionId,expected),{code:'GAME_SESSION_INVALID'});
  }
  await assert.rejects(service.resolve({...actor,grantId:crypto.randomUUID()},issued.gameSessionId),{code:'GAME_SESSION_INVALID'});
  now=new Date(now.getTime()+300000); await assert.rejects(service.resolve(actor,issued.gameSessionId),{code:'GAME_SESSION_INVALID'});
});
test('HTTP sessions require authentication, strict input and private response headers',async t=>{
  const {createApp}=await import('../../apps/api/src/app.mjs');
  const {AuthError}=await import('../../apps/api/src/auth-service.mjs');
  const {loadConfig}=await import('../../apps/api/src/config.mjs');
  const config=loadConfig({NODE_ENV:'test',DATABASE_URL:'postgres://unused/test',OTP_HMAC_KEY:'x'.repeat(32),CORS_ORIGINS:'https://gamehub.test'});
  const app=createApp({config,authService:{authenticateBearer:async header=>{if(header!=='Bearer host-only')throw new AuthError('AUTH_REQUIRED',401,'Sign in');return {userId:crypto.randomUUID()};}},
    gameSessionService:{create:async()=>({gameSessionId:'a'.repeat(43),expiresAt:new Date().toISOString(),capabilities:['identity']}),
      resolve:async()=>({expiresAt:new Date().toISOString(),capabilities:['identity']}),revoke:async()=>({revoked:true})}});
  t.after(()=>app.close());
  const body={workId:crypto.randomUUID(),releaseId:crypto.randomUUID(),channel:'production',launchNonce:crypto.randomUUID()};
  assert.equal((await app.inject({method:'POST',url:'/v1/game-sessions',payload:body})).statusCode,401);
  const headers={authorization:'Bearer host-only'};
  assert.equal((await app.inject({method:'POST',url:'/v1/game-sessions',headers,payload:{...body,approvedCapabilities:['cloudSave']}})).statusCode,400);
  const created=await app.inject({method:'POST',url:'/v1/game-sessions',headers,payload:body});
  assert.equal(created.statusCode,201);assert.equal(created.headers['cache-control'],'private, no-store');
  assert.equal((await app.inject({url:'/v1/game-sessions/current',headers})).statusCode,400);
  const status=await app.inject({url:'/v1/game-sessions/current',headers:{...headers,'x-gamehub-session':'a'.repeat(43)}});
  assert.equal(status.statusCode,200);assert.equal(status.json().data.active,true);assert.equal(status.json().data.gameSessionId,undefined);
  const cors=await app.inject({method:'OPTIONS',url:'/v1/game-sessions/current',headers:{origin:'https://gamehub.test'}});
  assert.match(cors.headers['access-control-allow-headers'],/X-GameHub-Session/u);
});
