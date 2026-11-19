import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApiClient} from '../../packages/platform-api-client/src/index.mjs';
import {createPracticeApiClient} from '../../packages/platform-api-client/src/practice.mjs';
import {DESKTOP_PARITY_INVENTORY} from '../../apps/desktop/src/parity-inventory.mjs';
import {PARITY_METHODS,businessPayloadSize} from '../../apps/desktop/src/parity-contract.mjs';
import {BUSINESS_METHODS,businessArguments} from '../../apps/desktop/src/business-contract.mjs';
import {ACCOUNT_API_METHODS,createDesktopAccountSession} from '../../apps/desktop/src/account-session.mjs';
import {createDesktopBusinessApi} from '../../apps/desktop/renderer/business-api.mjs';
import {createMemoryCredentialVault} from '../../apps/capability-executor/src/credential-vault.mjs';
import {createIsolatedAccountApi} from '../desktop/account-api-fixture.mjs';
import {boundedResponseStream} from '../../apps/desktop/src/response-stream.mjs';
const require=createRequire(import.meta.url),{externalUrl,downloadable}=require('../../apps/desktop/electron/platform-links.cjs');

test('every web API operation has an explicit desktop disposition and every enabled operation exists',()=>{
  const web={...createApiClient(),...createPracticeApiClient()};
  assert.deepEqual(Object.keys(DESKTOP_PARITY_INVENTORY).sort(),Object.keys(web).sort());
  for(const [name,mode]of Object.entries(DESKTOP_PARITY_INVENTORY)){
    assert.ok(['business','parity','account','internal','local','host','disabled'].includes(mode),name);
    if(['business','parity'].includes(mode))assert.ok(Object.hasOwn(BUSINESS_METHODS,name),name);
    if(mode==='account')assert.ok(ACCOUNT_API_METHODS.includes(name),name);
    if(mode==='disabled')assert.match(name,/Paper/u);
  }
});

async function fixture(t){
  const calls=[];let denied=false;
  const backend=await createIsolatedAccountApi({handleBusinessRequest:async(req,res,url,authenticate)=>{
    if(url.pathname.startsWith('/v1/auth/')||url.pathname==='/v1/me')return false;
    const chunks=[];for await(const part of req)chunks.push(part);
    calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:req.method,headers:req.headers,bytes:Buffer.concat(chunks)});
    if(!url.pathname.endsWith('/download')&&!url.pathname.endsWith('share-card.png'))await authenticate();
    if(denied){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'ADMIN_REQUIRED'}}));return true;}
    if(url.pathname.endsWith('/content')&&req.method==='GET'){
      res.writeHead(200,{'content-type':'application/octet-stream',etag:'"saved"'});res.end(Buffer.from([0,1,254,255]));return true;
    }
    if(url.pathname.endsWith('/package')&&req.method==='GET'||url.pathname.endsWith('/download')){
      res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="local.zip"'});res.end('PK-local-binary');return true;
    }
    if(url.pathname.endsWith('share-card.png')){res.writeHead(200,{'content-type':'image/png'});res.end(Buffer.from([137,80,78,71]));return true;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{items:[],received:true}}));return true;
  }});t.after(()=>backend.close());
  const session=await createDesktopAccountSession({apiOrigin:backend.origin,vault:createMemoryCredentialVault()});
  const bridge={async call(method,args){try{return {ok:true,value:structuredClone(await session.call(method,args))};}catch(error){return {ok:false,error:{code:error.code,status:error.status,message:error.message}};}}};
  const api=createDesktopBusinessApi(bridge,backend.origin);
  const challenge=await session.call('createChallenge',[{email:'parity@example.test'}]);
  await session.call('verifyChallenge',[{challengeId:challenge.data.challengeId,code:backend.code()}]);
  return {api,session,backend,calls,deny:()=>{denied=true;}};
}

