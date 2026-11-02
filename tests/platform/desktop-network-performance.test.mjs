import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopNetworkTransport } from '../../apps/desktop/src/network-transport.mjs';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
const origin='https://mooyu.fun';
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const make=fetchImpl=>createDesktopAccountSession({apiOrigin:origin,environment:'production',vault:createMemoryCredentialVault(),fetchImpl});
const ready=()=>Response.json({status:'ready',database:true,migrations:{ready:true}});
const business=(s,method='listWorks',requestId)=>s.call('business',[{method,args:[{}],...(requestId?{requestId}:{})}]);

test('Chromium transport caches only anonymous public images and never private/auth JSON or avatars',async()=>{
  const seen=[],transport=createDesktopNetworkTransport(origin,async(url,options)=>{seen.push({url,options});return Response.json({});});
  for(const [url,options,cache] of [
    ['/v1/works/work/cover?v=1',{},'default'],
    ['/v1/discovery/campaigns/public/share-card.png',{},'default'],
    ['/v1/me',{headers:{Authorization:'Bearer fixture',Cookie:'must-not-send'},cache:'force-cache'},'no-store'],
    ['/v1/auth/session',{method:'POST',body:'{}'},'no-store'],
    ['/v1/avatars/id',{},'no-store'],
    ['/v1/works/work/cover',{headers:{Authorization:'Bearer fixture'}},'no-store'],
    ['/v1/works',{},'no-store'],
  ]){
    await transport(origin+url,options);
    const entry=seen.at(-1).options;assert.equal(entry.cache,cache);assert.equal(entry.credentials,'omit');assert.equal(entry.redirect,'error');assert.equal(entry.headers.has('Cookie'),false);
  }
  assert.equal(seen[2].options.headers.get('Authorization'),'Bearer fixture');
  for(const url of ['https://evil.test/v1/me',origin+'/anything',origin.replace('://','://user@')+'/v1/me'])
    assert.throws(()=>transport(url),{code:'DESKTOP_ACCOUNT_ORIGIN_DENIED'});
});

test('parallel cold requests share one readiness check; failed checks remain retryable',async()=>{
  let checks=0,reads=0;const wait=gate();
  const s=await make(async u=>{if(new URL(u).pathname==='/ready'){checks++;await wait.promise;return ready();}reads++;return Response.json({data:[]});});
  const requests=['listWorks','listLibrary','listBlogArticles'].map(m=>business(s,m));
  await new Promise(r=>setTimeout(r,15));assert.equal(checks,1);assert.equal(reads,0);
  wait.resolve();await Promise.all(requests);assert.equal(reads,3);
  let attempts=0;
  const retry=await make(async u=>new URL(u).pathname==='/ready'?(++attempts===1?Response.json({status:'starting'}):ready()):Response.json({data:[]}));
  await assert.rejects(business(retry),{code:'DESKTOP_PRODUCTION_UNAVAILABLE'});
  await business(retry);assert.equal(attempts,2);
});

test('cancelling one waiter does not abort another page readiness; sign-out retires old waits',async()=>{
  const wait=gate();let readySignal,checks=0,reads=0;
  const s=await make(async(u,o)=>{if(new URL(u).pathname==='/ready'){checks++;readySignal=o.signal;await wait.promise;return ready();}reads++;return Response.json({data:[]});});
  const id='b0000000-0000-4000-8000-000000000001';
  const first=business(s,'listWorks',id);const rejected=assert.rejects(first,{code:'REQUEST_CANCELLED'});
  const second=business(s,'listBlogArticles');
  await new Promise(r=>setTimeout(r,15));await s.call('cancelBusiness',[id]);await rejected;
  assert.equal(readySignal.aborted,false);wait.resolve();await second;assert.equal(checks,1);assert.equal(reads,1);
  const oldWait=gate();let n=0;
  const retiring=await make(async u=>{if(new URL(u).pathname==='/ready'){n++;if(n===1)await oldWait.promise;return ready();}return Response.json({data:[]});});
  const old=business(retiring);const oldRejected=assert.rejects(old);
  await new Promise(r=>setTimeout(r,15));await retiring.call('clear');await oldRejected;
  await business(retiring);oldWait.resolve();assert.equal(n,2);
});

test('media streams before EOF, forwards cancellation, and preserves the eight MiB limit',async()=>{
  const tail=gate();let cancelled=false,step=0;
  const s=await createDesktopAccountSession({apiOrigin:'http://127.0.0.1:32123',vault:createMemoryCredentialVault(),fetchImpl:async()=>new Response(new ReadableStream({
    async pull(c){if(step++===0)c.enqueue(new Uint8Array([1,2]));else{await tail.promise;c.close();}},cancel(){cancelled=true;}
  }),{headers:{'Content-Type':'image/png'}})});
  const response=await s.media('/v1/works/id/cover');const reader=response.body.getReader();
  assert.deepEqual([...((await reader.read()).value)],[1,2]);await reader.cancel();assert.equal(cancelled,true);tail.resolve();
  const oversized=await createDesktopAccountSession({apiOrigin:'http://127.0.0.1:32123',vault:createMemoryCredentialVault(),fetchImpl:async()=>new Response(new Uint8Array(8*1024*1024+1),{headers:{'Content-Type':'image/png'}})});
  const tooBig=await oversized.media('/v1/works/id/cover');await assert.rejects(tooBig.arrayBuffer(),{code:'DESKTOP_MEDIA_TOO_LARGE'});
  const declared=await createDesktopAccountSession({apiOrigin:'http://127.0.0.1:32123',vault:createMemoryCredentialVault(),fetchImpl:async()=>new Response('x',{headers:{'Content-Type':'image/png','Content-Length':String(9*1024*1024)}})});
  await assert.rejects(declared.media('/v1/works/id/cover'),{code:'DESKTOP_MEDIA_TOO_LARGE'});
});

test('a cancelled media request stops waiting without cancelling shared readiness',async()=>{
  const wait=gate();let sharedSignal;
  const s=await make(async(u,o)=>{if(new URL(u).pathname==='/ready'){sharedSignal=o.signal;await wait.promise;return ready();}return Response.json({data:[]});});
  const controller=new AbortController();
  const image=s.media('/v1/works/id/cover',{signal:controller.signal});
  const rejected=assert.rejects(image,{name:'AbortError'});
  const page=business(s);
  await new Promise(r=>setTimeout(r,15));controller.abort();await rejected;
  assert.equal(sharedSignal.aborted,false);wait.resolve();await page;
});
