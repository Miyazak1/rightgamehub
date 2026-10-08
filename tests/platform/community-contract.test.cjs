const test=require('node:test');
const assert=require('node:assert/strict');
test('community content is bounded, ordered and never embeds active HTML or unsafe schemes',async()=>{
  const {normalizeContent}=await import('../../apps/api/src/community-contract.mjs');
  for(const url of ['javascript:alert(1)','http://example.com','https://127.0.0.1/a','https://localhost/a','https://user:pass@example.com/','https://example.com:8443/'])assert.throws(()=>normalizeContent({channel:'ai',title:'消息',blocks:[{type:'link',url}]}),{code:'SCHEMA_INVALID'});
  assert.throws(()=>normalizeContent({channel:'game',title:'发现',blocks:[{type:'html',html:'<script>evil</script>'}]}),{code:'SCHEMA_INVALID'});
  assert.throws(()=>normalizeContent({channel:'game',title:'发现',blocks:[{type:'paragraph',text:'字'.repeat(4001)}]}),{code:'SCHEMA_INVALID'});
  const body=normalizeContent({channel:'computing',title:' 消息 ',blocks:[{type:'paragraph',text:'<b>保留为文字</b>'},{type:'link',url:'https://example.com/article',label:'来源'}]});
  assert.equal(body.title,'消息');assert.equal(body.blocks[0].text,'<b>保留为文字</b>');assert.equal(body.blocks[1].type,'link');
});
test('production community flags default off and image execution stays isolated',async t=>{
  const {loadConfig}=await import('../../apps/api/src/config.mjs');
  const config=loadConfig({NODE_ENV:'production',DATABASE_URL:'postgresql://unused',OTP_HMAC_KEY:'test-only'.repeat(8),REALTIME_PUBLIC_URL:'wss://example.com/v1/realtime'});
  assert.equal(config.cloudSaveEnabled,false);
  assert.equal(config.community.enabled,false);assert.equal(config.community.postingEnabled,false);assert.equal(config.community.imagesEnabled,false);
  assert.equal(config.community.executionMode,'isolated');
  const {createRuntime}=await import('../../apps/api/src/runtime.mjs');
  const runtime=createRuntime({env:{NODE_ENV:'test',DATABASE_URL:'postgresql://unused',OTP_HMAC_KEY:'test-only'.repeat(8)},loadTrustedRules:false});
  t.after(()=>runtime.app.close());
  const capabilities=await runtime.app.inject('/v1/community/capabilities');
  assert.equal(capabilities.statusCode,200);
  assert.equal(capabilities.json().data.readEnabled,false);
  const upload=await runtime.app.inject({method:'POST',url:'/v1/community/posts',payload:{title:'disabled'}});
  assert.equal(upload.statusCode,503);
  assert.equal(upload.json().error.code,'COMMUNITY_DISABLED');
});
