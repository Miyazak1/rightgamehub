const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { createShell } = require('../../apps/desktop/electron/main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let window, config;
const js = source => window.webContents.executeJavaScript(source, true);
async function wait(source, label) { const until=Date.now()+25000; while(Date.now()<until) { if(await js(source)) return; await delay(100); } throw Error('Timed out: '+label); }
async function check(name, fn) { await fn(); checks.push(name); process.stdout.write('PASS '+name+'\n'); }
async function fill(value) {
  await js(`(()=>{const el=document.querySelector('.account-form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function submit() { await js("document.querySelector('.account-form').requestSubmit()"); }
async function reload() { const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve)); window.webContents.reload(); await loaded; }
async function capture(file) {
  // Hidden Windows windows may retain an old compositor frame despite current DOM.
  // Paint a visible test window before collecting visual evidence.
  window.show();
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await delay(200);
  await fs.writeFile(file,(await window.webContents.capturePage()).toPNG());
  window.hide();
}
async function run() {
  config=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--config')+1],'utf8'));
  const shell=await createShell({ ...config, visible:false });
  window=await shell.createWindow('/account?lang=zh-CN');
  await wait("!!document.querySelector('.account-form,.account-summary')",'shared account screen');
  if(config.accountEnvironment==='isolated-test') await check('HTTPS test identity, visible origin and direct-renderer network denial survive this process phase',async()=>{
    const environment=await js('window.mooyuDesktop.environment()');
    assert.equal(environment.accountEnvironment,'isolated-test');
    assert.equal(environment.accountApiOrigin,config.accountApiOrigin);
    assert.equal(await js("document.querySelector('[data-desktop-preview] span').textContent"),'隔离测试');
    await js("document.querySelector('[data-desktop-preview]').click()");
    assert.equal(await js("document.querySelector('[data-desktop-test-origin]').textContent"),config.accountApiOrigin);
    await js("document.querySelector('.desktop-info').close()");
    assert.equal(await js(`fetch(${JSON.stringify(config.accountApiOrigin+'/v1/me')}).then(()=>false,()=>true)`),true);
    const binding=JSON.parse(await fs.readFile(path.join(config.profileRoot,'account-server.json'),'utf8'));
    assert.equal(binding.origin,config.accountApiOrigin);
    assert.equal(app.getPath('userData'),config.profileRoot);
    assert.equal(app.getPath('sessionData'),path.join(config.profileRoot,'session-data'));
    assert.equal(window.webContents.session.storagePath,path.join(config.profileRoot,'session-data','Partitions','mooyu-desktop-preview'));
  });
  if(config.phase==='initial') {
    await check('shared account form sends a local email challenge and rejects wrong OTP',async()=>{
      await fill('desktop-electron@example.test'); await submit();
      await wait("document.querySelector('.account-form input')?.inputMode==='numeric'",'code phase');
      const code=(await fs.readFile(config.mailbox,'utf8')).trim();
      await fill(code==='000000'?'111111':'000000'); await submit();
      await wait("!!document.querySelector('.account-form .form-error')",'wrong OTP feedback');
      assert.equal((await js("window.mooyuDesktop.account.call('state',[])")).value.authenticated,false);
    });
    await check('shared form logs in, shows profile, current device and DPAPI persistence',async()=>{
      const code=(await fs.readFile(config.mailbox,'utf8')).trim(); await fill(code); await submit();
      await wait("!!document.querySelector('.account-summary') && !!document.querySelector('.header .avatar')",'signed-in settings');
      assert.match(await js("document.querySelector('.account-summary').textContent"),/桌面隔离测试用户/);
      await wait("!!document.querySelector('.device-row')",'current device');
      assert.match(await js("document.querySelector('.account-summary').textContent"),/DPAPI/);
      await capture(config.report.replace('.json','-signed-in.png'));
    });
    await check('bearer and refresh tokens stay out of preload results, DOM and browser storage',async()=>{
      const {createWindowsDpapiCredentialVault}=await import('../../apps/capability-executor/src/credential-vault.mjs');
      const key='desktop-shell-account:'+crypto.createHash('sha256').update(config.accountApiOrigin).digest('hex');
      const directory=path.join(config.profileRoot,'account-vault');
      const vault=createWindowsDpapiCredentialVault({directory});
      const record=JSON.parse(await vault.load(key));
      const exposed=await js(`(async()=>JSON.stringify({state:await window.mooyuDesktop.account.call('state',[]),bootstrap:await window.mooyuDesktop.account.call('bootstrapSession',[]),local:Object.entries(localStorage),session:Object.entries(sessionStorage),dom:document.body.innerText}))()`);
      for(const token of [record.tokens.accessToken,record.tokens.refreshToken]) {
        assert.equal(exposed.includes(token),false);
        for(const file of await fs.readdir(directory)) assert.equal((await fs.readFile(path.join(directory,file),'utf8')).includes(token),false);
      }
    });
    await check('page reload restores the shared account session',async()=>{
      await reload(); await wait("!!document.querySelector('.account-summary') && !!document.querySelector('.header .avatar')",'reload session');
    });
  } else if(config.phase==='restore') {
    await check('full Electron restart restores DPAPI session after access expiration',async()=>{
      await wait("!!document.querySelector('.account-summary') && !!document.querySelector('.header .avatar')",'restart restore');
      assert.match(await js("document.querySelector('.account-summary').textContent"),/桌面隔离测试用户/);
    });
    await check('shared logout revokes the local API session and clears the encrypted vault',async()=>{
      await js("document.querySelector('.account-summary .button').click()");
      await wait("!!document.querySelector('.account-form') && !document.querySelector('.header .avatar')",'logout');
      assert.equal((await js("window.mooyuDesktop.account.call('state',[])")).value.authenticated,false);
      assert.equal((await fs.readdir(path.join(config.profileRoot,'account-vault'))).length,0);
    });
  } else {
    await check('signed-out state survives a full process restart without restoring old tokens',async()=>{
      await wait("!!document.querySelector('.account-form') && !document.querySelector('.header .avatar')",'signed-out restart');
      assert.equal((await js("window.mooyuDesktop.account.call('state',[])")).value.authenticated,false);
    });
  }
  await check('account bridge rejects arbitrary requests and leaves renderer isolation intact',async()=>{
    assert.equal((await js("window.mooyuDesktop.account.call('fetch',['https://mooyu.fun'])")).ok,false);
    assert.equal(await js("typeof require+':'+typeof process"),'undefined:undefined');
    assert.equal(await js("fetch('https://mooyu.fun/v1/me').then(()=>false,()=>true)"),true);
  });
  await capture(config.report.replace('.json','.png'));
  await fs.writeFile(config.report,JSON.stringify({ok:true,phase:config.phase,checks},null,2));
  app.quit();
}
run().catch(async error=>{
  // Do not dump form values, OTP, response bodies or credentials on failure.
  if(config?.report) await fs.writeFile(config.report,JSON.stringify({ok:false,checks,error:error.message},null,2));
  process.stderr.write('ACCOUNT_ACCEPTANCE_FAILED '+error.message+'\n'); app.exit(1);
});
