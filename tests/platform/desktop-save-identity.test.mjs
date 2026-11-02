import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createDesktopAccountAdapter } from '../../apps/desktop/renderer/account-adapter.mjs';
import { cacheScope, cacheKey } from '../../packages/save-cache/src/store-contract.mjs';
const user='a1000000-0000-4000-8000-000000000001';
const other='a1000000-0000-4000-8000-000000000002';
function fixture(){
  let state={authenticated:true,desktopSessionId:'session-1'},profile={id:user},changed;
  let reads=0,read=async()=>({data:profile});
  const bridge={onChanged(fn){changed=fn;return()=>{};},async call(method){
    if(method==='state')return {ok:true,value:{...state}};
    if(method==='getProfile'){reads++;return {ok:true,value:await read()};}
    throw Error('UNEXPECTED '+method);
  }};
  const adapter=createDesktopAccountAdapter(bridge);
  return {adapter,get reads(){return reads;},setRead(fn){read=fn;},change(next,p=profile){state=next;profile=p;changed({...state});}};
}
const scope=(origin,owner)=>({origin,owner,workId:'b1000000-0000-4000-8000-000000000001',channel:'production',namespace:'english',slot:'progress'});

test('desktop save owner uses server identity without credentials; repeated checks share one profile read',async()=>{
  const f=fixture();
  const tokens=await Promise.all(Array.from({length:8},()=>f.adapter.account.getTokens()));
  assert.equal(f.reads,1);
  assert.deepEqual(tokens[0],{desktopSessionId:'session-1',grantId:'session-1',profile:{id:user}});
  assert.equal(tokens[0].accessToken,undefined);assert.equal(tokens[0].refreshToken,undefined);
  assert.equal(cacheScope(scope('https://mooyu.fun','user:'+tokens[0].profile.id)).owner,'user:'+user);
  f.change({authenticated:false,desktopSessionId:null});assert.equal(await f.adapter.account.getTokens(),null);
  f.change({authenticated:true,desktopSessionId:'session-2'},{id:other});
  assert.equal((await f.adapter.account.getTokens()).profile.id,other);assert.equal(f.reads,2);
});

test('logout or same-user replacement during save-owner lookup fails closed',async()=>{
  for(const next of [{authenticated:false,desktopSessionId:null},{authenticated:true,desktopSessionId:'replacement'}]){
    const f=fixture();let release;
    f.setRead(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.adapter.account.getTokens();
    while(!release)await new Promise(resolve=>setImmediate(resolve));
    f.change(next);release({data:{id:user}});
    await assert.rejects(pending,{code:'DESKTOP_ACCOUNT_SESSION_CHANGED'});
  }
});

test('profile failures never silently select anonymous storage and can retry',async()=>{
  const f=fixture();f.setRead(async()=>{throw Object.assign(Error('offline'),{code:'NETWORK_ERROR'});});
  await assert.rejects(f.adapter.account.getTokens(),{code:'NETWORK_ERROR'});
  f.setRead(async()=>({data:{id:user}}));assert.equal((await f.adapter.account.getTokens()).profile.id,user);
  f.change({authenticated:true,desktopSessionId:'missing'});f.setRead(async()=>({data:{}}));
  await assert.rejects(f.adapter.account.getTokens(),{code:'AUTH_REQUIRED'});
});

test('desktop save scopes bind configured service, account, work and channel while rejecting UI origins',async()=>{
  const renderer=await fs.readFile(new URL('../../apps/desktop/renderer/main.jsx',import.meta.url),'utf8');
  assert.match(renderer,/saveOrigin: env\.accountApiOrigin \|\| env\.fixtureOrigin/);
  const base=scope('https://mooyu.fun','user:'+user),key=cacheKey(base);
  for(const patch of [{origin:'https://desktop-test.mooyu.fun'},{owner:'user:'+other},{owner:'anonymous:'+user},{workId:other},{channel:'preview'}])
    assert.notEqual(cacheKey({...base,...patch}),key);
  assert.equal(cacheScope(scope('http://127.0.0.1:1234','anonymous:'+user)).origin,'http://127.0.0.1:1234');
  for(const origin of ['null','mooyu-app://client','https://mooyu.fun/path','http://mooyu.fun'])
    assert.throws(()=>cacheScope({...base,origin}),{code:'SAVE_CACHE_SCOPE_INVALID'});
});

test('desktop account context drives real local-save SDK read/write and reopening without crossing users',async t=>{
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const {createSaveBridge}=require('../helpers/game-save-bridge.cjs');
  const {createSqliteSaveStore}=await import('../../packages/save-cache/src/sqlite-store.mjs');
  const {randomUUID}=await import('node:crypto');const path=await import('node:path');
  const root=await fs.mkdtemp(path.resolve('.runtime/desktop-save-'));
  const store=await createSqliteSaveStore({root}),bridges=[],f=fixture();
  t.after(async()=>{for(const b of bridges)b.close();await store.close();await fs.rm(root,{recursive:true,force:true});});
  const open=async()=>{
    const b=await createSaveBridge({api:{},descriptor:{workId:scope('', '').workId,releaseId:other,channel:'production',capabilities:{localSave:true,cloudSave:false}},
      identity:async()=>{const s=await f.adapter.account.getTokens();return s?JSON.stringify([s.profile.id,s.grantId]):null;},
      saveCache:store,saveOrigin:'https://mooyu.fun',getSaveOwner:async()=> 'user:'+(await f.adapter.account.getTokens()).profile.id});
    bridges.push(b);return b;
  };
  const a=await open(),resource={namespace:'english',slot:'progress'};
  const initial=await a.client.cloudSave.local.read(resource);assert.equal(initial.data,null);
  await a.client.cloudSave.local.write({...resource,schemaVersion:1,data:{lesson:3},expectedEtag:initial.etag,idempotencyKey:randomUUID()});a.close();
  const b=await open();assert.deepEqual((await b.client.cloudSave.local.read(resource)).data,{lesson:3});b.close();
  f.change({authenticated:true,desktopSessionId:'other-user'},{id:other});
  const c=await open();assert.equal((await c.client.cloudSave.local.read(resource)).data,null);c.close();
  f.change({authenticated:true,desktopSessionId:'original-user-again'},{id:user});
  const d=await open();assert.deepEqual((await d.client.cloudSave.local.read(resource)).data,{lesson:3});
});
