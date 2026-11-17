const test=require('node:test'),assert=require('node:assert/strict');

test('analytics HTTP accepts the emitted blog route and preserves its category without accepting raw locations',async t=>{
 const {createApp}=await import('../../apps/api/src/app.mjs');
 const {createAnalyticsService}=await import('../../apps/api/src/analytics-service.mjs');
 const saved=[];
 const app=createApp({config:{requestBodyLimit:65536},database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},
  analyticsService:createAnalyticsService({repository:{insert:async events=>saved.push(...events)}})});
 t.after(()=>app.close());
 const event={type:'page_view',anonymousId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333',
  hostKind:'browser',route:'blog',occurredAt:new Date().toISOString()};
 for(const type of ['page_view','session_ping']){
  const response=await app.inject({method:'POST',url:'/v1/analytics/events',payload:{events:[{...event,type,...(type==='session_ping'?{durationMs:30000}:{})}]}});
  assert.equal(response.statusCode,202,response.body);assert.equal(saved.at(-1).route,'blog');
 }
 for(const route of ['/admin/agents?private=value','https://example.test/private','unregistered-category']){
  const response=await app.inject({method:'POST',url:'/v1/analytics/events',payload:{events:[{...event,route}]}});
  assert.equal(response.statusCode,400);assert.equal(response.json().error.code,'SCHEMA_INVALID');
 }
 assert.equal(saved.length,2);
});
