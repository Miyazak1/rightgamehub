const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),playwrightPath=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('work detail leaderboard: public, own rank, pagination, dates, narrow layout and saved result navigation',{skip:!playwrightPath,timeout:90000},async t=>{
  const {chromium}=require(playwrightPath),{build}=require('../../extensions/harness/node_modules/esbuild');
  const {guessBaikeWork}=await import('../../apps/api/src/built-in-works.mjs');
  const app=require('../../apps/api/node_modules/fastify')();let browser,releaseSave;
  t.after(async()=>{releaseSave?.();await browser?.close();await app.close();});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const avatar={kind:'preset',presetKey:'cat',url:null,staticUrl:null,mediaType:null,animated:false};
  const requests=[],saved=[];let failBoard=false,failPage=false,slow=false,failSave=true;
  app.addHook('onRequest',async req=>requests.push({url:req.url,auth:req.headers.authorization}));
  app.get('/v1/me',async(req,reply)=>req.headers.authorization?{data:{id:req.headers.authorization.slice(7),displayName:'我的玩家',role:'user',avatar}}:reply.code(401).send({error:{code:'AUTH_REQUIRED'}}));
  app.get('/v1/works/:workId',async req=>({data:req.params.workId==='gamehub-guess-baike'?guessBaikeWork:{...guessBaikeWork,id:req.params.workId,title:'未接入榜单的游戏',targets:[{targetKey:'web',currentReleaseId:'release'}]}}));
  app.get('/v1/me/library/:workId',async()=>({data:{savedAt:null}}));
  app.get('/v1/works/:workId/leaderboard',async(req,reply)=>{
    const {date=today,limit=10,offset=0}=req.query;
    if(slow&&date===yesterday)await new Promise(resolve=>setTimeout(resolve,650));
    if(failBoard||failPage&&Number(offset)>0){failBoard=false;failPage=false;return reply.code(503).send({error:{code:'UNAVAILABLE'}});}
    const rows=Array.from({length:65},(_,i)=>({rank:i+1,player:{id:i===60?'owner':'player-'+i,displayName:(date===yesterday?'历史玩家 ':'像素玩家 ')+(i+1),isMe:i===60&&req.headers.authorization==='Bearer owner',avatar},scores:{hints:Math.floor(i/25),guessedCount:8+i,elapsedSeconds:38+i*5},completedAt:today+'T04:00:00Z'}));
    const empty=req.query.puzzleId==='empty';
    return {data:{workId:req.params.workId,boardId:'daily',title:'每日挑战榜',date,timeZone:'Asia/Shanghai',puzzleId:req.query.puzzleId||'fixture-puzzle',verification:'client_reported',metrics:[{key:'hints',label:'提示',unit:'次',direction:'asc'},{key:'guessedCount',label:'猜字',unit:'个',direction:'asc'},{key:'elapsedSeconds',label:'用时',unit:'秒',direction:'asc'}],total:empty?0:65,offset:Number(offset),limit:Number(limit),entries:empty?[]:rows.slice(Number(offset),Number(offset)+Number(limit)),myEntry:!empty&&req.headers.authorization==='Bearer owner'?rows[60]:null,hasMore:!empty&&Number(offset)+Number(limit)<65}};
  });
  const puzzle={id:'fixture-puzzle',title:'测试',aliases:[],category:'排行榜测试',content:'用于检查成绩保存与榜单跳转。',sourceUrl:'https://zh.wikipedia.org/wiki/测试'};
  app.get('/v1/games/guess-baike/daily',async()=>({data:{date:yesterday,puzzle}}));
  app.post('/v1/games/guess-baike/results',async(req,reply)=>{
    saved.push(req.body);await new Promise(resolve=>setTimeout(resolve,150));
    if(failSave){failSave=false;return reply.code(503).send({error:{code:'TEMPORARY'}});}await new Promise(resolve=>{releaseSave=resolve;});return {data:{saved:true}};
  });
  app.post('/v1/me/library/:workId/play',async()=>({data:{}}));
  app.post('/v1/analytics/events',async()=>({data:{accepted:1}}));
  app.get('/v1/community/capabilities',async()=>({data:{readEnabled:true,postingEnabled:true,canShare:false,isAdmin:false,channels:[{key:'game',name:'游戏'}],limits:{},reason:'AUTH_REQUIRED'}}));
  app.get('/v1/community/posts',async()=>({data:{items:[],nextCursor:null}}));
  const bundle=await build({stdin:{contents:[
    "import React from 'react';import {createRoot} from 'react-dom/client';",
    'import App from '+JSON.stringify(path.join(root,'packages/platform-client/src/App.jsx').replaceAll('\\','/'))+';',
    'import {createApiClient} from '+JSON.stringify(path.join(root,'packages/platform-api-client/src/index.mjs').replaceAll('\\','/'))+';',
    "let user='';const root=createRoot(document.getElementById('root'));const api=createApiClient({getAccessToken:()=>user||null});function render(){root.render(<React.StrictMode><App key={user} apiClient={api} demo={false}/></React.StrictMode>)}window.boardFixture={signIn(id){user=id;render()}};render();",
  ].join('\n'),loader:'jsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',nodePaths:[path.join(root,'packages/platform-client/node_modules')],loader:{'.png':'dataurl'},define:{'import.meta.env.DEV':'false'},logLevel:'silent'});
  const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
  app.get('/',async(req,reply)=>reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js',async(req,reply)=>reply.type('text/javascript').send(bundle.outputFiles[0].text));
  await app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+app.server.address().port;
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1365,height:1000}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#/works/gamehub-guess-baike');const board=page.locator('.work-leaderboard');
  await board.getByText('登录后记录你的成绩',{exact:true}).waitFor();assert.equal(await board.locator('li').count(),10);
  const layout=await page.evaluate(()=>({board:document.querySelector('.work-leaderboard').getBoundingClientRect().top,about:document.querySelector('.detail-columns').getBoundingClientRect().bottom}));assert.ok(layout.board>=layout.about);
  await page.evaluate(()=>window.boardFixture.signIn('owner'));await board.getByText('第 61 名',{exact:true}).waitFor();
  await board.getByRole('button',{name:'展开完整榜单',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.work-leaderboard__list>li').length===50);
  failPage=true;await board.getByRole('button',{name:'加载更多名次',exact:true}).click();await board.getByText('后续名次暂时没能加载，请重试。',{exact:true}).waitFor();
  await board.getByRole('button',{name:'重试加载',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.work-leaderboard__list>li').length===65);
  assert.equal(await board.locator('li.is-me').count(),1);await board.getByRole('button',{name:'收起为前 10 名',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.work-leaderboard__list>li').length===10);
  slow=true;await board.getByLabel('榜单日期',{exact:true}).fill(yesterday);await page.waitForRequest(r=>r.url().includes('date='+yesterday));
  await board.getByRole('button',{name:'回到今天',exact:true}).click();await board.getByText('像素玩家 1',{exact:true}).waitFor();await page.waitForTimeout(750);assert.equal(await board.getByText('历史玩家 1',{exact:true}).count(),0);slow=false;
  failBoard=true;await board.getByRole('button',{name:'刷新榜单',exact:true}).click();await board.getByRole('button',{name:'重试排行榜'}).waitFor();assert.equal(await page.getByRole('button',{name:'立即游玩',exact:false}).isEnabled(),true);
  await board.getByRole('button',{name:'重试排行榜'}).click();await board.getByText('第 61 名',{exact:true}).waitFor();
  const shots=path.join(root,'.runtime/work-leaderboard-preview');await fs.mkdir(shots,{recursive:true});await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';scrollTo({top:0,behavior:'instant'});});await page.waitForTimeout(300);await page.screenshot({path:path.join(shots,'desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'当前light主题，点击切换',exact:true}).click();await page.getByRole('button',{name:'当前high-contrast主题，点击切换',exact:true}).click();await page.waitForTimeout(300);await page.screenshot({path:path.join(shots,'desktop-dark.png'),fullPage:true});await page.getByRole('button',{name:'当前dark主题，点击切换',exact:true}).click();
  for(const width of [390,360]){await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(shots,'narrow-'+width+'.png'),fullPage:true});}
  await page.setViewportSize({width:1365,height:1000});
  await page.evaluate(()=>window.boardFixture.signIn('someone-else'));await board.getByText('这道题还没有已保存的成绩',{exact:true}).waitFor();assert.equal(await board.getByText('第 61 名',{exact:true}).count(),0);
  await page.goto(base+'/#/works/gamehub-guess-baike/leaderboard/'+today+'/empty');await board.getByText('这道题还没有公开成绩',{exact:true}).waitFor();
  const before=requests.filter(r=>r.url.includes('/leaderboard')).length;
  await page.goto(base+'/#/works/00000000-0000-4000-8000-000000000002');await page.getByRole('heading',{name:'未接入榜单的游戏',exact:true}).waitFor();assert.equal(await board.count(),0);assert.equal(requests.filter(r=>r.url.includes('/leaderboard')).length,before);
  await page.goto(base+'/#/games/guess-baike/community');await board.getByText('像素玩家 1',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'猜百科',exact:true}).count(),1);
  await page.goto(base+'/#/community');await page.getByRole('navigation',{name:'分享导航'}).waitFor();assert.equal(await page.getByRole('button',{name:'猜百科排行 ↗',exact:true}).count(),0);
  await page.goto(base+'/#/play/gamehub-guess-baike');await page.getByText('排行榜测试',{exact:true}).waitFor();
  await page.getByPlaceholder('输入中文、英文或数字，也可直接猜标题').fill('测试');await page.getByRole('button',{name:'揭开',exact:false}).click();
  const result=page.getByRole('dialog',{name:'挑战完成'});await result.getByRole('button',{name:'重试保存成绩',exact:true}).waitFor();
  await result.getByRole('button',{name:'重试保存成绩',exact:true}).click();await result.getByText('正在保存本局成绩…',{exact:true}).waitFor();assert.equal(await result.getByRole('button',{name:'查看本局排名',exact:true}).isDisabled(),true);
  while(!releaseSave)await new Promise(resolve=>setTimeout(resolve,10));releaseSave();
  await result.getByText('成绩已保存，可查看本局排名。',{exact:true}).waitFor();assert.equal(saved.length,2);assert.equal(saved[0].puzzleDate,yesterday);assert.deepEqual(saved[0],saved[1]);
  await page.setViewportSize({width:360,height:844});await page.waitForTimeout(300);
  assert.ok(await result.locator('.guess-result__panel').evaluate(panel=>{const rect=panel.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;}));
  await page.screenshot({path:path.join(shots,'result-narrow.png')});await page.setViewportSize({width:1365,height:1000});
  await result.getByRole('button',{name:'查看本局排名',exact:true}).click();await board.getByText('历史玩家 1',{exact:true}).waitFor();assert.ok(page.url().endsWith('/leaderboard/'+yesterday+'/fixture-puzzle'));
  await page.waitForFunction(()=>{const top=document.querySelector('.work-leaderboard').getBoundingClientRect().top;return top>=0&&top<150;});
  assert.ok(requests.some(r=>r.url.includes('offset=50')));assert.deepEqual(errors,[]);
});
