// Test-only installed entry. Never selected by the deliverable preview build.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {app}=require('electron');
const {createShell}=require('../../apps/desktop/electron/main.cjs');
let window,config;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{const until=Date.now()+25000;while(!await fn()){if(Date.now()>until)throw Error('INSTALL_ACCEPTANCE_TIMEOUT: '+label);await delay(100);}};
const js=s=>window.webContents.executeJavaScript(s,true);
async function run(){
  if(process.argv.length!==3||process.argv[1]!=='--acceptance-config'||!path.isAbsolute(process.argv[2]))throw Error('ACCEPTANCE_CONFIG_REQUIRED');
  config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const url=new URL(config.accountApiOrigin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!path.isAbsolute(config.profileRoot)||config.accountEnvironment!=='local-test')throw Error('LOCAL_ACCEPTANCE_ONLY');
  const shell=await createShell({assetRoot:path.join(app.getAppPath(),'web'),profileRoot:config.profileRoot,accountApiOrigin:url.origin,accountEnvironment:'local-test',visible:config.hold===true});
  window=await shell.createWindow('/account?lang=zh-CN');
  const checks=[];
  await wait(()=>js('!!document.querySelector(".account-form,.account-summary")'),'shared account page');checks.push('installed shared renderer started');
  const env=await js('window.mooyuDesktop.environment()');assert.equal(env.version,app.getVersion());assert.equal(env.accountApiOrigin,url.origin);
  if(config.phase==='seed'){
    const result=await js(`window.mooyuDesktop.account.call('createChallenge',[{email:'installer-fixture@example.test',locale:'zh-CN'}])`);assert.equal(result.ok,true);
    const code=(await fs.readFile(config.mailbox,'utf8')).trim();
    assert.equal((await js(`window.mooyuDesktop.account.call('verifyChallenge',[${JSON.stringify({challengeId:result.value.data.challengeId,code})}])`)).ok,true);
    const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await loaded;
  }
  await wait(()=>js('!!document.querySelector(".account-summary")'),'persisted profile');
  assert.match(await js('document.querySelector(".account-summary").textContent'),/桌面隔离测试用户/);checks.push('same isolated account restored from Windows DPAPI');
  const scope={origin:url.origin,owner:'user:31e033b2-13d6-4b81-b214-21b3f25dca60',workId:'d7b00000-0000-4000-8000-000000000003',channel:'production',namespace:'installer',slot:'progress'};
  const save=await js(`(async()=>{const {createIndexedDbSaveStore}=await import('mooyu-app://client/install-save-probe.js');const store=createIndexedDbSaveStore();const scope=${JSON.stringify(scope)};if(${config.phase==='seed'}){if(!await store.compareAndSwap(scope,0,{format:1,progress:{chapter:3,score:42}}))throw Error('SAVE_SEED_FAILED');localStorage.setItem('mooyu.installer.preference','retained');}const row=await store.read(scope);await store.close();return {row,preference:localStorage.getItem('mooyu.installer.preference')};})()`);
  assert.deepEqual(save.row,{version:1,value:{format:1,progress:{chapter:3,score:42}}});assert.equal(save.preference,'retained');checks.push('real IndexedDB save and local preferences retained');
  const vault=await fs.readdir(path.join(config.profileRoot,'account-vault'));assert.ok(vault.some(f=>f.endsWith('.dpapi')));checks.push('OS-encrypted account vault present outside installation');
  const result={passed:true,phase:config.phase,version:app.getVersion(),checks,productionConnected:false,profileRoot:config.profileRoot};
  await fs.writeFile(config.report,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,profileRoot:undefined}));
  if(config.hold){window.show();return;}
  window.destroy();app.quit();
}
run().catch(async error=>{console.error(error.stack);if(config?.report)await fs.writeFile(config.report,JSON.stringify({passed:false,error:error.message}));window?.destroy();app.exit(1);});
