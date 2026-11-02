import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { accountOrigin, desktopAccountLaunchOptions, prepareDesktopAccountProfile, isolatedAccountProfile } from '../../apps/desktop/src/account-configuration.mjs';
import { PRODUCTION_API_ORIGIN as origin, PRODUCTION_RUNTIME as runtime } from '../../apps/desktop/src/production-configuration.mjs';
import { localBusinessRuntime } from '../../apps/desktop/src/runtime-policy.mjs';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createDesktopBusinessApi } from '../../apps/desktop/renderer/business-api.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';

test('formal website config is explicit, pinned and cannot mix test servers, runtimes or profiles', async t=>{
  assert.equal(accountOrigin(origin,'production'),origin);
  for(const url of [null,'http://mooyu.fun','https://desktop-test.mooyu.fun','https://mooyu.fun.evil.test',origin+'/api',origin+'?x=1'])
    assert.throws(()=>accountOrigin(url,'production'));
  const base=path.resolve('.runtime/desktop-production-tests');await fs.mkdir(base,{recursive:true});
  const dir=await fs.mkdtemp(path.join(base,'profile-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const args=['--production-api',origin,'--profile-root',dir];
  const config=desktopAccountLaunchOptions(args,process.cwd());
  assert.equal(config.accountEnvironment,'production');assert.deepEqual(config.businessRuntime,runtime);
  assert.notEqual(config.profileRoot,isolatedAccountProfile(dir,'https://desktop-test.mooyu.fun'));
  await prepareDesktopAccountProfile(config.profileRoot,origin,'production');
  await prepareDesktopAccountProfile(config.profileRoot,origin,'production');
  await assert.rejects(prepareDesktopAccountProfile(config.profileRoot,'https://desktop-test.mooyu.fun','isolated-test'),{code:'DESKTOP_PROFILE_SERVER_MISMATCH'});
  await assert.rejects(prepareDesktopAccountProfile(config.profileRoot,null,'local-test'),{code:'DESKTOP_PROFILE_SERVER_MISMATCH'});
  for(const extra of [['--test-account-api','https://desktop-test.mooyu.fun'],['--test-runtime-origin','https://desktop-runtime-test.mooyu.fun']])
    assert.throws(()=>desktopAccountLaunchOptions([...args,...extra],process.cwd()));
  assert.throws(()=>localBusinessRuntime(runtime,origin));
  for(const patch of [{domain:'desktop-runtime-test.mooyu.fun'},{port:444},{scheme:'http'}])
    assert.throws(()=>localBusinessRuntime({...runtime,...patch},origin,'production'));
});

// All responses below are in-memory fixtures. No test uses the network fetch.
async function setup(overrides={}){
  const calls=[],vault=overrides.vault??createMemoryCredentialVault();
  const release='d7b00000-0000-4000-8000-000000000003';
  const runtimeOrigin='https://r-'+release.replaceAll('-','')+'.'+runtime.domain;
  const user={id:'existing-website-user',displayName:'Existing website account'};
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url);assert.equal(u.origin,origin);assert.equal(options.redirect,'error');calls.push(u.pathname);
    if(overrides.respond)return overrides.respond(u,options);
    if(u.pathname==='/ready')return Response.json({status:'ready',database:true,migrations:{ready:true}});
    if(u.pathname==='/v1/auth/github/web'){
      const id='d7b00000-0000-4000-8000-000000000009';
      const authorize=new URL('https://github.com/login/oauth/authorize');
      authorize.search=new URLSearchParams({state:id+'.fixture',code_challenge_method:'S256',code_challenge:'fixture',redirect_uri:origin+'/v1/auth/github/web/callback'});
      return Response.json({data:{challengeId:id,authorizeUrl:authorize.href,expiresAt:new Date(Date.now()+120000).toISOString(),intervalSeconds:2}});
    }
    if(u.pathname.endsWith('/poll'))return Response.json({data:{status:'complete',tokens:{accessToken:'fixture-access',refreshToken:'fixture-refresh'}}});
    if(['/v1/me','/v1/auth/session'].includes(u.pathname))return Response.json({data:u.pathname==='/v1/me'?user:{authenticated:true,profile:user}});
    if(u.pathname==='/v1/works')return Response.json({data:[{id:'server-work',title:'Server catalog'}]});
    if(u.pathname==='/v1/me/library')return Response.json({data:[{work:{id:'server-work'}}]});
    if(u.pathname.endsWith('/launch'))return Response.json({data:{apiVersion:1,workId:'server-work',releaseId:release,runtimeOrigin:runtimeOrigin+':443',entryUrl:runtimeOrigin+':443/index.html'}});
    if(u.pathname==='/v1/games/guess-baike/daily')return Response.json({data:{puzzle:{id:'server-daily'}}});
    if(u.pathname==='/v1/auth/device/logout')return Response.json({data:{revoked:true}});
    throw Error('UNEXPECTED_FIXTURE_REQUEST '+u.pathname);
  };
  const make=async()=>createDesktopAccountSession({apiOrigin:origin,environment:'production',businessRuntime:runtime,vault,fetchImpl});
  const session=await make();
  const api=createDesktopBusinessApi({async call(method,args){try{return {ok:true,value:await session.call(method,args)};}catch(e){return {ok:false,error:{code:e.code,status:e.status,message:e.message}};}}},origin);
  return {session,api,make,calls,user};
}

