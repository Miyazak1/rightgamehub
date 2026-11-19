const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const playwright=process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH;
test('agent avatar preview, save, default restore and failure states work in StrictMode',{skip:!playwright,timeout:90000},async t=>{
  const {build}=require('../browser-build.cjs'),{chromium}=require(playwright),app=require('../../apps/api/node_modules/fastify')();
  let browser;const errors=[];t.after(async()=>{await browser?.close();await app.close();});
  const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import AgentAvatarEditor from './packages/platform-client/src/AgentAvatarEditor.jsx';
    import AvatarView from './packages/platform-client/src/AvatarView.jsx';import './packages/platform-client/src/styles.css';
    window.__uploads=[];window.__reject=false;window.__hold=false;
    const api={avatarUrl:avatar=>avatar.url,
      uploadAdminAgentAvatar:async(id,file)=>{window.__uploads.push({id,name:file.name});if(window.__reject)throw Error('fixture upload failed');
        if(window.__hold)await new Promise(resolve=>window.__release=resolve);
        return{data:{agentUserId:id,avatar:{kind:'upload',url:'/avatar.png?v='+window.__uploads.length}}};},
      resetAdminAgentAvatar:async id=>({data:{agentUserId:id,avatar:{kind:'preset',presetKey:'xiaomoyu'}}})};
    function App(){const[agent,setAgent]=useState({agentUserId:'11111111-1111-4111-8111-111111111111',displayName:'小墨鱼',avatar:{kind:'preset',presetKey:'xiaomoyu'}});
      return <main style={{maxWidth:760,margin:'24px auto'}}><AgentAvatarEditor api={api} agent={agent} onSaved={result=>setAgent(current=>({...current,avatar:result.avatar}))}/>
        <aside aria-label="已保存头像"><AvatarView api={api} avatar={agent.avatar} alt="公开作者头像"/></aside></main>;}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
  const bundle=await build({stdin:{contents:entry,resolveDir:path.resolve(__dirname,'../..'),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',nodePaths:[path.resolve('packages/platform-client/node_modules')],logLevel:'silent'});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  app.get('/',async(_request,reply)=>reply.type('text/html').send('<!doctype html><html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script></html>'));
  app.get('/fixture.js',async(_request,reply)=>reply.type('text/javascript').send(bundle.outputFiles[0].text));
  app.get('/avatar.png',async(_request,reply)=>reply.type('image/png').send(png));
  await app.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({headless:true,channel:process.env.GAMEHUB_BROWSER_CHANNEL});
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+app.server.address().port);const input=page.getByLabel('选择机器人头像');
  await input.setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>document.querySelector('.agent-avatar-editor__preview img').src.startsWith('blob:'));
  await page.evaluate(()=>{window.__hold=true;});await page.getByRole('button',{name:'保存头像',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'处理中…'}).isDisabled(),true);
  await page.waitForFunction(()=>!!window.__release);await page.evaluate(()=>{window.__release();window.__hold=false;});
  await page.getByRole('status').filter({hasText:'头像已保存'}).waitFor();
  assert.match(await page.getByRole('img',{name:'公开作者头像'}).getAttribute('src'),/avatar.png\?v=1/);
  await input.setInputFiles({name:'bad.png',mimeType:'image/png',buffer:png});await page.evaluate(()=>{window.__reject=true;});
  await page.getByRole('button',{name:'保存头像',exact:true}).click();await page.getByRole('alert').filter({hasText:'fixture upload failed'}).waitFor();
  assert.match(await page.getByRole('img',{name:'公开作者头像'}).getAttribute('src'),/v=1/);
  await page.getByRole('button',{name:'恢复小墨鱼默认头像'}).click();await page.getByRole('status').filter({hasText:'已恢复'}).waitFor();
  assert.doesNotMatch(await page.getByRole('img',{name:'公开作者头像'}).getAttribute('src'),/avatar.png\?v=/);
  await input.setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(2*1024*1024+1)});
  await page.getByRole('alert').filter({hasText:'不能超过 2 MB'}).waitFor();assert.equal(await page.evaluate(()=>window.__uploads.length),2);
  assert.deepEqual(errors,[]);
  if(process.env.MOOYU_AVATAR_SCREENSHOT_DIR){await fs.mkdir(process.env.MOOYU_AVATAR_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.MOOYU_AVATAR_SCREENSHOT_DIR,'desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.MOOYU_AVATAR_SCREENSHOT_DIR,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
});
