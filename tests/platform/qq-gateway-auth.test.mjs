import test from 'node:test';
import assert from 'node:assert/strict';
import {NapCatControl,NAPCAT_CREDENTIAL_REUSE_MS} from '../../apps/qq-channel/src/napcat-control.mjs';
test('parallel status polls reuse one gateway credential and rate limits cool down before another authentication',async()=>{
 let now=1000000,authCalls=0,statusCalls=0,limited=false;
 const control=new NapCatControl({token:'a'.repeat(64),accessToken:'test-access-token',now:()=>now,fetchImpl:async(url,options)=>{
  if(url.endsWith('/auth/login')){authCalls++;await new Promise(r=>setImmediate(r));return new Response(JSON.stringify(limited?{code:-1,message:'login rate limit'}:{code:0,data:{Credential:'ephemeral-test-credential'}}));}
  statusCalls++;assert.equal(options.headers.Authorization,'Bearer ephemeral-test-credential');return new Response(JSON.stringify({code:0,data:{isLogin:false,loginPhase:'offline'}}));
 }});
 await Promise.all(Array.from({length:10},()=>control.post('/QQLogin/CheckLoginStatus')));assert.equal(authCalls,1);assert.equal(statusCalls,10);
 limited=true;control.credential=null;await assert.rejects(control.post('/QQLogin/CheckLoginStatus'),{code:'QQ_GATEWAY_RATE_LIMITED'});
 for(let i=0;i<10;i++)await assert.rejects(control.post('/QQLogin/CheckLoginStatus'),{code:'QQ_GATEWAY_RATE_LIMITED'});assert.equal(authCalls,2);
 now+=60001;limited=false;await control.post('/QQLogin/CheckLoginStatus');assert.equal(authCalls,3);assert.equal(statusCalls,11);
});
test('reconnection during an awaited inspection never rewrites a now-live OneBot connection',async()=>{
 let connected=false,postCalls=0;
 const n=new NapCatControl({token:'a'.repeat(64),accessToken:'test'});
 n.inspect=async()=>{connected=true;return {accountMatches:true,groupReady:true};};n.post=async()=>{postCalls++;return {network:{websocketClients:[]}};};
 await n.maintain({},()=>connected);assert.equal(postCalls,0);
 connected=false;n.nextCheck=0;n.disconnectedAt=n.now()-16000;n.inspect=async()=>({available:true,accountMatches:true,groupReady:true});n.post=async path=>{postCalls++;assert.equal(path,'/OB11Config/GetConfig');connected=true;return {network:{websocketClients:[]}};};
 await n.maintain({},()=>connected);assert.equal(postCalls,1);
});
test('gateway restart-required and QR-not-ready outcomes remain explicit without discarding a valid credential',async()=>{
 let authCalls=0;
 const control=new NapCatControl({token:'a'.repeat(64),accessToken:'test',fetchImpl:async url=>{
  let value;if(url.endsWith('/auth/login')){authCalls++;value={code:0,data:{Credential:'test'}};}else if(url.endsWith('/CheckLoginStatus'))value={code:0,data:{isLogin:false,loginPhase:'reconnecting'}};else if(url.endsWith('/RefreshQRcode'))value={code:0,data:{restarting:true}};else value={code:-1,message:'QRCode Get Error'};
  return new Response(JSON.stringify(value));
 }});
 await assert.rejects(control.refresh(),{code:'QQ_GATEWAY_RESTART_REQUIRED'});
 await assert.rejects(control.qr(),{code:'QQ_QR_UNAVAILABLE'});await assert.rejects(control.qr(),{code:'QQ_QR_UNAVAILABLE'});assert.equal(authCalls,1);
});
test('a valid one-hour credential is reused beyond four minutes; only expiry renews it',async()=>{
 let now=1e6,authCalls=0;const n=new NapCatControl({token:'a'.repeat(64),accessToken:'test',now:()=>now,fetchImpl:async url=>{if(url.endsWith('/auth/login')){authCalls++;return Response.json({code:0,data:{Credential:'valid-'+authCalls}});}return Response.json({code:0,data:{isLogin:true}});}});
 await n.post('/QQLogin/CheckLoginStatus');now+=5*60000;await n.post('/QQLogin/CheckLoginStatus');assert.equal(authCalls,1);
 now+=NAPCAT_CREDENTIAL_REUSE_MS;await n.post('/QQLogin/CheckLoginStatus');assert.equal(authCalls,2);
});
test('core errors and network timeouts do not create a management authentication storm',async()=>{
 let authCalls=0,mode='ok';const n=new NapCatControl({token:'a'.repeat(64),accessToken:'test',fetchImpl:async url=>{if(url.endsWith('/auth/login')){authCalls++;return Response.json({code:0,data:{Credential:'valid'}});}if(mode==='network')throw Error('synthetic timeout');return Response.json(mode==='core'?{code:-1,message:'core temporarily unavailable'}:{code:0,data:{}});}});
 await n.post('/QQLogin/CheckLoginStatus');
 for(const error of ['core','network']){mode=error;for(let i=0;i<5;i++)await assert.rejects(n.post('/QQLogin/CheckLoginStatus'),{code:'QQ_GATEWAY_UNAVAILABLE'});}
 mode='ok';await n.post('/QQLogin/CheckLoginStatus');assert.equal(authCalls,1);assert.equal(n.credential,'valid');
});
test('actual Unauthorized invalidates the credential and respects bounded reauthentication backoff',async()=>{
 let now=1e6,authCalls=0,bad=false;const n=new NapCatControl({token:'a'.repeat(64),accessToken:'test',now:()=>now,fetchImpl:async url=>{if(url.endsWith('/auth/login')){authCalls++;return Response.json({code:0,data:{Credential:'valid'}});}return Response.json(bad?{code:-1,message:'Unauthorized'}:{code:0,data:{}});}});
 await n.post('/QQLogin/CheckLoginStatus');bad=true;await assert.rejects(n.post('/QQLogin/CheckLoginStatus'),{code:'QQ_GATEWAY_UNAVAILABLE'});assert.equal(n.credential,null);
 for(let i=0;i<3;i++)await assert.rejects(n.post('/QQLogin/CheckLoginStatus'));assert.equal(authCalls,1);
 now+=5001;bad=false;await n.post('/QQLogin/CheckLoginStatus');assert.equal(authCalls,2);
});