test('community versions, keys and review options survive IPC without accepting transport overrides',async t=>{
  const f=await fixture(t);
  await f.api.communitySave(null,{title:'本地草稿'},{key:'draft-key'});
  await f.api.communitySave('post-one',{title:'修改'},{version:3,key:'draft-key'});
  assert.equal(JSON.parse(f.calls.at(-1).bytes).title,'修改');
  assert.equal(f.calls.at(-1).headers['if-match'],'"3"');
  await f.api.communityReview({cursor:'next-page'});assert.equal(f.calls.at(-1).query.cursor,'next-page');
  await assert.rejects(f.api.communityReview({headers:{Authorization:'injected'}}),{code:'DESKTOP_BUSINESS_INPUT_INVALID'});
  f.backend.expireAccess();await f.api.communityOverview();assert.equal(f.backend.refreshCount,1);
});

test('all added JSON operations reach their fixed web endpoint through the managed bridge',async t=>{
  const f=await fixture(t),skipped=new Set(['uploadAvatar','uploadMultiplayerRulePackage','communityImage','downloadAdminMultiplayerRulePackage','downloadAdminMultiplayerRuleBuild','readSaveLibraryRevision','joinMultiplayerRoom']);
  let count=0;
  for(const [name,spec]of Object.entries(PARITY_METHODS)){
    if(skipped.has(name)||spec.includes('save-scope')||spec.includes('file'))continue;
    const args=spec.map(kind=>{
      if(kind.endsWith('?'))return undefined;
      return ({id:'operation-one',text:'sample',number:10,revision:1,boolean:true,object:{},value:{},array:[],post:{id:'post-one',version:1},'community-options':{key:'operation-key'},'nullable-id':null,'image-bytes':new Uint8Array([0,1]),etag:'"saved"','save-input':{revisionId:'revision-one',expectedEtag:'"saved"',idempotencyKey:'restore-one'}})[kind];
    });
    const before=f.calls.length;
    try{await f.api[name](...args);}catch(error){throw new Error(name+': '+error.code,{cause:error});}
    assert.equal(f.calls.length,before+1,name);count++;
  }
  assert.ok(count>150);
});

test('Change Radar, social results, capability runs and analytics pass real typed payloads',async t=>{
  const f=await fixture(t);
  await f.api.createResearchTopic({title:'本地主题'});
  assert.equal(JSON.parse(f.calls.at(-1).bytes).title,'本地主题');
  await f.api.listResearchTopicDiscoveries('topic-one',{status:'candidate',limit:20});
  assert.equal(f.calls.at(-1).query.limit,'20');
  await f.api.listResearchTopicCandidateEvaluationPredictions('topic-one','dataset-one',{evaluationKey:'evaluation-one',limit:25});
  assert.equal(f.calls.at(-1).query.evaluationKey,'evaluation-one');assert.equal(f.calls.at(-1).query.limit,'25');
  await f.api.listContributionTasks('open',20,{offset:40,mine:true,projectId:'project-one'});
  assert.equal(f.calls.at(-1).query.offset,'40');assert.equal(f.calls.at(-1).query.projectId,'project-one');
  await f.api.getResearchTopicCandidateEvaluation('topic-one',null);
  await f.api.saveGuessBaikeResult({puzzleDate:'2026-11-16',score:1});
  await f.api.getGuessBaikeLeaderboard('2026-11-16','friends');assert.equal(f.calls.at(-1).query.scope,'friends');
  await f.api.getCapabilityHostSnapshot('agent-one',{host:'codex'});
  await f.api.trackAnalytics([{type:'page_view',page:'/learn'}]);
  assert.ok(f.calls.every(call=>call.headers.authorization?.startsWith('Bearer ')));
});

test('save-library bytes remain bytes across IPC and restore keeps concurrency conditions',async t=>{
  const f=await fixture(t);
  await f.api.listSaveLibrary();
  const result=await f.api.readSaveLibraryRevision('slot-one','revision-one','"saved"');
  assert.deepEqual(result.data,new Uint8Array([0,1,254,255]));assert.equal(result.etag,'"saved"');
  await f.api.restoreSaveLibraryRevision('slot-one',{revisionId:'revision-one',expectedEtag:'"saved"',idempotencyKey:'restore-one'});
  assert.equal(f.calls.at(-1).headers['if-match'],'"saved"');
  assert.equal(JSON.parse(f.calls.at(-1).bytes).revisionId,'revision-one');
  await assert.rejects(f.api.listGameSaves({workId:'unlaunched',namespace:'default',gameSessionId:'invented'}),{code:'DESKTOP_GAME_SESSION_DENIED'});
});

