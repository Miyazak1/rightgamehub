const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),playwrightPath=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('discovery browser: complete catalog, remote search, private recent plays and narrow navigation',{skip:!playwrightPath,timeout:90000},async t=>{
  const {chromium}=require(playwrightPath),{build}=require('../../extensions/harness/node_modules/esbuild');
  const app=require('../../apps/api/node_modules/fastify')();let browser;
  t.after(async()=>{await browser?.close();await app.close();});
  const make=(id,title,extra={})=>({id,title,description:'休息时打开，体验一段小小的游戏时光。',kind:'game',creatorDisplayName:'玩家',tags:['益智'],estimatedMinutes:3,targets:[{targetKey:'web',currentReleaseId:'27c4a881-871a-4ae1-8201-ed0f4ecbe12a'}],...extra});
  let small=[make('gamehub-guess-baike','猜百科',{tags:['推理'],estimatedMinutes:5}),make('7359a350-cc0a-4a09-875d-cec9b5b8f93f','2048'),make('314fb01a-27da-4c28-947a-68b20176a6cf','OI 重开模拟器',{tags:['文字','模拟']}),make('1a13df55-8906-4b03-a19a-5e5a3b776649','迷阵'),make('f8537969-5f6b-41a8-8c43-f46a0f4a1293','桌猫'),make('a7a26e9f-4db8-4e6f-9d4d-7ae51b94bec6','宇宙巡航机',{targets:[{targetKey:'windows-x64',currentReleaseId:'27c4a881-871a-4ae1-8201-ed0f4ecbe12a'}]})];
  if(process.env.GAMEHUB_DISCOVERY_VISUAL_CATALOG){
    const {presentCatalogWork}=await import('../../apps/api/src/catalog-presentation.mjs');
    const report=JSON.parse(await fs.readFile(process.env.GAMEHUB_DISCOVERY_VISUAL_CATALOG,'utf8'));
    small=report.api[0].body.data.map(work=>presentCatalogWork({...work,coverUrl:work.coverUrl?'https://mooyu.fun'+work.coverUrl:null}));
  }
  const works=[...small,...Array.from({length:28},(_,i)=>make('more-'+i,i===27?'很远的画板':'额外作品 '+i,{kind:i===27?'tool':'game'}))];
  const requests=[];
  app.addHook('onRequest',async req=>requests.push({url:req.url,auth:req.headers.authorization}));
  let failedOnce=false;
  app.get('/v1/works',async(req,reply)=>{
    const {q='',kind,limit=20,offset=0}=req.query;
    if(q==='慢搜索')await new Promise(resolve=>setTimeout(resolve,700));
    if(q==='故障'&&!failedOnce){failedOnce=true;return reply.code(503).send({error:{code:'API_UNAVAILABLE',message:'测试网络故障'}});}
    return {data:(req.headers['x-small']==='true'?small:works).filter(work=>(!kind||work.kind===kind)&&[work.title,work.description].join(' ').includes(q)).slice(Number(offset),Number(offset)+Number(limit))};
  });
  app.get('/v1/me',async(req,reply)=>req.headers.authorization?{data:{id:req.headers.authorization.slice(7),displayName:'测试玩家',role:'user',avatar:{kind:'preset',presetKey:'cat'}}}:reply.code(401).send({error:{code:'AUTH_REQUIRED'}}));
  app.get('/v1/me/library',async req=>({data:req.headers.authorization==='Bearer a'?[{work:small[1],lastPlayedAt:'2026-10-08T06:00:00Z'},{work:small[0],lastPlayedAt:'2026-10-08T05:00:00Z'}]:[]}));
  app.get('/v1/community/posts',async(req,reply)=>req.headers['x-shares-off']==='true'?reply.code(503).send({error:{code:'COMMUNITY_DISABLED'}}):{data:{items:[{id:'published-post',channel:'ai',title:'一个值得试试的新发现',blocks:[{type:'paragraph',text:'最近看到的游戏与 AI 新点子，留在这里和大家一起看看。'}],author:{displayName:'像素观察员'},publishedAt:'2026-10-08T05:00:00Z'}]}});
  app.post('/v1/analytics/events',async()=>({data:{accepted:1}}));
  const bundled=await build({stdin:{contents:[
    "import React from 'react';import {createRoot} from 'react-dom/client';",
    'import App from '+JSON.stringify(path.join(root,'packages/platform-client/src/App.jsx').replaceAll('\\','/'))+';',
    'import {createApiClient} from '+JSON.stringify(path.join(root,'packages/platform-api-client/src/index.mjs').replaceAll('\\','/'))+';',
    "const query=new URLSearchParams(location.search);let user='';const root=createRoot(document.getElementById('root'));",
    "const api=createApiClient({getAccessToken:()=>user||null,fetchImpl:(url,options)=>fetch(url,{...options,headers:{...options.headers,'X-Small':String(query.has('small')),'X-Shares-Off':String(query.has('noShares'))}})});",
    "function render(){root.render(<React.StrictMode><App key={user} apiClient={api} demo={false}/></React.StrictMode>)};window.discoveryFixture={signIn(id){user=id;render()}};render();",
  ].join('\n'),loader:'jsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',nodePaths:[path.join(root,'packages/platform-client/node_modules')],loader:{'.png':'dataurl'},define:{'import.meta.env.DEV':'false'},logLevel:'silent'});
  const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
  app.get('/',async(req,reply)=>reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js',async(req,reply)=>reply.type('text/javascript').send(bundled.outputFiles[0].text));
  await app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+app.server.address().port;
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1365,height:1000}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('.discovery-catalog__grid .discovery-game').nth(23).waitFor();
  assert.equal(await page.locator('.discovery-picks [data-work-id="1a13df55-8906-4b03-a19a-5e5a3b776649"]').count(),0);
  assert.equal(await page.locator('.discovery-catalog [data-work-id="gamehub-guess-baike"]').count(),1);
  assert.equal(requests.some(req=>req.url.startsWith('/v1/me/library')),false);
  await page.getByRole('button',{name:'加载更多作品',exact:true}).click();await page.getByRole('heading',{name:'很远的画板',exact:true}).waitFor();
  assert.equal(await page.locator('.discovery-catalog__grid .discovery-game').count(),34);
  const search=page.getByRole('searchbox',{name:'找个想玩的'});
  await search.fill('很远的画板');await page.getByRole('heading',{name:'很远的画板',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.discovery-catalog__grid .discovery-game').length===1);
  assert.ok(requests.some(req=>decodeURIComponent(req.url).includes('q=很远的画板')));
  await search.fill('慢搜索');await page.waitForRequest(request=>decodeURIComponent(request.url()).includes('q=慢搜索'));
  await search.fill('2048');await page.getByRole('heading',{name:'2048',exact:true}).waitFor();
  await page.waitForTimeout(850);assert.equal(await page.locator('.discovery-catalog__grid .discovery-game').count(),1);
  await search.fill('没有这个作品');await page.getByRole('heading',{name:'没有找到匹配作品'}).waitFor();
  await search.fill('故障');await page.getByRole('heading',{name:'作品暂时没能加载'}).waitFor();
  await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.getByRole('heading',{name:'没有找到匹配作品'}).waitFor();
  await page.getByRole('button',{name:'查看全部作品',exact:true}).click();await page.locator('.discovery-catalog__grid .discovery-game').nth(23).waitFor();
  await page.evaluate(()=>window.discoveryFixture.signIn('a'));await page.getByRole('heading',{name:'最近玩过',exact:true}).waitFor();
  assert.ok(requests.some(req=>req.url.includes('/v1/me/library?limit=3&recent=true')&&req.auth==='Bearer a'));
  await page.evaluate(()=>window.discoveryFixture.signIn('b'));await page.getByRole('button',{name:'账号菜单',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'最近玩过',exact:true}).count(),0);
  await page.goto(base+'/?small=1');await page.locator('.discovery-catalog__grid .discovery-game').nth(5).waitFor();assert.equal(await page.getByRole('heading',{name:'最新分享',exact:true}).count(),0);assert.equal(await page.locator('.discovery-welcome__pixel').count(),0);assert.equal(requests.some(req=>req.url.startsWith('/v1/community/posts')),false);
  const shots=path.join(root,'.runtime/discovery-preview');await fs.mkdir(shots,{recursive:true});
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(shots,'desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'当前light主题，点击切换',exact:true}).click();
  await page.getByRole('button',{name:'当前high-contrast主题，点击切换',exact:true}).click();
  await page.getByRole('button',{name:'当前dark主题，点击切换',exact:true}).waitFor();
  await page.waitForTimeout(300); // Allow theme transitions and image repaint to settle.
  await page.screenshot({path:path.join(shots,'desktop-dark.png'),fullPage:true});
  await page.getByRole('button',{name:'当前dark主题，点击切换',exact:true}).click();
  for(const width of [390,360]){
    await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'narrow page must not overflow');
    const nav=page.getByRole('navigation',{name:'侧栏导航'});
    assert.equal(await nav.getByRole('button').count(),4);
    const tops=await nav.getByRole('button').evaluateAll(buttons=>buttons.map(button=>Math.round(button.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size,1,'all four navigation entries must stay on one row');
    await nav.getByRole('button',{name:'共建',exact:true}).waitFor();await page.locator('.header__tools').getByRole('button',{name:'＋ 添加到 Agent',exact:true}).waitFor();
    await page.getByRole('heading',{name:'休息一下？',exact:true}).click();
    await page.screenshot({path:path.join(shots,'narrow-'+width+'.png'),fullPage:true});
  }
  await page.goto(base+'/?small=1&noShares=1');await page.locator('.discovery-catalog__grid .discovery-game').nth(5).waitFor();
  assert.equal(await page.getByRole('heading',{name:'最新分享',exact:true}).count(),0);
  assert.equal(requests.some(req=>req.url.includes('/save-library')||req.url.includes('/game-saves')),false);
  assert.deepEqual(errors,[]);
});
