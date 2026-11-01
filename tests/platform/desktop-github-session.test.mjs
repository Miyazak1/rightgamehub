import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAccountSession, validateGitHubAuthorizeUrl } from '../../apps/desktop/src/account-session.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { createIsolatedAccountApi } from '../desktop/account-api-fixture.mjs';
async function setup(t,extra={}) {
  const backend=await createIsolatedAccountApi();t.after(()=>backend.close());const vault=createMemoryCredentialVault(),opened=[];
  const session=await createDesktopAccountSession({apiOrigin:backend.origin,vault,openExternal:async url=>opened.push(url),...extra});
  const start=async()=> (await session.call('startGitHubWeb',[{}])).data;
  return {backend,vault,session,opened,start};
}
test('GitHub web login reuses state/PKCE, opens only minted URL, returns no bearer and restores',async t=>{
  const {backend,vault,session,opened,start}=await setup(t);const attempt=await start();
  await session.call('openGitHub',[attempt.authorizeUrl]);assert.deepEqual(opened,[attempt.authorizeUrl]);
  assert.equal((await session.call('pollGitHubWeb',[attempt.challengeId])).data.status,'pending');
  assert.equal((await backend.decide(attempt.authorizeUrl)).status,200);
  const result=await session.call('pollGitHubWeb',[attempt.challengeId]);
  assert.equal(result.data.status,'complete');assert.ok(result.data.tokens.desktopSessionId);assert.equal(result.data.tokens.accessToken,undefined);
  assert.equal(session.state().authenticated,false);await session.call('accept',[result.data.tokens]);
  assert.equal((await session.call('getProfile')).data.linkedAccounts[0].provider,'github');
  const restored=await createDesktopAccountSession({apiOrigin:backend.origin,vault});assert.equal((await restored.call('bootstrapSession')).data.authenticated,true);
  await session.call('logout');assert.equal((await createDesktopAccountSession({apiOrigin:backend.origin,vault})).state().authenticated,false);
});
test('provider denial and expired challenge never produce a desktop session',async t=>{
  const {backend,session,start}=await setup(t);let a=await start();await backend.decide(a.authorizeUrl,'deny');
  await assert.rejects(session.call('pollGitHubWeb',[a.challengeId]),{code:'GITHUB_ACCESS_DENIED'});assert.equal(session.state().authenticated,false);
  a=await start();backend.expireAccess();await assert.rejects(session.call('pollGitHubWeb',[a.challengeId]),{code:'GITHUB_CHALLENGE_INVALID'});
  await assert.rejects(session.call('openGitHub',[a.authorizeUrl]));
});
test('desktop cancellation and a newer attempt reject late callbacks and foreign polling',async t=>{
  const {backend,session,opened,start}=await setup(t);const old=await start();await session.call('cancelGitHub');await backend.decide(old.authorizeUrl);
  const count=backend.calls.length;await assert.rejects(session.call('pollGitHubWeb',[old.challengeId]));assert.equal(backend.calls.length,count);
  const next=await start();await assert.rejects(session.call('openGitHub',[old.authorizeUrl]));await assert.rejects(session.call('pollGitHubWeb',[old.challengeId]));
  await session.call('openGitHub',[next.authorizeUrl]);assert.deepEqual(opened,[next.authorizeUrl]);assert.equal(session.state().authenticated,false);
});
test('cancel during an in-flight poll discards the arriving grant and cannot persist login',async t=>{
  let release,started;const gate=new Promise(r=>release=r),requestStarted=new Promise(r=>started=r);
  const {backend,vault,session,start}=await setup(t,{fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(url.endsWith('/poll')){started();await gate;}return response;}});
  const a=await start();await backend.decide(a.authorizeUrl);
  const poll=session.call('pollGitHubWeb',[a.challengeId]);await requestStarted;const cancelled=session.call('cancelGitHub');release();
  await assert.rejects(poll,{code:'DESKTOP_GITHUB_CANCELLED'});await cancelled;assert.equal(session.state().authenticated,false);
  assert.ok(backend.calls.some(c=>c.path==='/v1/auth/device/logout'));
  assert.equal((await createDesktopAccountSession({apiOrigin:backend.origin,vault})).state().authenticated,false);
});
test('cancellation after poll but before shared finishLogin acceptance leaves no persistent session',async t=>{
  const {backend,vault,session,start}=await setup(t);const a=await start();await backend.decide(a.authorizeUrl);
  const result=await session.call('pollGitHubWeb',[a.challengeId]);assert.equal(session.state().authenticated,false);
  await session.call('cancelGitHub');await assert.rejects(session.call('accept',[result.data.tokens]));
  assert.equal((await createDesktopAccountSession({apiOrigin:backend.origin,vault})).state().authenticated,false);
  assert.ok(backend.calls.some(c=>c.path==='/v1/auth/device/logout'));
});
test('cancel while encrypted persistence is in flight clears the record before publishing sign-in',async t=>{
  const memory=createMemoryCredentialVault();let release,started;const gate=new Promise(r=>release=r),storing=new Promise(r=>started=r),events=[];
  const {backend,session,start}=await setup(t,{vault:{...memory,async store(key,value){started();await gate;return memory.store(key,value);}},onChanged:s=>events.push(s.authenticated)});
  const a=await start();await backend.decide(a.authorizeUrl);const result=await session.call('pollGitHubWeb',[a.challengeId]);
  const accept=session.call('accept',[result.data.tokens]);await storing;const cancel=session.call('cancelGitHub');release();
  await assert.rejects(accept,{code:'DESKTOP_GITHUB_CANCELLED'});await cancel;assert.equal(events.includes(true),false);
  assert.equal((await createDesktopAccountSession({apiOrigin:backend.origin,vault:memory})).state().authenticated,false);
});
test('system browser errors are recoverable and arbitrary schemes, hosts and modified links are rejected',async t=>{
  const {session,start}=await setup(t,{openExternal:async()=>{throw Error('system browser unavailable');}});const a=await start();
  await assert.rejects(session.call('openGitHub',[a.authorizeUrl]));await session.call('cancelGitHub');assert.equal(session.state().authenticated,false);
  for(const url of ['file:///C:/Windows/test','javascript:alert(1)','https://github.com.evil.test/login/oauth/authorize','https://github.com/login/device','http://127.0.0.1:9/__github/authorize'])
    assert.throws(()=>validateGitHubAuthorizeUrl(url,a.challengeId,'http://127.0.0.1:1'));
});
test('server state rejects callback tampering and replay while current challenge is single-use',async t=>{
  const {backend,session,start}=await setup(t);const a=await start(),bad=new URL(a.authorizeUrl);bad.searchParams.set('state',bad.searchParams.get('state')+'tampered');
  assert.equal((await backend.decide(bad.href)).status,401);assert.equal(session.state().authenticated,false);
  assert.equal((await backend.decide(a.authorizeUrl)).status,200);const replay=await backend.decide(a.authorizeUrl);assert.equal(replay.status,401);
  const html=await replay.text();assert.match(html,/已失效或已被使用/);assert.ok(replay.headers.get('content-type').startsWith('text/html'));
  assert.equal(html.includes(new URL(a.authorizeUrl).searchParams.get('state')),false);assert.match(html,/history.replaceState/);
  await session.call('pollGitHubWeb',[a.challengeId]);await assert.rejects(session.call('pollGitHubWeb',[a.challengeId]));
});
