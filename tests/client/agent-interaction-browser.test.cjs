const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),{randomUUID}=require('node:crypto');
const playwright=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('native Agent chat follows durable root and task receipts through reload without resubmission',{skip:!playwright,timeout:60000},async t=>{
 const {chromium}=require(playwright),{build}=require('../browser-build.cjs'),root=path.resolve(__dirname,'../..'),app=require('../../apps/api/node_modules/fastify')();let browser;
 t.after(async()=>{await browser?.close();await app.close();});
 const owner=randomUUID(),interaction=randomUUID(),task=randomUUID(),requests=[];let complete=false;
 app.get('/v1/me/assistant/capabilities',async()=>({data:{available:true,mode:'agent',agent:{displayName:'小墨鱼'}}}));
 app.post('/v1/me/assistant/messages',async r=>{requests.push(r.body);return {data:{reply:'正在处理',interaction:{id:interaction,state:'queued'}}};});
 app.get('/v1/me/agent/interactions/:id',async r=>({data:r.params.id===interaction?{id:interaction,state:'completed',reply:'已保存研究任务，可以继续对话。',task:{id:task,kind:'github-article',state:'running'}}:{id:task,state:complete?'completed':'running',reply:complete?'小墨鱼已保存草稿，请到后台查看。':'正在研究',progress:{completed:complete?6:2,total:6}}}));
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{PlatformAssistantProvider,AssistantWorkspace,AssistantToggle}from'./packages/platform-client/src/PlatformAssistant.jsx';import{I18nProvider}from'./packages/platform-client/src/I18n.jsx';import{createPracticeApiClient}from'./packages/platform-api-client/src/practice.mjs';const api=createPracticeApiClient({getAccessToken:()=> 'fixture'});createRoot(document.getElementById('root')).render(<I18nProvider><PlatformAssistantProvider api={api} owner='${owner}' capabilities={{host:'browser'}} route='/'><AssistantWorkspace><AssistantToggle/></AssistantWorkspace></PlatformAssistantProvider></I18nProvider>);`;
 const js=(await build({stdin:{contents:entry,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',nodePaths:[path.join(root,'packages/platform-client/node_modules')],logLevel:'silent'})).outputFiles[0].text;
 const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
 app.get('/',async(_r,reply)=>reply.type('text/html').send('<html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><body class="app" data-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>'));
 app.get('/fixture.js',async(_r,reply)=>reply.type('text/javascript').send(js));await app.listen({host:'127.0.0.1',port:0});
 browser=await chromium.launch({headless:true,channel:process.env.GAMEHUB_BROWSER_CHANNEL||'msedge'});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.server.address().port);await page.getByRole('button',{name:'墨鱼助手',exact:true}).last().click();await page.locator('#assistant-draft').fill('找一个项目写成草稿');await page.getByRole('button',{name:'发送 ↑',exact:true}).click();
 await page.getByText('已保存研究任务，可以继续对话。',{exact:true}).waitFor();await page.locator('.assistant-task').waitFor();assert.equal(requests.length,1);assert.match(requests[0].conversationId,/^[a-f0-9-]{36}$/i);
 assert.equal(await page.getByRole('button',{name:'发送 ↑',exact:true}).count(),1,'long task releases chat composer');
 await page.reload();await page.locator('.assistant-task').waitFor();assert.equal(requests.length,1);
 complete=true;await page.getByText('小墨鱼已保存草稿，请到后台查看。',{exact:true}).waitFor();assert.equal(requests.length,1);
 for(const width of [390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 const output=process.env.CODEX_BUILD_ROOT;if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,'agent-task.png'),fullPage:true});}
 assert.deepEqual(errors,[]);
});
