const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const playwright=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('admin request admission and expanded stage details follow current server state',{skip:!playwright,timeout:90000},async t=>{
 const {build}=require('../browser-build.cjs'),{chromium}=require(playwright),Fastify=require('../../apps/api/node_modules/fastify');
 const app=Fastify({logger:false});let browser;const errors=[];
 t.after(async()=>{if(errors.length)t.diagnostic(JSON.stringify(errors));await browser?.close();await app.close();});
 const entry=`import React from'react';import{createRoot}from'react-dom/client';import AgentAdmin from'./packages/platform-client/src/AgentAdmin.jsx';
 window.__terminal=false;window.__plan=false;window.__timelineReads=0;window.__requests=0;
 const id='c98abda1-d115-4e05-9c2e-43f68119386a',runId='11111111-1111-4111-8111-111111111111';
 const run=()=>({id:runId,workflowKey:'blog.project.single',status:window.__terminal?'failed':'running',updatedAt:window.__terminal?'v2':'v1',stageCount:7,completedStageCount:1,actionCount:3,errorCode:window.__terminal?'FIXTURE_FAILURE':null,errorMessage:window.__terminal?'fixture failed':null,queuedAt:'2026-11-17T02:00:00Z'});
 const methods={
  listAdminAgents:async()=>({data:[{agentUserId:id,displayName:'小墨鱼',handle:'mooyu-researcher',status:'active',accountType:'agent',agentDisclosure:{operatorLabel:'由墨鱼工坊运营',badgeLabel:'AI 助手'},capabilities:['blog:auto-publish'],providerKey:{configured:false},automation:{enabled:false}}]}),
  getAdminAgentPublicationCutoverPreflight:async()=>({data:{owner:{activePublisher:'foundation',generation:2},blockers:[],legacyActiveRuns:0,foundationActiveRuns:0}}),
  getAdminAgentRuntimeOverview:async()=>({data:{acceptance:{readyForShadowScheduleReview:true,consecutivePasses:1,requiredConsecutivePasses:1,recent:[]},schedule:{enabled:window.__plan},publicOperations:{manualRun:{ready:true,blockers:[]},requestNow:{ready:window.__plan,blockers:window.__plan?[]:['AGENT_BLOG_PUBLIC_SCHEDULE_NOT_ENABLED']},activation:{ready:true},scheduler:{configured:true,workerLive:true,workerState:'idle',heartbeatAt:'2026-11-17T02:00:00Z',timezone:'Asia/Shanghai',localTime:'10:00',blockers:[]},limits:{monthlyProviderCalls:120,monthlyCostMicrousd:10000000,dailyPublicationRuns:1},observed:{providerCallsMonth:0,costMicrousdMonth:0,publicationRunsToday:0}}}}),
  listAdminAgentRuntimeRuns:async()=>({data:[run()]}),
  getAdminAgentRuntimeTimeline:async()=>{window.__timelineReads++;return {data:{run:run(),stages:[{id:'stage',ordinal:1,stageKey:'collect-evidence',status:window.__terminal?'failed':'running',attempt:1}],candidateGate:null}};},
  runAdminAgentFoundationNow:async()=>{window.__requests++;return {data:{queued:true}};},
 };
 const api=new Proxy(methods,{get:(object,key)=>object[key]??(async()=>{throw Error('该夹具未启用此能力');})});
 createRoot(document.getElementById('root')).render(<AgentAdmin api={api} go={()=>{}}/>);`;
 const bundle=await build({stdin:{contents:entry,resolveDir:path.resolve(__dirname,'../..'),loader:'jsx'},bundle:true,minify:true,write:false,platform:'browser',format:'iife',nodePaths:[path.resolve(__dirname,'../../packages/platform-client/node_modules')],logLevel:'silent'});
 app.get('/',async(_request,reply)=>reply.type('text/html').send('<!doctype html><html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script></html>'));
 app.get('/fixture.js',async(_request,reply)=>reply.type('text/javascript').send(bundle.outputFiles[0].text));
 await app.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({headless:true,args:process.platform==='win32'?['--disable-logging']:[]});
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
 await page.goto('http://127.0.0.1:'+app.server.address().port,{waitUntil:'domcontentloaded'});
 const immediate=page.getByRole('button',{name:'立即运行新基座',exact:true});await immediate.waitFor().catch(async error=>{t.diagnostic((await page.locator('body').innerText()).slice(0,1500));throw error;});
 assert.equal(await immediate.isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'启用每天 10 点',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'查看阶段',exact:true}).click();await page.locator('.agent-runtime-detail li.is-running').waitFor();
 await page.evaluate(()=>{window.__terminal=true;});
 await page.locator('.agent-runtime-history').getByRole('button',{name:'刷新',exact:true}).click();
 await page.locator('.agent-runtime-detail li.is-failed').waitFor();assert.equal(await page.locator('.agent-runtime-detail li.is-running').count(),0);
 assert.ok(await page.evaluate(()=>window.__timelineReads)>=2);
 await page.evaluate(()=>{window.__plan=true;});await page.getByRole('button',{name:'刷新状态',exact:true}).click();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='立即运行新基座')?.disabled);
 await immediate.click();assert.equal(await page.evaluate(()=>window.__requests),1);assert.deepEqual(errors,[]);
 await context.close();
});
