import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createDesktopAccountSession} from '../../apps/desktop/src/account-session.mjs';
import {createDesktopBusinessApi} from '../../apps/desktop/renderer/business-api.mjs';
import {businessArguments} from '../../apps/desktop/src/business-contract.mjs';
import {createSelectedUploads} from '../../apps/desktop/src/selected-uploads.mjs';
import {createMemoryCredentialVault} from '../../apps/capability-executor/src/credential-vault.mjs';
import {createIsolatedAccountApi} from '../desktop/account-api-fixture.mjs';

export async function managementFixture(t){
 let admin=false;const calls=[],bodyRequests=[];
 const backend=await createIsolatedAccountApi({handleBusinessRequest:async(req,res,url,authenticate)=>{
  if(!/^\/v1\/(?:creator|admin|me\/blog)/.test(url.pathname))return false;
  const uploading=req.method==='PUT'&&url.pathname.endsWith('/content');
  if(uploading){if(req.headers.authorization!=='Upload selected-grant'){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'UPLOAD_GRANT_INVALID'}}));return true;}}
  else {const actor=await authenticate();assert.equal(actor.userId,'31e033b2-13d6-4b81-b214-21b3f25dca60');}
  calls.push({path:url.pathname,method:req.method,authorization:req.headers.authorization});
  if(url.pathname.startsWith('/v1/admin/')&&!admin){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'ADMIN_REQUIRED',message:'Admin required'}}));return true;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);if(bytes.length)bodyRequests.push({path:url.pathname,bytes,headers:req.headers});
  const data=url.pathname==='/v1/creator/works'?[{id:'work-one',title:'桌面实际作品',kind:'game',state:'draft',revision:1}]
   :url.pathname==='/v1/admin/reports'?[{id:'report-one',workTitle:'待审作品',status:'open'}]
   :url.pathname==='/v1/creator/analytics'?{totals:{starts:12}}
   :url.pathname.endsWith('/drafts')?[]:{status:'ready',id:'operation',revision:2};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data}));return true;
 }});t.after(()=>backend.close());
 const selected=createSelectedUploads();
 const opened=[];
 const session=await createDesktopAccountSession({apiOrigin:backend.origin,vault:createMemoryCredentialVault(),resolveSelectedFile:(...args)=>selected.resolve(...args),openExternal:async url=>opened.push(url)});
 const bridge={async call(method,args){try{return {ok:true,value:await session.call(method,args)};}catch(e){return {ok:false,error:{code:e.code,status:e.status,message:e.message}};}}};
 const api=createDesktopBusinessApi(bridge,backend.origin);
 const c=await session.call('createChallenge',[{email:'desktop-manager@example.test'}]);await session.call('verifyChallenge',[{challengeId:c.data.challengeId,code:backend.code()}]);
 return {api,session,backend,bridge,selected,calls,bodyRequests,opened,allowAdmin:()=>{admin=true;}};
}

test('desktop creator and governance methods use managed authentication and enforce server authorization',async t=>{
 const f=await managementFixture(t);
 assert.equal((await f.api.listCreatorWorks()).data[0].title,'桌面实际作品');
 assert.deepEqual((await f.api.listCreatorDrafts()).data,[]);
 assert.equal((await f.api.getCreatorAnalytics(30)).data.totals.starts,12);
 await f.api.updateWork('work-one',1,{title:'新标题',description:'用户编辑'});
 assert.equal(JSON.parse(f.bodyRequests.at(-1).bytes).title,'新标题');
 assert.equal(f.bodyRequests.at(-1).headers['if-match'],'"work-work-one-1"');
 await assert.rejects(f.api.listReports('open'),{status:403,code:'ADMIN_REQUIRED'});
 assert.equal((await f.session.call('state')).authenticated,true);
 f.allowAdmin();assert.equal((await f.api.listReports('open')).data[0].status,'open');
 await f.api.decideReport('report-one',{action:'dismiss',note:'已核实'});
 assert.equal(f.bodyRequests.at(-1).path,'/v1/admin/reports/report-one/decision');
 assert.ok(f.calls.every(c=>c.authorization.startsWith('Bearer ')));
 f.backend.expireAccess();await f.api.listCreatorWorks();assert.ok(f.backend.refreshCount>=1);
 await f.api.updateWork('work-one','12',{title:'字符串版本号'});assert.equal(f.bodyRequests.at(-1).headers['if-match'],'"work-work-one-12"');
 for(const method of ['fetch','uploadContentBytes','bootstrapSession','__proto__'])await assert.rejects(f.session.call('business',[{method,args:[]} ]));
 assert.throws(()=>businessArguments('getWorkSource',['../secret']));
 assert.throws(()=>businessArguments('updateWork',['work-one',1,JSON.parse('{"__proto__":{"admin":true}}')]));
 assert.throws(()=>businessArguments('updateWork',['work-one',1,{x:'a'.repeat(270000)}]));
 assert.equal((await f.api.startGitHubSourceInstall()).data.externalOpened,true);
 assert.deepEqual(f.opened,[f.backend.origin+'/creator/import']);
});

test('selected file capabilities are account-scoped, single-use and checked against file changes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-selected-upload-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const filename=path.join(root,'game.zip');await fs.writeFile(filename,'test archive');const selected=createSelectedUploads();
 const token=await selected.register(filename,'owner');assert.deepEqual(Object.keys(token),['desktopUploadId']);
 await assert.rejects(selected.resolve(token,'other','uploadContent'),{code:'DESKTOP_UPLOAD_SELECTION_REQUIRED'});
 const blob=await selected.resolve(token,'owner','uploadContent');assert.equal(await blob.text(),'test archive');
 await assert.rejects(selected.resolve(token,'owner','uploadContent'),{code:'DESKTOP_UPLOAD_SELECTION_REQUIRED'});
 const changed=await selected.register(filename,'owner');await fs.appendFile(filename,'changed');await assert.rejects(selected.resolve(changed,'owner','uploadContent'),{code:'DESKTOP_UPLOAD_FILE_CHANGED'});
});

test('desktop publishing uploads selected bytes without XHR or renderer-supplied paths; invalid grants do not log out',async t=>{
 const f=await managementFixture(t),root=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-publish-upload-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const filename=path.join(root,'game.zip'),bytes=Buffer.from('isolated game archive');await fs.writeFile(filename,bytes);
 const scope=(await f.session.call('state')).desktopSessionId;
 const api=createDesktopBusinessApi(f.bridge,f.backend.origin,{registerUpload:async()=>({ok:true,value:await f.selected.register(filename,scope)})});
 let progress=0;await api.uploadContent('upload-one',{size:bytes.length},'selected-grant',{onProgress:e=>{progress=e.percent;}});
 assert.equal(progress,100);assert.deepEqual(f.bodyRequests.at(-1).bytes,bytes);assert.equal(f.bodyRequests.at(-1).headers.authorization,'Upload selected-grant');
 await assert.rejects(api.uploadContent('upload-one',{size:bytes.length},'invalid-grant'),{status:401});
 assert.equal((await f.session.call('state')).authenticated,true);
 await assert.rejects(f.session.call('business',[{method:'uploadContent',args:['upload-one',{path:filename},'selected-grant']}]),{code:'DESKTOP_BUSINESS_INPUT_INVALID'});
});
