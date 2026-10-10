const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'../..'),databaseUrl=process.env.GAMEHUB_COMMUNITY_DATABASE_URL,playwrightPath=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH,browserPath=process.env.GAMEHUB_COMMUNITY_BROWSER_PATH;

test('project claim browser: creator sees progress and admin approval is auditable',{skip:!databaseUrl||!playwrightPath,timeout:180000},async t=>{
  const fixture=await require('../project-claim-fixture.cjs').createProjectClaimFixture(databaseUrl),{app,actors}=fixture;
  await fixture.createPendingClaim();
  const out=path.join(root,'.runtime/project-claim-acceptance');await fs.mkdir(out,{recursive:true});
  let browser,creatorPage,adminPage;t.after(async()=>{if(creatorPage)await creatorPage.screenshot({path:path.join(out,'creator-last.png'),fullPage:true});if(adminPage)await adminPage.screenshot({path:path.join(out,'admin-last.png'),fullPage:true});await browser?.close();await fixture.close();});
  const {build}=require('../../extensions/harness/node_modules/esbuild');
  const entry=`import React,{useCallback,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{MyProjectClaims,AdminClaimManager}from${JSON.stringify(path.join(root,'packages/platform-client/src/App.jsx').replaceAll('\\','/'))};
import{createApiClient}from${JSON.stringify(path.join(root,'packages/platform-api-client/src/index.mjs').replaceAll('\\','/'))};
const actors=${JSON.stringify(actors)},key=new URL(location.href).searchParams.get('actor')||'claimant',actor=actors[key],api=createApiClient({getAccessToken:()=>actor.userId});
function Fixture(){const[state,setState]=useState({status:'loading',items:[]});const load=useCallback(async()=>{setState(current=>({...current,status:'loading'}));try{const response=key==='admin'?await api.listAdminProjectClaims('all',100):await api.listMyProjectClaims('all',100);setState({status:'ready',items:response.data});}catch(error){setState({status:'error',items:[],error:error.message});}},[]);useEffect(()=>{load();},[load]);return <main className="page">{key==='admin'?<AdminClaimManager api={api} claims={state.items} onChanged={load} demo={false}/>:<MyProjectClaims api={api} state={state} onReload={load} go={()=>{}} demo={false}/>}</main>}createRoot(document.getElementById('root')).render(<Fixture/>);`;
  const bundled=await build({stdin:{contents:entry,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',target:'chrome110',nodePaths:[path.join(root,'packages/platform-client/node_modules')],loader:{'.png':'dataurl'},define:{'import.meta.env.DEV':'false'},logLevel:'silent'});
  const css=await fs.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
  app.get('/',async(_request,reply)=>reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js',async(_request,reply)=>reply.type('application/javascript').send(bundled.outputFiles[0].text));
  await app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+app.server.address().port;
  browser=await require(playwrightPath).chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{})});const errors=[];
  creatorPage=await browser.newPage({viewport:{width:1280,height:900}});adminPage=await browser.newPage({viewport:{width:1280,height:900}});
  for(const page of [creatorPage,adminPage]){page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));}
  await creatorPage.goto(base+'/?actor=claimant');await creatorPage.getByRole('heading',{name:'我的认领',exact:true}).waitFor();await creatorPage.getByText('待审核',{exact:true}).waitFor();
  await adminPage.goto(base+'/?actor=admin');await adminPage.getByRole('heading',{name:'作者与维护者认领',exact:true}).waitFor();await adminPage.getByLabel('审核或治理说明').fill('公开作者页面和署名信息核验一致。');await adminPage.getByRole('button',{name:'确认认领',exact:true}).click();
  await adminPage.getByRole('button',{name:/已认领 1/}).click();await adminPage.getByText('最近决定：公开作者页面和署名信息核验一致。',{exact:true}).waitFor();
  await adminPage.getByText('审核与权限历史',{exact:true}).click();await adminPage.getByText('审核通过',{exact:true}).waitFor();
  await creatorPage.getByRole('button',{name:'刷新',exact:true}).click();await creatorPage.getByText('已认领',{exact:true}).waitFor();
  await creatorPage.setViewportSize({width:360,height:800});assert.equal(await creatorPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await creatorPage.screenshot({path:path.join(out,'creator-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
});
