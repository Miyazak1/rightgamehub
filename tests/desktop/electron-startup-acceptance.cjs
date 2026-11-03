const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {app}=require('electron');
const started=performance.now();
// In a bundled test entry __filename also belongs to the shell dependency.
// Match installed-app argv shape so its development CLI does not auto-run.
process.argv[1]='--startup-acceptance';
const {createShell}=require('../../apps/desktop/electron/main.cjs');
let window,config;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn,label){const end=Date.now()+25000;while(!await fn()){if(Date.now()>end)throw Error('STARTUP_TIMEOUT: '+label);await delay(25);}}
async function run(){
  config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  if(!path.resolve(config.profileRoot).includes(path.sep+'.runtime'+path.sep+'desktop-startup-acceptance'+path.sep)||!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.accountApiOrigin))throw Error('ISOLATED_STARTUP_ONLY');
  let createdMs,readyToShowMs,startupObserved=false;
  app.on('browser-window-created',(_event,value)=>{window=value;createdMs=performance.now()-started;window.once('ready-to-show',()=>{readyToShowMs=performance.now()-started;});});
  const shell=await createShell({...config,visible:false,accountEnvironment:'local-test'});
  const shellMs=performance.now()-started;
  const loading=shell.createWindow('/account?lang=zh-CN');
  await wait(()=>window?.webContents.getURL().startsWith('mooyu-app:'),'window navigation');
  // The initial document exists while environment IPC is waiting on DPAPI.
  startupObserved=await window.webContents.executeJavaScript('!!document.querySelector(".desktop-startup")');
  await window.webContents.executeJavaScript('globalThis.__startupPrivateProbe={done:false};window.mooyuDesktop.account.call("getProfile",[]).then(result=>{globalThis.__startupPrivateProbe={done:true,ok:result.ok};});void 0;');
  const privateCallPending=await window.webContents.executeJavaScript('!globalThis.__startupPrivateProbe.done');
  assert.equal(privateCallPending,true,'Private bridge call must wait for credential recovery');
  if (startupObserved) {
    window.showInactive();
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(config.profileRoot,'starting.png'),(await window.webContents.capturePage()).toPNG());
  }
  await loading;
  await wait(()=>window.webContents.executeJavaScript('!!document.querySelector(".account-summary")'),'restored account');
  const js=script=>window.webContents.executeJavaScript(script,true);
  assert.match(await js('document.querySelector(".account-summary").textContent'),/桌面隔离测试用户/);
  await wait(()=>js('globalThis.__startupPrivateProbe.done'),'queued private read');
  assert.equal(await js('globalThis.__startupPrivateProbe.ok'),true);
  const rows=(await fs.readFile(path.join(config.profileRoot,'startup.ndjson'),'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.pid===process.pid);
  const events=rows.map(x=>x.event),visible=events.indexOf('hidden-window-created'),accountStart=events.indexOf('account-startup-started'),accountReady=events.indexOf('account-startup-ready');
  assert.ok(visible>=0&&accountStart>visible&&accountReady>accountStart,'Window must exist before credential recovery');
  assert.ok(events.indexOf('window-ready-to-show')<accountReady,'First paint must not wait for credential recovery');
  assert.ok(rows.every(x=>Number.isFinite(x.elapsedMs)));
  // Session restoration still uses OS-encrypted credentials and the real auth API.
  const state=await js('window.mooyuDesktop.account.call("state",[])');assert.equal(state.value.authenticated,true);
  window.showInactive();await delay(250);
  await fs.writeFile(path.join(config.profileRoot,'restored.png'),(await window.webContents.capturePage()).toPNG());
  const result={passed:true,shellMs,createdMs,readyToShowMs,restoredMs:performance.now()-started,startupObserved,privateCallPending,events:rows,productionConnected:false,realCredentialsUsed:false};
  await fs.writeFile(config.result,JSON.stringify(result,null,2));console.log(JSON.stringify(result));window.destroy();app.quit();
}
run().catch(async error=>{if(config)await fs.writeFile(config.result,JSON.stringify({passed:false,error:error.stack}));console.error(error.stack);window?.destroy();app.exit(1);});
