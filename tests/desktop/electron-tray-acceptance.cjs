const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {app,dialog}=require('electron');
process.argv[1]='--tray-acceptance';
const {createShell}=require('../../apps/desktop/electron/main.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let window,config;
async function wait(fn,label){const end=Date.now()+180000;while(!await fn()){if(Date.now()>end)throw Error('TRAY_TIMEOUT: '+label);await delay(60);}}
async function run(){
  config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  if(!path.resolve(config.profileRoot).includes(path.sep+'.runtime'+path.sep+'desktop-tray-acceptance'+path.sep))throw Error('ISOLATED_TRAY_ONLY');
  let prompts=0;dialog.showMessageBox=async()=>{prompts++;throw Error('UNEXPECTED_NATIVE_DIALOG');};
  const shell=await createShell({assetRoot:config.assetRoot,profileRoot:config.profileRoot,visible:true});
  if(config.phase==='explicit-exit')shell.desktopTray.checkForUpdates();
  window=await shell.createWindow('/discover?lang=zh-CN');
  window.webContents.on('page-title-updated',event=>event.preventDefault());window.setTitle('墨鱼工坊 · 托盘本地验收');
  const js=source=>window.webContents.executeJavaScript(source,true),checks=[];
  await wait(()=>js('!!document.querySelector("[data-desktop-menu]")'),'shared desktop UI');window.showInactive();await wait(()=>window.isVisible(),'initial visible window');
  assert.equal(shell.desktopTray.state().trayAvailable,true);assert.equal(shell.desktopTray.state().closeBehavior,'tray');checks.push('native Windows tray created with existing logo');
  const finish={passed:false,phase:config.phase,checks,productionConnected:false,realCredentialsUsed:false,nativeClose:!!config.nativeClose};
  app.once('will-quit',()=>{finish.trayDestroyed=!shell.desktopTray.state().trayAvailable;finish.nativeDialogs=prompts;require('node:fs').writeFileSync(config.result,JSON.stringify(finish,null,2));});
  if(config.phase==='initial'){
    await fs.writeFile(path.join(config.profileRoot,'native-ready.json'),JSON.stringify({title:window.getTitle(),stage:'close-window',pid:process.pid}));
    if(!config.nativeClose)window.close();
    await wait(()=>!window.isVisible(),'close hides directly');assert.equal(prompts,0);checks.push('first close hides directly without a native dialog');
    await fs.writeFile(path.join(config.profileRoot,'native-hidden.json'),JSON.stringify({stage:'restore-from-tray'}));
    if(!config.native)shell.desktopTray.restore();
    await wait(()=>window.isVisible(),'restore from tray');checks.push('same hidden window restored');
    if(!config.native)shell.desktopTray.checkForUpdates();
    await wait(()=>js('!!document.querySelector(".desktop-update-info")?.open'),'tray update panel');
    const updateText=await js('document.querySelector(".desktop-update-info").textContent');assert.match(updateText,/本地开发预览/);assert.doesNotMatch(updateText,/当前版本：\s*44\.4\.5/);assert.match(updateText,/本地预览未接入正式更新源/);
    await delay(200);await fs.writeFile(path.join(config.profileRoot,'update-panel.png'),(await window.webContents.capturePage()).toPNG());
    checks.push('tray updates open the shared panel with an accurate development identity');await js('document.querySelector(".desktop-update-info").close()');
    await js('document.querySelector("[data-desktop-menu]").click()');assert.equal(await js('[...document.querySelectorAll("[role=menuitem]")].some(x=>/窗口与托盘|退出墨鱼工坊/.test(x.textContent))'),false);await js('document.querySelector("[data-desktop-menu]").click()');
    window.hide();app.emit('second-instance');assert.equal(window.isVisible(),true);checks.push('second launch restores the same window');
    checks.push('Ctrl+Q completely exits');finish.passed=true;window.focus();window.webContents.sendInputEvent({type:'keyDown',keyCode:'Q',modifiers:['control']});
  }else if(config.phase==='restore'){
    window.close();await wait(()=>!window.isVisible(),'close after restart');assert.equal(prompts,0);shell.desktopTray.restore();checks.push('after restart close still hides directly without configuration');
    finish.passed=true;shell.desktopTray.quit();
  }else{
    await wait(()=>js('!!document.querySelector(".desktop-update-info")?.open'),'early tray update request');checks.push('early tray update request survives renderer initialization');
    checks.push('tray Quit bypasses hide-on-close');finish.passed=true;shell.desktopTray.quit();
  }
}
run().catch(async error=>{if(config)await fs.writeFile(config.result,JSON.stringify({passed:false,error:error.stack}));console.error(error.stack);window?.destroy();app.exit(1);});
