import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as id, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createApp } from '../../apps/api/src/app.mjs';
import { loadConfig } from '../../apps/api/src/config.mjs';
import { AuthError } from '../../apps/api/src/auth-service.mjs';
import { CompetitionError } from '../../apps/api/src/competition-service.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createDesktopBusinessApi } from '../../apps/desktop/renderer/business-api.mjs';
import { businessArguments } from '../../apps/desktop/src/business-contract.mjs';
import { createDesktopGameAuthority } from '../../apps/desktop/src/game-api-contract.mjs';
const {createSaveBridge}=createRequire(import.meta.url)('../helpers/game-save-bridge.cjs');
const work=id(),release=id(),board=id(),token='f'.repeat(43);
const launch={workId:work,releaseId:release,channel:'production',launchNonce:id()};
const descriptor={apiVersion:1,workId:work,releaseId:release,channel:'production',capabilities:{competition:true},runtimeOrigin:'http://r-'+release.replaceAll('-','')+'.localhost:49180',entryUrl:'http://r-'+release.replaceAll('-','')+'.localhost:49180/index.html'};

test('game bridge accepts bounded product fields and rejects scope/header injection and malformed replay payloads',()=>{
  assert.deepEqual(businessArguments('createGameSession',[launch]),[launch]);
  assert.deepEqual(businessArguments('finishCompetitionRun',[token,id(),{metrics:{score:12,'max-tile':8,moves:4}}])[2].metrics,{score:12,'max-tile':8,moves:4});
  for(const [method,args] of [
    ['createGameSession',[{...launch,userId:id()}]],['createGameSession',[{...launch,releaseId:'../me'}]],
    ['createGameSession',[{...launch,channel:'other'}]],['listCompetitionModes',['Bearer injected']],
    ['startCompetitionRun',[token,{boardId:board,requestId:id(),headers:{}}]],
    ['finishCompetitionRun',[token,id(),{metrics:{score:Infinity}}]],
    ['finishCompetitionRun',[token,id(),{metrics:{score:1,extra:1,a:1,b:1,c:1}}]],
    ['finishCompetitionRun',[token,id(),{evidence:{format:'custom-code',moves:'L'}}]],
    ['finishCompetitionRun',[token,id(),{evidence:{format:'tile-merge-v1',moves:'L'.repeat(8193)}}]],
    ['finishCompetitionRun',[token,id(),{url:'https://other.test'}]],
    ['moderateCompetitionRun',[id(),{}]],
  ])assert.throws(()=>businessArguments(method,args),{code:'DESKTOP_BUSINESS_INPUT_INVALID'});
});

test('game authority requires validated launch, approved capability, unexpired session and current account epoch',()=>{
  let now=Date.now();const a=createDesktopGameAuthority(()=>now),response={data:{gameSessionId:token,expiresAt:new Date(now+1000).toISOString(),capabilities:['identity','competition']}};
  assert.throws(()=>a.before('createGameSession',[launch]),{code:'DESKTOP_GAME_SESSION_DENIED'});
  a.launched(descriptor);a.before('createGameSession',[launch]);a.completed('createGameSession',[launch],response);
  a.before('listCompetitionModes',[token]);assert.throws(()=>a.before('getCompetitionRun',['x'.repeat(43),id()]));
  now+=1001;assert.throws(()=>a.before('listCompetitionModes',[token]));
  now-=1001;a.clear();assert.throws(()=>a.before('listCompetitionModes',[token]));assert.throws(()=>a.before('createGameSession',[launch]));
  a.launched({...descriptor,capabilities:{competition:false}});a.completed('createGameSession',[launch],response);
  assert.throws(()=>a.before('startCompetitionRun',[token,{boardId:board,requestId:id()}]));
  a.before('revokeGameSession',[token]);a.completed('revokeGameSession',[token],{});assert.throws(()=>a.before('getGameSession',[token]));
});

