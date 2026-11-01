const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {app}=require('electron');const {createShell}=require('../../apps/desktop/electron/main.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];let window,config;
const js=s=>window.webContents.executeJavaScript(s,true);
async function wait(s,label){const end=Date.now()+30000;while(Date.now()<end){if(await js(s))return;await delay(100);}throw Error('Timed out: '+label);}
async function check(name,fn){await fn();checks.push(name);process.stdout.write('PASS '+name+'\n');}
async function start(previousId){
  await wait("!!document.querySelector('.github-login:not(:disabled)')",'GitHub button');
  await js("document.querySelector('.github-login').click()");
  await wait("!!document.querySelector('.github-web-waiting')",'shared authorization waiting screen');
  const until=Date.now()+20000;
  while(Date.now()<until){
    const a=JSON.parse(await fs.readFile(config.authorization,'utf8').catch(()=>'null'));
    const visited=await fs.readFile(config.visited,'utf8').catch(()=>'');
    if(a && a.challengeId!==previousId && visited===a.challengeId)return a;
    await delay(100);
  }
  throw Error('System browser did not visit local authorization page');
}
async function decide(attempt,decision){const url=new URL('/__github/decision',config.accountApiOrigin);url.search=new URLSearchParams({state:new URL(attempt.authorizeUrl).searchParams.get('state'),decision}).toString();assert.equal((await fetch(url)).status,200);}
async function cancel(){await js("[...document.querySelectorAll('.account-form > .text-button')].at(-1).click()");await wait("document.querySelector('.account-form input')?.inputMode==='email'",'desktop cancellation');}
async function capture(file){window.show();await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(200);await fs.writeFile(file,(await window.webContents.capturePage()).toPNG());window.hide();}
async function run(){
  config=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--config')+1],'utf8'));
  const shell=await createShell({...config,visible:false});window=await shell.createWindow('/account?lang=zh-CN');
  if(config.phase==='initial'){
    let old,denied,approved;
    await check('system browser visits local OAuth page while desktop keeps the shared waiting screen',async()=>{
      old=await start();assert.equal((await js("window.mooyuDesktop.account.call('state',[])")).value.authenticated,false);
      assert.equal(await js("(()=>{const event=new MouseEvent('click',{bubbles:true,cancelable:true});document.querySelector('.github-open').dispatchEvent(event);return event.defaultPrevented})()"),true,'reopen uses system browser bridge instead of blocked popup');
      await capture(config.report.replace('.json','-waiting.png'));
      assert.equal((await js("window.mooyuDesktop.account.call('openGitHub',['file:///C:/Windows/test'])")).ok,false);
    });
    await check('desktop cancellation rejects a browser authorization that completes later',async()=>{
      await cancel();await decide(old,'approve');await delay(2400);
      assert.equal((await js("window.mooyuDesktop.account.call('state',[])")).value.authenticated,false);
      assert.equal(await js("!!document.querySelector('.header .avatar')"),false);
    });
    await check('provider denial is shown without logging in and can return to email login',async()=>{
      denied=await start(old.challengeId);await decide(denied,'deny');
      await wait("document.querySelector('.account-form .form-error')?.textContent.includes('GITHUB_ACCESS_DENIED')",'provider denial');
      assert.equal((await js("window.mooyuDesktop.account.call('state',[])")).value.authenticated,false);await cancel();
    });
    await check('GitHub callback and shared poll complete login with encrypted desktop persistence',async()=>{
      approved=await start(denied.challengeId);await decide(approved,'approve');
      await wait("!!document.querySelector('.account-summary') && !!document.querySelector('.header .avatar')",'GitHub signed in');
      const profile=await js("window.mooyuDesktop.account.call('getProfile',[])");assert.equal(profile.value.data.linkedAccounts[0].provider,'github');
      await capture(config.report.replace('.json','-signed-in.png'));
    });
    await check('GitHub bearer tokens are absent from renderer state, DOM, browser storage and disk plaintext',async()=>{
      const {createWindowsDpapiCredentialVault}=await import('../../apps/capability-executor/src/credential-vault.mjs');
      const directory=path.join(config.profileRoot,'account-vault'),vault=createWindowsDpapiCredentialVault({directory});
      const key='desktop-shell-account:'+crypto.createHash('sha256').update(config.accountApiOrigin).digest('hex');
      const record=JSON.parse(await vault.load(key)),exposed=await js("(async()=>JSON.stringify({state:await window.mooyuDesktop.account.call('state',[]),dom:document.body.innerText,local:Object.entries(localStorage),session:Object.entries(sessionStorage)}))()");
      for(const token of [record.tokens.accessToken,record.tokens.refreshToken]){
        assert.equal(exposed.includes(token),false);for(const file of await fs.readdir(directory))assert.equal((await fs.readFile(path.join(directory,file),'utf8')).includes(token),false);
      }
    });
  }else if(config.phase==='restore'){
    await check('GitHub session restores through DPAPI after full restart and expired access token',async()=>{
      await wait("!!document.querySelector('.account-summary') && !!document.querySelector('.header .avatar')",'restored GitHub session');
      assert.equal((await js("window.mooyuDesktop.account.call('getProfile',[])")).value.data.linkedAccounts[0].provider,'github');
    });
    await check('shared logout revokes the GitHub desktop session and clears persisted credentials',async()=>{
      await js("document.querySelector('.account-summary .button').click()");await wait("!!document.querySelector('.github-login') && !document.querySelector('.header .avatar')",'GitHub logout');
      assert.equal((await fs.readdir(path.join(config.profileRoot,'account-vault'))).length,0);
    });
  }else{
    await check('logged-out GitHub session stays logged out after another full restart',async()=>{
      await wait("!!document.querySelector('.github-login') && !document.querySelector('.header .avatar')",'logged out restart');
      assert.equal((await js("window.mooyuDesktop.account.call('state',[])")).value.authenticated,false);
    });
  }
  await capture(config.report.replace('.json','.png'));await fs.writeFile(config.report,JSON.stringify({ok:true,phase:config.phase,checks},null,2));app.quit();
}
run().catch(async e=>{if(config?.report)await fs.writeFile(config.report,JSON.stringify({ok:false,checks,error:e.message},null,2));process.stderr.write('GITHUB_ACCEPTANCE_FAILED '+e.message+'\n');app.exit(1);});
