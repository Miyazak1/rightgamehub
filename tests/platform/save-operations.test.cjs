const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');

test('save operations HTTP authenticates, rejects forged scopes/unknown fields, requires a reason and preserves request tracing',async t=>{
  const {createApp}=await import('../../apps/api/src/app.mjs');const {loadConfig}=await import('../../apps/api/src/config.mjs');const {AuthError}=await import('../../apps/api/src/auth-service.mjs');
  const actor={userId:crypto.randomUUID(),grantId:crypto.randomUUID()},workId=crypto.randomUUID();let calls=0;
  const app=createApp({config:loadConfig({NODE_ENV:'test',DATABASE_URL:'postgres://unused/test',OTP_HMAC_KEY:'x'.repeat(32)}),authService:{authenticateBearer:async h=>{if(h!=='Bearer test')throw new AuthError('AUTH_REQUIRED',401,'Sign in');return actor;}},saveOperationsService:{
    health:async(who,input)=>{assert.deepEqual(who,actor);assert.equal(input.admin,true);return {items:[],nextAfterWorkId:null,windowHours:24};},
    maintain:async(who,input)=>{calls++;assert.deepEqual(who,actor);assert.equal(input.workId,workId);assert.equal(input.requestId,'ops-trace');return {scopes:0,next:null};},
  }});t.after(()=>app.close());
  const base='/v1/admin/save-operations',headers={authorization:'Bearer test','x-request-id':'ops-trace'};
  assert.equal((await app.inject({url:base+'/health'})).statusCode,401);
  assert.equal((await app.inject({url:base+'/health?admin=false',headers})).statusCode,400);
  assert.equal((await app.inject({url:'/v1/creator/save-health?userId='+actor.userId,headers})).statusCode,400);
  const result=await app.inject({url:base+'/health',headers});assert.equal(result.statusCode,200);assert.equal(result.headers['cache-control'],'private, no-store');
  const request={method:'POST',url:base+'/works/'+workId+'/maintenance',headers,payload:{operationId:crypto.randomUUID(),reason:'Investigate usage mismatch',mode:'repair'}};
  for(const payload of [{...request.payload,reason:' '},{...request.payload,reason:'x'.repeat(1001)},{...request.payload,userId:actor.userId},{...request.payload,mode:'delete'},{...request.payload,after:{userId:actor.userId,channel:'production',slotId:'arbitrary'}},{...request.payload,operationId:'not-uuid'}])assert.equal((await app.inject({...request,payload})).statusCode,400);
  assert.equal(calls,0);assert.equal((await app.inject(request)).statusCode,200);assert.equal(calls,1);
});

test('health collector is bounded, stores aggregate buckets only and tolerates database failure without replay inflation',async()=>{
  const {createSaveHealthMetrics}=await import('../../apps/api/src/save-health-metrics.mjs');const queries=[];
  const pool={connect:async()=>({query:async q=>{queries.push(q);return {rows:[]};},release(){}})};const metrics=createSaveHealthMetrics({pool,maxKeys:2,clock:()=>new Date('2026-10-06T00:05:00Z')});
  const event={workId:crypto.randomUUID(),channel:'production',operation:'write',code:'OK',durationMs:34,userId:'must-not-be-retained',payload:'must-not-be-retained'};
  metrics.observe(event);metrics.observe(event);metrics.observe({...event,code:'SAVE_CONFLICT'});metrics.observe({...event,code:'SAVE_RATE_LIMITED'});
  assert.equal(metrics.status().bufferedKeys,2);assert.equal(metrics.status().dropped,1);await metrics.flush();
  const inserted=queries.find(q=>q.values);assert.equal(inserted.values.length,14);assert.equal(inserted.values[6],2);assert.equal(inserted.values[5],50);assert.ok(queries.includes("SET LOCAL lock_timeout='500ms'"));assert.doesNotMatch(JSON.stringify(queries),/must-not-be-retained/);await metrics.close();
  const failing=createSaveHealthMetrics({pool:{connect:async()=>{throw new Error('offline');}}});failing.observe(event);await failing.flush();assert.equal(failing.status().dropped,1);assert.equal(failing.status().bufferedKeys,0);await failing.close();
});

test('operations API client uses account auth, exact operation identifiers, and encoded pagination',async()=>{
  const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');const calls=[];
  const api=createApiClient({getAccessToken:()=> 'operator-token',fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:{ok:true}}),{status:200,headers:{'content-type':'application/json'}});}});
  const input={operationId:crypto.randomUUID(),expectedVersion:'3',writesPaused:true,reason:'Incident'};
  await api.pauseSavePolicy('policy-id',input);await api.pauseSavePolicy('policy-id',input);assert.equal(calls[0].options.body,calls[1].options.body);assert.equal(calls[0].options.headers.Authorization,'Bearer operator-token');assert.equal(calls[0].options.method,'PATCH');
  await api.getSaveHealth({admin:true,afterWorkId:'after/id'});assert.match(calls[2].url,/afterWorkId=after%2Fid$/);
  await api.maintainGameSaves('work-id',{operationId:input.operationId,reason:input.reason,mode:'inspect'});assert.equal(calls[3].options.method,'POST');
});
