const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),url=process.env.PRACTICE_TEST_DATABASE_URL,playwright=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('practice selection checks immediately and restores locked feedback after failure or reload',{skip:!url||!playwright,timeout:120000},async t=>{
 const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.pathname,'/mooyu_practice_acceptance');
 const {Pool}=require('../../apps/api/node_modules/pg'),{chromium}=require(playwright),{build,servePage}=require('../browser-build.cjs');
 const [{PostgresPracticeRepository},{createPracticeService},{registerPracticeRoutes},{mathTopics}]=await Promise.all([
  import('../../apps/api/src/practice/repository.mjs'),import('../../apps/api/src/practice/service.mjs'),import('../../apps/api/src/practice/routes.mjs'),import('../../packages/practice-core/src/catalog.mjs')]);
 const schema='practice_browser_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url});
 await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString:url,options:'-c search_path='+schema+',public'}),app=require('../../apps/api/node_modules/fastify')();
 let browser,releaseHeld,holdNext=true,failNext=false,loseNext=false;const checks=[];
 t.after(async()=>{releaseHeld?.();await browser?.close();await app.close();await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
 await pool.query('CREATE TABLE users(id uuid PRIMARY KEY)');await pool.query(await fs.readFile(path.join(root,'apps/api/migrations/0160_learning_practice.sql'),'utf8'));
 const userId=randomUUID(),batchId=randomUUID(),config={subjectId:'mathematics',curriculumId:'csca-math-1.43',topicId:'csca.math.sets',stageId:null,difficultyId:'basic',count:3,language:'zh'};
 const prompts=['第一题：选择一个数','第二题：选择正确的数量','第三题：恢复之前的作答'];
 const items=prompts.map((prompt,n)=>({answer:n===2?'C':null,checked:false,elapsedSeconds:0,question:{
  id:String(n+1).repeat(64),identityKey:String(n+4).repeat(64),topicId:config.topicId,difficultyId:'basic',version:'fixture-v1',prompt,
  options:[{id:'A',text:'一'},{id:'B',text:'二'},{id:'C',text:'三'},{id:'D',text:'四'}],correctAnswer:['A','B','C'][n],explanation:['第一题的解析','第二题的解析','第三题的解析'][n],figures:{},
 }}));
 await pool.query('INSERT INTO users VALUES($1)',[userId]);
 await pool.query("INSERT INTO practice_batches(id,user_id,config,request_key,status,items) VALUES($1,$2,$3,'feedback-fixture','ready',$4)",[batchId,userId,config,JSON.stringify(items)]);
 const repository=new PostgresPracticeRepository(pool),service=createPracticeService({repository,engine:{capabilities:()=>({ready:true,topics:mathTopics,engineVersion:'1.43.0'})}});
 app.addHook('preHandler',async(request,reply)=>{
  if(request.method!=='PATCH'||request.body?.action!=='check')return;
  checks.push(request.body);
  if(holdNext){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve;});}
  if(failNext){failNext=false;return reply.code(503).send({error:{code:'API_UNAVAILABLE',message:'判题暂不可用，请重试。'}});}
 });
 app.addHook('onSend',async(request,reply,payload)=>{
  if(loseNext&&request.method==='PATCH'&&request.body?.action==='check'&&reply.statusCode===200){loseNext=false;reply.code(503);return JSON.stringify({error:{code:'API_UNAVAILABLE',message:'判题结果确认超时，请重试。'}});}
  return payload;
 });
 app.setErrorHandler((error,_request,reply)=>reply.code(error.statusCode||500).send({error:{code:error.code,message:error.message}}));
 registerPracticeRoutes(app,{service,requireAuth:async request=>{assert.equal(request.headers.authorization,'Bearer feedback-fixture');request.actor={userId};}});
 const before=await service.get({userId},batchId);assert.ok(before.items.every(q=>!('correctAnswer'in q)&&!('explanation'in q)));
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import PracticePage from './packages/platform-client/src/PracticePage.jsx';import{I18nProvider}from'./packages/platform-client/src/I18n.jsx';import{createPracticeApiClient}from'./packages/platform-api-client/src/practice.mjs';const api=createPracticeApiClient({getAccessToken:()=> 'feedback-fixture'});createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider initialLocale="zh-CN"><div className="app"><PracticePage api={api} accountProfile={{id:${JSON.stringify(userId)}}} batchId=${JSON.stringify(batchId)} go={()=>{}}/></div></I18nProvider></React.StrictMode>);`;
 const js=(await build({stdin:{contents:entry,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',nodePaths:[path.join(root,'packages/platform-client/node_modules')],logLevel:'silent'})).outputFiles[0].text;
 const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
 servePage(app,(_request,reply)=>reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/fixture.js"></script></html>'));
 app.get('/fixture.js',(_request,reply)=>reply.type('text/javascript').send(js));await app.listen({host:'127.0.0.1',port:0});
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
 const option=id=>page.locator('.practice-options label:has(input[value="'+id+'"])'),feedback=page.locator('.practice-answer-feedback');
 await page.goto('http://127.0.0.1:'+app.server.address().port,{waitUntil:'domcontentloaded',timeout:30000});await page.getByRole('heading',{name:prompts[0],exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'核对答案',exact:true}).count(),0);
 await option('A').click();await option('A').getByText('判题中…',{exact:true}).waitFor();assert.equal(await page.locator('.practice-options input[value="A"]').isChecked(),true);
 assert.equal(await page.locator('.practice-options input:enabled').count(),0);assert.equal(await feedback.count(),0);assert.equal(checks.length,1);assert.equal(checks[0].action,'check');assert.equal(checks[0].answer,'A');
 releaseHeld();await feedback.getByText('答对了，继续保持',{exact:true}).waitFor();await feedback.getByText('第一题的解析',{exact:true}).waitFor();
 assert.match(await option('A').getAttribute('class'),/is-correct/);assert.equal(await page.getByRole('heading',{name:prompts[0],exact:true}).count(),1,'checking must not auto-advance');
 await page.reload({waitUntil:'domcontentloaded'});await feedback.getByText('答对了，继续保持',{exact:true}).waitFor();assert.equal(await page.locator('.practice-options input:enabled').count(),0);
 await page.getByRole('button',{name:'下一题 →',exact:true}).click();await page.getByRole('heading',{name:prompts[1],exact:true}).waitFor();
 failNext=true;await option('A').click();await page.getByRole('alert').filter({hasText:'判题暂不可用'}).waitFor();assert.equal(await feedback.count(),0);assert.equal(await page.locator('.practice-options input:enabled').count(),4);
 await option('A').click();await feedback.getByText('答错了，正确答案是 B',{exact:true}).waitFor();await feedback.getByText('第二题的解析',{exact:true}).waitFor();assert.match(await option('A').getAttribute('class'),/is-wrong/);assert.match(await option('B').getAttribute('class'),/is-correct/);
 const screenshots=path.join(root,'.runtime/practice-instant-feedback');await fs.mkdir(screenshots,{recursive:true});await page.setViewportSize({width:360,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(screenshots,'wrong-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'下一题 →',exact:true}).click();await page.getByRole('heading',{name:prompts[2],exact:true}).waitFor();assert.equal(await page.locator('.practice-options input[value="C"]').isChecked(),true);
 // Previously saved choices can be clicked again; a lost ACK cannot change the grade.
 loseNext=true;await option('C').click();await page.getByRole('alert').filter({hasText:'判题结果确认超时'}).waitFor();await option('A').click();await feedback.getByText('答对了，继续保持',{exact:true}).waitFor();assert.equal(await page.locator('.practice-options input[value="C"]').isChecked(),true);
 const stored=await repository.get(userId,batchId);assert.equal(stored.items[2].answer,'C');assert.equal(stored.items[2].checked,true);assert.equal(stored.status,'ready');
 assert.equal(checks.length,5);assert.deepEqual(errors,[]);
});