async function fixture(t){
  const actor={userId:id(),grantId:id()},runs=new Map(),requests=new Map(),calls=[];let issued=false,revoked=false,rejected=false;
  const requireSession=(a,s)=>{assert.equal(a.userId,actor.userId);assert.equal(s,token);if(!issued||revoked)throw Object.assign(Error('Invalid session'),{code:'GAME_SESSION_INVALID',statusCode:401});};
  const config=loadConfig({NODE_ENV:'test',DATABASE_URL:'postgres://unused/desktop_contract_only',OTP_HMAC_KEY:'x'.repeat(32),CORS_ORIGINS:''});
  const app=createApp({config,authService:{authenticateBearer:async header=>{if(header!=='Bearer host-fixture')throw new AuthError('AUTH_REQUIRED',401,'Sign in');return actor;}},
    catalogService:{launch:async()=>descriptor},
    gameSessionService:{async create(a,body){assert.equal(a.userId,actor.userId);assert.equal(body.releaseId,release);issued=true;return {gameSessionId:token,expiresAt:new Date(Date.now()+60000).toISOString(),capabilities:['identity','competition']};},
      async resolve(a,s){requireSession(a,s);return {expiresAt:new Date(Date.now()+60000).toISOString(),capabilities:['identity','competition']};},async revoke(a,s){requireSession(a,s);revoked=true;return {revoked:true};}},
    competitionService:{async modes(a,s){requireSession(a,s);return [{id:board,key:'fixture',title:'Local score'}];},
      async start(a,s,body){requireSession(a,s);if(!requests.has(body.requestId)){const r={id:id(),boardId:board,status:'issued',seed:17};requests.set(body.requestId,r);runs.set(r.id,r);}return requests.get(body.requestId);},
      async get(a,s,key){requireSession(a,s);return runs.get(key);},
      async finish(a,s,key,body){requireSession(a,s);if(rejected)throw new CompetitionError('COMPETITION_EVIDENCE_INVALID',422,'Evidence rejected');const r=runs.get(key);Object.assign(r,{status:'accepted',...body});return r;},
      async abandon(a,s,key){requireSession(a,s);runs.get(key).status='abandoned';return {abandoned:true};},
      async leaderboard(){return {entries:[...runs.values()].filter(r=>r.status==='accepted').map(r=>({metrics:r.metrics})),total:[...runs.values()].filter(r=>r.status==='accepted').length};},async boards(){return [{id:board}];},
    }});
  await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());const origin='http://127.0.0.1:'+app.server.address().port;
  const vault=createMemoryCredentialVault();await vault.store('desktop-shell-account:'+createHash('sha256').update(origin).digest('hex'),JSON.stringify({origin,tokens:{accessToken:'host-fixture',refreshToken:'refresh-fixture'}}));
  const session=await createDesktopAccountSession({apiOrigin:origin,vault,businessRuntime:{scheme:'http',domain:'localhost',port:49180},fetchImpl:async(url,options)=>{assert.equal(new URL(url).origin,origin);calls.push({path:new URL(url).pathname,headers:options.headers,body:options.body});return fetch(url,options);}});
  const api=createDesktopBusinessApi({async call(method,args){try{return {ok:true,value:await session.call(method,args)};}catch(e){return {ok:false,error:{code:e.code,status:e.status,message:e.message}};}}},origin);
  return {api,session,runs,calls,reject(value){rejected=value;}};
}

test('real SDK through desktop IPC facade and product HTTP routes lists, starts, finishes, reads and abandons local runs',async t=>{
  const f=await fixture(t);await f.api.getLaunch(work);
  const h=await createSaveBridge({api:f.api,descriptor});t.after(()=>h.close());
  assert.equal((await h.client.competition.listBoards())[0].id,board);
  const requestId=id(),first=await h.client.competition.start({boardId:board,requestId});
  assert.equal((await h.client.competition.start({boardId:board,requestId})).id,first.id);assert.equal(f.runs.size,1);
  const result=await h.client.competition.finish(first.id,{metrics:{score:24,'max-tile':8}});assert.equal(result.status,'accepted');
  assert.equal((await h.client.competition.get(first.id)).metrics.score,24);
  assert.equal((await h.client.competition.leaderboard(board)).entries[0].metrics.score,24);
  const next=await h.client.competition.start({boardId:board,requestId:id()});await h.client.competition.abandon(next.id);assert.equal(f.runs.get(next.id).status,'abandoned');
  assert.ok(f.calls.some(c=>c.path==='/v1/competition/modes'&&c.headers['X-GameHub-Session']===token));
  assert.equal(JSON.stringify(h.wire).includes('host-fixture'),false);assert.equal(JSON.stringify(h.wire).includes(token),false);
  await f.api.revokeGameSession(token);await assert.rejects(f.api.listCompetitionModes(token),{code:'DESKTOP_GAME_SESSION_DENIED'});
});

test('desktop preserves server rejection and clears game authority on logout; does not fabricate a score',async t=>{
  const f=await fixture(t);await f.api.getLaunch(work);await f.api.createGameSession(launch);
  const r=(await f.api.startCompetitionRun(token,{boardId:board,requestId:id()})).data;f.reject(true);
  await assert.rejects(f.api.finishCompetitionRun(token,r.id,{metrics:{score:1}}),{code:'COMPETITION_EVIDENCE_INVALID',status:422});assert.equal(f.runs.get(r.id).status,'issued');
  await f.session.call('clear');const count=f.calls.length;
  await assert.rejects(f.api.listCompetitionModes(token),{code:'DESKTOP_GAME_SESSION_DENIED'});
  await assert.rejects(f.api.createGameSession(launch),{code:'DESKTOP_GAME_SESSION_DENIED'});assert.equal(f.calls.length,count);
});

test('a late game-session creation cannot restore authority after the desktop account is cleared',async()=>{
  const origin='http://127.0.0.1:49179',vault=createMemoryCredentialVault();
  await vault.store('desktop-shell-account:'+createHash('sha256').update(origin).digest('hex'),JSON.stringify({origin,tokens:{accessToken:'fixture',refreshToken:'fixture'}}));
  let releaseResponse,requested=false;
  const session=await createDesktopAccountSession({apiOrigin:origin,vault,businessRuntime:{scheme:'http',domain:'localhost',port:49180},fetchImpl:async url=>{
    if(new URL(url).pathname.endsWith('/launch'))return Response.json({data:descriptor});
    requested=true;return new Promise(resolve=>{releaseResponse=()=>resolve(Response.json({data:{gameSessionId:token,capabilities:['competition'],expiresAt:new Date(Date.now()+60000).toISOString()}}));});
  }});
  const call=(method,args)=>session.call('business',[{method,args}]);await call('getLaunch',[work]);
  const pending=call('createGameSession',[launch]);const rejected=assert.rejects(pending);
  while(!requested)await new Promise(resolve=>setImmediate(resolve));
  await session.call('clear');releaseResponse();await rejected;
  await assert.rejects(call('listCompetitionModes',[token]),{code:'DESKTOP_GAME_SESSION_DENIED'});
});
