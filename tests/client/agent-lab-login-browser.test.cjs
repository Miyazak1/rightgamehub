const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const playwright=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('QR page explains a failed status poll, recovers after throttling and renders the QR before confirmed login',{skip:!playwright,timeout:60000},async t=>{
 const root=path.resolve(__dirname,'../..'),app=require('../../apps/api/node_modules/fastify')(),{build}=require('../browser-build.cjs'),{chromium}=require(playwright);let browser,limited=true,loggedIn=false,statusCalls=0,qrCalls=0;
 t.after(async()=>{await browser?.close();await app.close();});
 app.get('/lab/qq/login-status',async(_r,reply)=>{statusCalls++;return limited?reply.code(503).send({error:{code:'QQ_GATEWAY_RATE_LIMITED'}}):{data:{phase:loggedIn?'ready':'offline',loggedIn,ready:loggedIn}};});
 app.post('/lab/qq/qrcode',async()=>{qrCalls++;return {data:{qrText:'https://qq.com/fixture-test-only'}};});
 const entry="import React from 'react';import{createRoot}from'react-dom/client';import Login from './scripts/agent-interaction-lab-login.jsx';createRoot(document.getElementById('root')).render(<Login botId='100000001'/>);";
 const js=(await build({stdin:{contents:entry,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',nodePaths:[path.join(root,'packages/platform-client/node_modules')],logLevel:'silent'})).outputFiles[0].text;
 app.get('/',async(_r,r)=>r.type('text/html').send('<html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script src="/fixture.js"></script></html>'));app.get('/fixture.js',async(_r,r)=>r.type('text/javascript').send(js));await app.listen({host:'127.0.0.1',port:0});
 browser=await chromium.launch({channel:process.env.GAMEHUB_BROWSER_CHANNEL||'msedge',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+app.server.address().port);
 await page.getByRole('status').filter({hasText:'限流'}).waitFor();assert.equal(await page.getByRole('button',{name:'刷新二维码',exact:true}).isDisabled(),true);
 limited=false;await page.getByRole('status').filter({hasText:'未登录，等待扫码'}).waitFor();await page.getByRole('button',{name:'刷新二维码',exact:true}).click();await page.locator('svg').waitFor();assert.equal(qrCalls,1);
 loggedIn=true;await page.getByRole('status').filter({hasText:'已登录，已就绪'}).waitFor();assert.equal(await page.locator('svg').count(),0);assert.equal(await page.getByRole('button',{name:'刷新二维码',exact:true}).isDisabled(),true);assert.ok(statusCalls>=3);
});
