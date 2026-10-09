const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),playwrightPath=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;

test('live upload timeline: auto-publish, draft, restored results, processing, failures, demo parity and narrow layout',{skip:!playwrightPath,timeout:90000},async t=>{
  const {chromium}=require(playwrightPath),{build}=require('../../extensions/harness/node_modules/esbuild');
  const app=require('../../apps/api/node_modules/fastify')();let browser,page,sequence=0,latestJob;
  const jobs=new Map(),requests=[],workId='0d4748b7-2ac5-4a5c-847b-80505a21a7f1';
  const out=path.join(root,'.runtime/upload-status-acceptance');await fs.mkdir(out,{recursive:true});
  t.after(async()=>{if(page)await page.screenshot({path:path.join(out,'last.png'),fullPage:true});await browser?.close();await app.close();});
  app.addHook('onRequest',async req=>requests.push({method:req.method,url:req.url}));
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer'},(req,body,done)=>done(null,body));
  app.get('/v1/me',async()=>({data:{id:'creator',canPublish:true,role:'user',displayName:'测试创作者',avatar:{kind:'preset',presetKey:'cat'}}}));
  app.post('/v1/analytics/events',async()=>({data:{accepted:1}}));
  app.post('/v1/creator/works/:id/uploads',async req=>{
    const data={id:'job-'+(++sequence),workId:req.params.id,targetKey:req.body.targetKey,state:'created',publicationOutcome:'pending',declaredBytes:req.body.declaredBytes,actualBytes:null};
    assert.equal(req.body.autoPublish,true);latestJob=data.id;jobs.set(data.id,data);return {data};
  });
  app.post('/v1/creator/uploads/:id/grant',async()=>({data:{token:'local-fixture-grant'}}));
  app.put('/v1/creator/uploads/:id/content',async req=>{const data={...jobs.get(req.params.id),state:'uploaded',actualBytes:String(req.body.length)};jobs.set(data.id,data);return {data};});
  app.post('/v1/creator/uploads/:id/complete',async req=>{const data={...jobs.get(req.params.id),state:'queued'};jobs.set(data.id,{...data,state:'validating'});return {data};});
  app.get('/v1/creator/uploads/:id',async(req,reply)=>jobs.has(req.params.id)?{data:jobs.get(req.params.id)}:reply.code(404).send({error:{code:'NOT_FOUND'}}));
  const entry=[
    "import React from 'react';import{createRoot}from'react-dom/client';",
    'import App from '+JSON.stringify(path.join(root,'packages/platform-client/src/App.jsx').replaceAll('\\','/'))+';',
    'import{demoUploads}from'+JSON.stringify(path.join(root,'packages/platform-client/src/demo.mjs').replaceAll('\\','/'))+';',
    'import{createApiClient}from'+JSON.stringify(path.join(root,'packages/platform-api-client/src/index.mjs').replaceAll('\\','/'))+';',
    "const q=new URLSearchParams(location.search);const demo=q.has('demo');if(demo)Object.assign(demoUploads[0],{state:'succeeded',publicationOutcome:q.get('outcome')});const api=createApiClient({getAccessToken:()=> 'fixture'});createRoot(document.getElementById('root')).render(<React.StrictMode><App apiClient={api} demo={demo}/></React.StrictMode>);",
  ].join('\n');
  const bundle=await build({stdin:{contents:entry,loader:'jsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',nodePaths:[path.join(root,'packages/platform-client/node_modules')],loader:{'.png':'dataurl'},define:{'import.meta.env.DEV':'false'},logLevel:'silent'});
  const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
  app.get('/',async(req,reply)=>reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js',async(req,reply)=>reply.type('text/javascript').send(bundle.outputFiles[0].text));
  await app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+app.server.address().port,route='/#/creator/works/'+workId+'/upload';
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1365,height:1000}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const timeline=page.getByRole('complementary',{name:'上传处理进度'}),ready=timeline.locator('[data-upload-step=succeeded]'),published=timeline.locator('[data-upload-step=published]');
  const isPublished=async()=>{
    await timeline.getByRole('status').getByText('新版本已发布',{exact:true}).waitFor();
    assert.match(await published.getAttribute('class'),/is-done/);assert.match(await ready.getAttribute('class'),/is-done/);
    assert.equal(await ready.getAttribute('aria-current'),null);assert.equal(await ready.getByText('当前阶段',{exact:true}).count(),0);
    assert.equal(await timeline.locator('li.is-done').count(),8);assert.equal(await timeline.locator('li[aria-current]').count(),0);
    await page.locator('.upload-form').getByText('新版本已经发布。',{exact:true}).waitFor();
  };
  const isDraft=async(message)=>{
    await page.locator('.upload-form .processing-note p').filter({hasText:message}).waitFor();
    assert.equal(await ready.getAttribute('aria-current'),'step');assert.match(await ready.getAttribute('class'),/is-current/);
    assert.equal(await published.getAttribute('class'),'');assert.equal(await published.getByText('未发布',{exact:true}).isVisible(),true);
    assert.equal(await timeline.locator('li.is-done').count(),6);
  };
  const restore=async(state,publicationOutcome='pending',extra={})=>{
    const data={id:'restored-'+(++sequence),workId,state,publicationOutcome,targetKey:'web',actualBytes:'24',declaredBytes:'24',...extra};jobs.set(data.id,data);
    await page.evaluate(({workId,id})=>sessionStorage.setItem('gamehub-upload:'+workId,id),{workId,id:data.id});await page.reload();return data;
  };
  await page.goto(base+route);await page.locator('.upload-form input[type=file]').setInputFiles({name:'sample.zip',mimeType:'application/zip',buffer:Buffer.from('local fixture bytes')});
  await page.getByRole('button',{name:'开始上传',exact:true}).click();
  await timeline.getByRole('status').getByText('结构校验中',{exact:true}).waitFor();
  assert.equal(await timeline.locator('[data-upload-step=validating]').getAttribute('aria-current'),'step');assert.equal(await published.getAttribute('class'),'');
  jobs.set(latestJob,{...jobs.get(latestJob),state:'succeeded',publicationOutcome:'published'});await isPublished();
  assert.equal(await page.evaluate(workId=>sessionStorage.getItem('gamehub-upload:'+workId),workId),null);
  assert.ok(requests.some(req=>req.method==='PUT'&&req.url.endsWith('/content')));
  await page.screenshot({path:path.join(out,'live-published-desktop.png'),fullPage:true});
  await restore('succeeded','published',{targetKey:'windows-x64'});await isPublished();await page.getByRole('heading',{name:'上传 Windows 版本',exact:true}).waitFor();
  await restore('succeeded','draft');await isDraft(/保留为草稿，尚未发布/);
  await page.screenshot({path:path.join(out,'restored-draft-desktop.png'),fullPage:true});
  await restore('succeeded','skipped_newer_intent');await isDraft(/更新的发布操作.*未替换线上版本/);
  await restore('succeeded','blocked');await isDraft(/作品或目标平台已暂停.*未自动发布/);
  for(const [state,title] of [['queued','等待检查'],['scanning','安全检查中'],['review_required','等待人工审核'],['failed','处理失败'],['expired','上传已过期']]){
    await restore(state,'pending',{errorCode:state==='failed'?'ENTRY_MISSING':null});await timeline.getByRole('status').getByText(title,{exact:true}).waitFor();
    assert.equal(await published.getAttribute('class'),'');assert.equal(await ready.getAttribute('class'),'');
    if(['failed','expired','review_required'].includes(state))assert.equal(await timeline.locator('li[aria-current]').count(),0);
  }
  await restore('succeeded','published');await isPublished();
  for(const width of [360,320]){
    await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    for(const step of await timeline.locator('li strong').all())assert.equal(await step.isVisible(),true,'stage labels remain visible in the sidebar');
    await page.screenshot({path:path.join(out,'published-'+width+'.png'),fullPage:true});
  }
  // Switching works must not carry an earlier work's terminal result into the new upload form.
  await page.goto(base+'/#/creator/works/different-work/upload');await page.getByRole('button',{name:'开始上传',exact:true}).waitFor();
  assert.equal(await published.getAttribute('class'),'');assert.equal(await timeline.locator('li.is-done').count(),0);
  await page.goto(base+'/?demo=1&outcome=published'+route.slice(1));await isPublished();
  await page.goto(base+'/?demo=1&outcome=draft'+route.slice(1));await isDraft(/保留为草稿，尚未发布/);
  assert.deepEqual(errors,[]);
});
