const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const root=path.resolve(__dirname,'../..'),databaseUrl=process.env.GAMEHUB_COMMUNITY_DATABASE_URL,playwrightPath=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('community browser: StrictMode, failed-submit recovery, image, review and private bookmark',{skip:!databaseUrl||!playwrightPath,timeout:90000},async t=>{
  const connection=new URL(databaseUrl);
  assert.ok(['127.0.0.1','localhost'].includes(connection.hostname)&&connection.pathname==='/community_test','Browser fixture requires the dedicated local community_test database.');
  const {chromium}=require(playwrightPath);
  const Fastify=require('../../apps/api/node_modules/fastify'),sharp=require('../../apps/api/node_modules/sharp');
  const {build}=require('../../extensions/harness/node_modules/esbuild');
  const {createCommunityTestDatabase}=require('../community-database.cjs');
  const {applyMigrations}=await import('../../apps/api/src/migrations.mjs');
  const {CommunityService}=await import('../../apps/api/src/community-service.mjs');
  const {CommunityMediaStore}=await import('../../apps/api/src/community-media-store.mjs');
  const {CommunityMediaService}=await import('../../apps/api/src/community-media-service.mjs');
  const {createCommunityImageRunner}=await import('../../apps/api/src/community-image-runner.mjs');
  const {registerCommunityRoutes}=await import('../../apps/api/src/community-routes.mjs');
  const database=await createCommunityTestDatabase(databaseUrl),pool=database.pool,app=Fastify();
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-community-browser-'));
  let browser,page,timer,processing=false;
  t.after(async()=>{clearInterval(timer);if(page){await fs.mkdir(path.join(root,".runtime/community-acceptance"),{recursive:true});await page.screenshot({path:path.join(root,".runtime/community-acceptance/last-state.png"),fullPage:false});}await browser?.close();while(processing)await new Promise(r=>setTimeout(r,25));await app.close();await database.close();await fs.rm(directory,{recursive:true,force:true});});
  await applyMigrations(pool,path.join(root,'apps/api/migrations'));
  const actors={};
  for(const name of ['owner','reader','admin']){
    const userId=crypto.randomUUID();actors[name]={id:userId,displayName:name==='owner'?'像素观察员':name==='reader'?'路过的玩家':'审核员',role:name==='admin'?'admin':'user',canPublish:false,avatar:{kind:'preset',presetKey:'robot',url:null,staticUrl:null,animated:false}};
    await pool.query("INSERT INTO users(id,display_name,role,social_visibility,profile_handle) VALUES($1,$2,$3,'private',$4)",[userId,actors[name].displayName,actors[name].role,'t'+userId.replaceAll('-','').slice(0,12)]);
  }
  const service=new CommunityService({pool,config:{enabled:true,postingEnabled:true,imagesEnabled:true}});
  const store=new CommunityMediaStore(path.join(directory,'media'));
  const media=new CommunityMediaService({service,store,runner:createCommunityImageRunner({root:path.join(directory,'processor'),mediaRoot:store.root})});
  const requireAuth=async request=>{const id=request.headers.authorization?.replace(/^Bearer /,'');if(!Object.values(actors).some(user=>user.id===id))throw Object.assign(Error('请登录'),{statusCode:401,code:'AUTH_REQUIRED'});request.actor={userId:id};};
  app.addContentTypeParser('application/octet-stream',(request,payload,done)=>done(null,payload));
  app.setErrorHandler((error,request,reply)=>reply.code(error.statusCode||500).send({error:{code:error.code||'ERROR',message:error.message}}));
  registerCommunityRoutes(app,{service,media,requireAuth});
  app.get('/v1/me',{preHandler:requireAuth},async request=>({data:Object.values(actors).find(user=>user.id===request.actor.userId)}));
  app.post('/v1/analytics/events',async()=>({data:{accepted:1}}));
  const entry=[
    "import React from 'react';import{createRoot}from'react-dom/client';",
    'import App from '+JSON.stringify(path.join(root,'packages/platform-client/src/App.jsx').replaceAll('\\','/'))+';',
    'import{createApiClient}from'+JSON.stringify(path.join(root,'packages/platform-api-client/src/index.mjs').replaceAll('\\','/'))+';',
    'const actors='+JSON.stringify(actors)+';let actor=actors.owner;',
    'const api=createApiClient({getAccessToken:()=>actor.id});const root=createRoot(document.getElementById("root"));',
    'function render(){root.render(<React.StrictMode><App key={actor.id} apiClient={api} demo={false}/></React.StrictMode>);}window.communityFixture={setActor(name){actor=actors[name];render();}};render();',
  ].join('\n');
  const bundled=await build({stdin:{contents:entry,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',target:'chrome110',nodePaths:[path.join(root,'packages/platform-client/node_modules')],loader:{'.png':'dataurl'},define:{'import.meta.env.DEV':'false'},logLevel:'silent'});
  const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
  app.get('/',async(request,reply)=>reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameHub 分享验收</title><style>'+css+'</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js',async(request,reply)=>reply.type('application/javascript').send(bundled.outputFiles[0].text));
  await app.listen({host:'127.0.0.1',port:0});
  const base='http://127.0.0.1:'+app.server.address().port;
  timer=setInterval(async()=>{if(processing)return;processing=true;try{await media.runOnce();}finally{processing=false;}},150);
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
  page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const title='新发现：像素世界里的 AI '+Date.now();
  await page.goto(base+'/#/community');
  await page.getByRole('button',{name:'＋ 分享发现',exact:true}).click();
  await page.getByText('内容和修改审核通过后，将连同你的昵称公开。个人主页仍按原隐私设置展示。',{exact:false}).waitFor();
  await page.getByLabel('标题',{exact:true}).fill(title);
  await page.getByLabel('主题',{exact:true}).selectOption('ai');
  await page.getByLabel('文字',{exact:true}).fill('一个把像素创作与 AI 实验放在一起的小发现。\n画面、玩法和技术，都可以从这里继续聊起。');
  await page.getByRole('button',{name:'＋ 来源链接',exact:true}).click();
  await page.getByLabel('来源链接',{exact:true}).fill('https://example.com/research');
  await page.getByLabel('链接说明',{exact:true}).fill('项目介绍与原文');
  const png=await sharp({create:{width:640,height:240,channels:3,background:'#473461'}}).png().toBuffer();
  await page.locator('input[type=file]').setInputFiles({name:'像素实验.png',mimeType:'image/png',buffer:png});
  // A failed request must restore the controls and retain content and request identity.
  let failedCreate=false;const createKeys=[];
  await page.route('**/v1/community/posts',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    createKeys.push(route.request().headers()['idempotency-key']);
    if(!failedCreate){failedCreate=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'API_UNAVAILABLE',message:'测试：暂时不可用，请重试。'}})});}
    return route.continue();
  });
  await page.getByRole('button',{name:'提交分享',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'测试：暂时不可用，请重试。'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'提交分享',exact:true}).isEnabled(),true);
  assert.equal(await page.getByLabel('标题',{exact:true}).inputValue(),title);
  await page.getByRole('button',{name:'提交分享',exact:true}).click();
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  await page.getByText('待审核',{exact:true}).waitFor();
  assert.equal(createKeys.length,2);assert.equal(createKeys[0],createKeys[1]);
  await page.evaluate(()=>{window.communityFixture.setActor('admin');location.hash='/community/review';});
  const review=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await review.getByLabel('处理理由').fill('来源和图片已核对。');
  await review.getByRole('button',{name:'通过此版本'}).click();
  await page.waitForFunction(title=>!document.querySelector('main')?.textContent.includes(title),title);
  await page.evaluate(()=>{window.communityFixture.setActor('reader');location.hash='/community';});
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await card.getByRole('button',{name:'点赞 0',exact:true}).click();
  await card.getByRole('button',{name:'点赞 1',exact:true}).waitFor();
  await card.getByRole('button',{name:'收藏',exact:true}).click();
  await card.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
  await card.getByRole('img',{name:'像素实验'}).waitFor();
  await fs.mkdir(path.join(root,'.runtime/community-acceptance'),{recursive:true});
  await page.screenshot({path:path.join(root,'.runtime/community-acceptance/desktop.png'),fullPage:false});
  await page.setViewportSize({width:360,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'narrow layout must not overflow');
  await page.screenshot({path:path.join(root,'.runtime/community-acceptance/mobile.png'),fullPage:false});
  await page.getByRole('button',{name:'私人收藏',exact:true}).click();
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  await page.evaluate(()=>{window.communityFixture.setActor('owner');location.hash='/community/bookmarks';});
  await page.getByRole('heading',{name:'还没有收藏',exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='/social';});
  await page.getByRole('heading',{name:'分享',exact:false}).waitFor();
  await page.evaluate(()=>{window.communityFixture.setActor('admin');location.hash='/community/review';});
  await page.getByText('投稿限制管理',{exact:true}).click();
  await page.getByLabel('用户 ID',{exact:true}).fill(actors.owner.id);
  await page.getByLabel('调整原因',{exact:true}).fill('测试违规限制');
  await page.getByRole('button',{name:'限制投稿',exact:true}).click();
  await page.getByText('已限制该账号投稿。',{exact:true}).waitFor();
  await page.evaluate(()=>{window.communityFixture.setActor('owner');location.hash='/community/mine';});
  assert.equal(await page.getByRole('button',{name:'投稿已受限',exact:true}).isDisabled(),true);
  await page.getByText('当前账号已被限制投稿；已有分享仍可查看、撤回或删除。',{exact:true}).waitFor();
  await page.evaluate(()=>{window.communityFixture.setActor('admin');location.hash='/community/review';});
  await page.getByText('投稿限制管理',{exact:true}).click();
  await page.getByLabel('用户 ID',{exact:true}).fill(actors.owner.id);
  await page.getByLabel('调整原因',{exact:true}).fill('解除测试限制');
  await page.getByRole('button',{name:'解除投稿限制',exact:true}).click();
  await page.getByText('投稿限制已解除。',{exact:true}).waitFor();
  await page.evaluate(()=>{window.communityFixture.setActor('owner');location.hash='/community/mine';});
  assert.equal(await page.getByRole('button',{name:'＋ 分享发现',exact:true}).isEnabled(),true);
  assert.deepEqual(errors,[]);
  // Keep fixture metadata consistent after the test's temporary image directory is removed.
  const posts=await service.list({userId:actors.owner.id},{kind:'mine'});
  for(const post of posts.items)await service.withdraw({userId:actors.owner.id},post.id,'"'+post.version+'"',true);
});
