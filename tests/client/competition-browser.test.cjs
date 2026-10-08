const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),playwright=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH,database=process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
for(const scenario of [
  {name:'2048',archive:'gamehub-2048-competition-v1.zip',title:'2048 高分榜',daily:false},
  {name:'editable third-party template',archive:'gamehub-competition-score-template.zip',title:'十次点击榜',daily:true},
])test(scenario.name+' uses SDK and authenticated host; generic detail board renders its declared metrics',{skip:!playwright||!database,timeout:150000},async t=>{
  const {createCompetitionFixture}=require('../competition-fixture.cjs');const fixture=await createCompetitionFixture(database);let app,browser;t.after(async()=>{await browser?.close();await app?.close();await fixture.close();});
  const published=await fixture.publish(await fs.readFile(path.join(root,'artifacts',scenario.archive)),scenario.name);
  const {createApp}=await import('../../apps/api/src/app.mjs');
  app=createApp({config:{requestBodyLimit:65536,corsOrigins:[]},competitionService:fixture.competition,gameSessionService:fixture.sessions,authService:{authenticateBearer:async()=>fixture.actor}});
  const {build}=require('../../extensions/harness/node_modules/esbuild'),{chromium}=require(playwright);
  const js=(await build({stdin:{contents:[
    "import React from 'react';import {createRoot} from 'react-dom/client';",
    'import WorkLeaderboard from '+JSON.stringify(path.join(root,'packages/platform-client/src/WorkLeaderboard.jsx').replaceAll('\\','/'))+';',
    'import {createApiClient} from '+JSON.stringify(path.join(root,'packages/platform-api-client/src/index.mjs').replaceAll('\\','/'))+';',
    'import {createWebGameHost} from '+JSON.stringify(path.join(root,'packages/platform-client/src/web-game-host.mjs').replaceAll('\\','/'))+';',
    'const workId='+JSON.stringify(published.workId)+',releaseId='+JSON.stringify(published.releaseId)+',accountProfile='+JSON.stringify({id:fixture.actor.userId})+';',
    "const api=createApiClient({getAccessToken:()=> 'fixture'}),frame=document.getElementById('game');",
    "createWebGameHost({frame,launchId:'fixture',descriptor:{workId,releaseId,runtimeOrigin:new URL(frame.src).origin,capabilities:{competition:true}},apiClient:api});",
    "createRoot(document.getElementById('root')).render(<React.StrictMode><WorkLeaderboard workId={workId} api={api} go={()=>{}} accountProfile={accountProfile} Avatar={()=> <span/>}/></React.StrictMode>);",
  ].join('\n'),loader:'jsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',nodePaths:[path.join(root,'packages/platform-client/node_modules')]})).outputFiles[0].text;
  const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
  const {createRuntimeEdgeApp}=await import('../../apps/api/src/runtime-edge-app.mjs');
  const {PostgresRuntimeEdgeRepository}=await import('../../apps/api/src/runtime-edge-repository.mjs');
  const runtime=createRuntimeEdgeApp({repository:new PostgresRuntimeEdgeRepository(fixture.pool),objectStore:fixture.runtimeStore,runtimeDomain:'games.test'});t.after(()=>runtime.close());
  app.get('/game/*',async(req,reply)=>{const result=await runtime.inject({url:'/'+req.params['*'],headers:{host:'r-'+published.releaseId.replaceAll('-','')+'.games.test'}});return reply.code(result.statusCode).headers(result.headers).send(result.rawPayload);});
  app.get('/fixture.js',async(req,reply)=>reply.type('text/javascript').send(js));
  let port;app.get('/',async(req,reply)=>reply.type('text/html').send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}iframe{display:block;width:100%;height:1000px;border:0}#root{max-width:960px;margin:auto;container-type:inline-size}</style><iframe id="game" sandbox="allow-scripts" src="http://localhost:${port}/game/index.html"></iframe><div id="root"></div><script src="/fixture.js"></script></html>`));
  await app.listen({host:'0.0.0.0',port:0});port=app.server.address().port;
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  await page.goto(`http://127.0.0.1:${port}/`);const game=page.frameLocator('#game'),board=page.locator('.work-leaderboard');
  await board.getByRole('heading',{name:scenario.title,exact:false}).waitFor();assert.equal(await board.getByLabel('榜单日期',{exact:true}).count(),scenario.daily?1:0);
  if(scenario.daily){
    await game.locator('#start').click();await game.getByText('开始点击！',{exact:true}).waitFor();
    for(let i=0;i<10;i++)await game.locator('#target').click();
    await game.locator('#submit').click();await game.getByText('已保存。退出游戏后可在详情页查看本游戏的榜单。',{exact:true}).waitFor();
    await board.getByRole('button',{name:'刷新榜单',exact:true}).click();await board.getByText('第 1 名',{exact:true}).waitFor();
    assert.equal(await board.locator('.work-leaderboard__column-labels').innerText(),'用时（毫秒）\n点击（次）');
    const saved=(await fixture.pool.query("SELECT metrics FROM competition_runs WHERE status='accepted'")).rows;
    assert.equal(saved.length,1);assert.equal(saved[0].metrics.clicks,10);assert.ok(saved[0].metrics.duration>0);
    assert.equal(Number(await board.locator('.work-leaderboard__scores b').first().innerText()),saved[0].metrics.duration);
    for(const width of [800,640,390,360]){await page.setViewportSize({width,height:900});assert.ok(await board.evaluate(node=>node.scrollWidth<=node.clientWidth),'two metric board must not overflow at '+width);}
    const screenshots=path.join(root,'.runtime/competition-preview');await fs.mkdir(screenshots,{recursive:true});await board.screenshot({path:path.join(screenshots,'third-party-board-narrow.png')});assert.deepEqual(errors,[]);return;
  }
  await game.getByRole('button',{name:'开始排行挑战',exact:true}).waitFor();
  const gameFrame=page.frames().find(frame=>frame.url().includes('/game/'));const stored=await gameFrame.evaluate(()=>window.fakeStorage.getItem('gameState'));
  assert.equal(await gameFrame.evaluate(()=>{try{localStorage.getItem('gameState');return false;}catch{return true;}}),true,'production sandbox must not expose iframe localStorage');
  await game.getByRole('button',{name:'开始排行挑战',exact:true}).click();await game.getByRole('status').filter({hasText:'排行挑战中'}).waitFor();
  await game.locator('.game-container').click();for(let i=0;i<32;i++)await page.keyboard.press(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'][i%4]);
  assert.equal(await gameFrame.evaluate(()=>window.fakeStorage.getItem('gameState')),stored);
  await game.getByRole('button',{name:'提交本局',exact:true}).click();await game.getByRole('status').filter({hasText:'成绩已保存'}).waitFor();
  await board.getByRole('button',{name:'刷新榜单',exact:true}).click();await board.getByText('第 1 名',{exact:true}).waitFor();
  assert.equal(await board.locator('.work-leaderboard__column-labels').innerText(),'得分（分）\n最大方块\n步数（步）');assert.equal(await board.locator('li').count(),1);
  const saved=(await fixture.pool.query("SELECT metrics,status FROM competition_runs WHERE status='accepted'")).rows;assert.equal(saved.length,1);assert.ok(saved[0].metrics.moves>0);
  assert.equal(Number(await board.locator('.work-leaderboard__scores b').first().innerText()),saved[0].metrics.score);
  await game.getByRole('button',{name:'返回自由模式',exact:true}).click();assert.equal(await gameFrame.evaluate(()=>window.fakeStorage.getItem('gameState')),stored);
  const screenshots=path.join(root,'.runtime/competition-preview');await fs.mkdir(screenshots,{recursive:true});await board.screenshot({path:path.join(screenshots,'2048-board.png')});
  for(const width of [800,640,390,360]){await page.setViewportSize({width,height:900});assert.ok(await board.evaluate(node=>node.scrollWidth<=node.clientWidth),'board must not overflow at '+width);}
  await board.screenshot({path:path.join(screenshots,'2048-board-narrow.png')});assert.deepEqual(errors,[]);
});