test('authenticated rule downloads refresh then reconstruct a usable Blob; authorization remains server-owned',async t=>{
  const f=await fixture(t);f.backend.expireAccess();
  const result=await f.api.downloadAdminMultiplayerRulePackage('submission-one');
  assert.ok(result.data instanceof Blob);assert.equal(await result.data.text(),'PK-local-binary');assert.equal(f.backend.refreshCount,1);
  f.deny();await assert.rejects(f.api.downloadAdminMultiplayerRuleBuild('build-one'),{status:403});
  assert.equal((await f.session.call('state')).authenticated,true);
});

test('share images and release download URLs are synchronous local URLs and release bodies stream',async t=>{
  const f=await fixture(t);
  for(const value of [f.api.workShareCardUrl('work-one',{download:true}),f.api.workXhsPromoUrl('work-one',1),f.api.discoveryCampaignShareCardUrl('campaign-one')]){
    assert.equal(typeof value,'string');assert.match(value,/^mooyu-app:\/\/client\/__desktop-media/u);
  }
  const local=f.api.releaseDownloadUrl('work-one','release-one');assert.match(local,/__desktop-file/u);
  const response=await f.session.resource(new URL(local).searchParams.get('path'));
  assert.equal(await response.text(),'PK-local-binary');assert.match(response.headers.get('content-disposition'),/^attachment/u);
  await assert.rejects(f.session.resource('https://example.test/file.zip'),{code:'DESKTOP_DOWNLOAD_DENIED'});
});

test('Paper stays disabled at both sides without network traffic',async t=>{
  const f=await fixture(t),count=f.calls.length;
  for(const name of Object.keys(DESKTOP_PARITY_INVENTORY).filter(name=>/Paper/u.test(name))){
    await assert.rejects(f.api[name](),{code:'PAPER_STUDY_DISABLED'});
    await assert.rejects(f.session.call('business',[{method:name,args:[]}]),{code:'PAPER_STUDY_DISABLED'});
  }
  assert.equal(f.calls.length,count);
});

test('typed payload budgets count binary bytes and refuse injected headers and cycles',()=>{
  const bytes=new Uint8Array(1048576);assert.ok(businessPayloadSize([bytes])<1049000);
  assert.equal(businessArguments('communityUpload',['media-one',new Uint8Array([0,255])])[1][1],255);
  assert.throws(()=>businessArguments('communityUpload',['media-one',new Uint8Array(2097153)]));
  assert.throws(()=>businessArguments('readSaveLibraryRevision',['s','r','bad\r\nAuthorization: x']));
  const cycle={};cycle.x=cycle;assert.throws(()=>businessPayloadSize(cycle));
});

test('download streams enforce byte limits and retire with their account scope',async()=>{
  await assert.rejects(new Response(boundedResponseStream(new Response('oversize'),{maxBytes:2})).text(),{code:'DESKTOP_DOWNLOAD_TOO_LARGE'});
  let retired=false;const response=new Response(boundedResponseStream(new Response('old-account'),{maxBytes:100,guard:()=>{if(retired)throw Error('retired');}}));
  retired=true;await assert.rejects(response.text(),/retired/u);
});

test('native links and downloads accept only fixed UI resources and HTTP links',()=>{
  assert.equal(externalUrl('https://github.com/test/repo/issues/new'),'https://github.com/test/repo/issues/new');
  for(const url of ['file:///C:/Windows/a.exe','javascript:alert(1)','https://user:password@example.test','https://example.test/\n'])assert.throws(()=>externalUrl(url));
  assert.equal(downloadable('blob:mooyu-app://client/id'),true);assert.equal(downloadable('mooyu-app://client/__desktop-file?path=x'),true);
  for(const url of ['blob:http://localhost/id','https://example.test/file','mooyu-app://client/index.html','file:///C:/x'])assert.equal(downloadable(url),false);
});