test('formal mode uses website OAuth callback, server user/catalog/library and exact production release descriptors; restores and logs out',async()=>{
  const {session,api,make,calls,user}=await setup();
  const start=(await session.call('startGitHubWeb',[{}])).data;
  assert.equal(new URL(start.authorizeUrl).searchParams.get('redirect_uri'),origin+'/v1/auth/github/web/callback');
  const grant=await session.call('pollGitHubWeb',[start.challengeId]);await session.call('accept',[grant.data.tokens]);
  assert.equal((await session.call('getProfile')).data.id,user.id);
  assert.equal((await api.listWorks()).data[0].id,'server-work');
  assert.equal((await api.listLibrary()).data[0].work.id,'server-work');
  assert.match((await api.getLaunch('server-work')).data.entryUrl,/\.runtime\.mooyu\.fun:443\/index.html$/);
  assert.equal((await api.getGuessBaikeDaily()).data.puzzle.id,'server-daily');
  const restored=await make();assert.equal((await restored.call('bootstrapSession')).data.profile.id,user.id);
  await restored.call('logout');assert.equal((await make()).state().authenticated,false);
  assert.equal(calls.includes('/ready-desktop-auth'),false);
});

test('formal readiness or catalog failures never substitute a local/test catalog',async()=>{
  for(const failure of ['test-instance','unready','catalog-error']){
    const {api,calls}=await setup({respond(u){
      if(u.pathname==='/ready')return Response.json({status:failure==='unready'?'starting':'ready',database:true,migrations:{ready:true},...(failure==='test-instance'?{instance:'isolated-business'}:{})});
      return Response.json({error:{code:'SERVER_UNAVAILABLE',message:'fixture error'}},{status:503});
    }});
    await assert.rejects(api.listWorks(),{code:failure==='catalog-error'?'SERVER_UNAVAILABLE':'DESKTOP_PRODUCTION_UNAVAILABLE'});
    assert.deepEqual(calls,failure==='catalog-error'?['/ready','/v1/works']:['/ready']);
  }
});

test('formal mode cannot start with TLS verification disabled',async()=>{
  const old=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
  try {
    await assert.rejects(createDesktopAccountSession({apiOrigin:origin,environment:'production',vault:createMemoryCredentialVault(),
      fetchImpl:async()=>{throw Error('NETWORK_MUST_NOT_RUN');}}),{code:'DESKTOP_ACCOUNT_TLS_REQUIRED'});
  } finally {
    if(old===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=old;
  }
});
