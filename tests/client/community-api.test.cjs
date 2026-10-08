const test=require('node:test');
const assert=require('node:assert/strict');
const response=(data,status=200)=>new Response(JSON.stringify({data}),{status,headers:{'Content-Type':'application/json'}});
test('community refresh retains write receipt key, exact version and body',async()=>{
  const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');
  const calls=[];let token='expired';
  const api=createApiClient({getAccessToken:()=>token,getRefreshToken:()=> 'refresh',setTokens:()=>{token='new';},fetchImpl:async(url,options)=>{
    calls.push({url,...options});
    if(url==='/v1/auth/refresh')return response({accessToken:'new'});
    return options.headers.Authorization==='Bearer expired'?response(null,401):response({id:'same-post'});
  }});
  const body={channel:'game',title:'发现',blocks:[{type:'paragraph',text:'内容'}]};
  assert.equal((await api.communitySave('post',body,{version:'9',key:'stable-request-key'})).data.id,'same-post');
  const writes=calls.filter(call=>call.url!=='/v1/auth/refresh');
  assert.equal(writes.length,2);
  for(const call of writes){assert.equal(call.headers['Idempotency-Key'],'stable-request-key');assert.equal(call.headers['If-Match'],'"9"');assert.equal(call.body,JSON.stringify(body));assert.equal(call.method,'PATCH');}
});
test('community image download is authenticated, bounded and has no save terminology',async()=>{
  const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');
  let request;
  const api=createApiClient({getAccessToken:()=> 'private-session',fetchImpl:async(url,options)=>{request={url,...options};return new Response(new Uint8Array(10),{headers:{'Content-Type':'image/webp'}});}});
  const result=await api.communityImage('asset',{preview:true,variant:'thumb'});
  assert.equal(result.data.size,10);assert.equal(result.data.type,'image/webp');
  assert.match(request.url,/thumb\?preview=true$/);assert.equal(request.headers.Authorization,'Bearer private-session');
  const tooLarge=createApiClient({fetchImpl:async()=>new Response(new Uint8Array(163841),{headers:{'Content-Type':'image/webp'}})});
  await assert.rejects(tooLarge.communityImage('asset',{variant:'thumb'}),{code:'MEDIA_RESPONSE_INVALID'});
});
