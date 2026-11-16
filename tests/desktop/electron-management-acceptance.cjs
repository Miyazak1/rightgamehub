const fs=require('node:fs/promises'),assert=require('node:assert/strict'),path=require('node:path');
const {app}=require('electron'),{createShell}=require('../../apps/desktop/electron/main.cjs');
let window,config;const checks=[];
const js=s=>window.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(source,label){const until=Date.now()+25000;while(Date.now()<until){if(await js(source))return;await delay(100);}throw Error('WAIT_FAILED '+label+': '+(await js('document.body.innerText')).slice(-1800));}
async function route(value){await window.loadURL('mooyu-app://client'+value);}
async function run(){
 config=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--config')+1],'utf8'));
 const shell=await createShell({...config,visible:false});window=await shell.createWindow('/account');
 window.webContents.on('console-message',event=>{if(event.message)console.error('RENDERER '+event.message);});
 await wait('!!document.querySelector(".account-form")','account');
 const challenge=await js("window.mooyuDesktop.account.call('createChallenge',[{email:'management-acceptance@example.test'}])");assert.equal(challenge.ok,true);
 const code=(await fs.readFile(config.codeFile,'utf8')).trim();
 const login=await js(`window.mooyuDesktop.account.call('verifyChallenge',[${JSON.stringify({challengeId:challenge.value.data.challengeId,code})}])`);assert.equal(login.ok,true);
 if(config.checkDenied){
   await route('/admin');await wait('!!document.querySelector(".state-panel")','server authorization refusal');
   assert.equal(await js('!!document.querySelector(".admin-overview-cards,.analytics-kpis")'),false);
   checks.push('server authorization refusal wins over renderer admin profile and shows no fabricated zero statistics');
   await fs.writeFile(config.report,JSON.stringify({passed:true,checks,productionConnected:false},null,2));window.destroy();app.quit();return;
 }
 await route('/creator');await wait('!!document.querySelector(".creator-page")','creator overview');
 assert.equal(await js("document.body.innerText.includes('暂时无法载入创作中心')"),false);checks.push('native creator overview loads authenticated server data');
 await route('/creator/works');await wait("document.body.innerText.includes('桌面管理验收作品')",'creator works');checks.push('native creator work library lists actual API works');
 await route('/admin');await wait('!!document.querySelector(".admin-overview-cards")','admin overview');checks.push('native admin overview loads analytics, storage and governance counts');
 await route('/admin?panel=governance');await wait("document.body.innerText.includes('治理验收待审作品')",'governance report');
 assert.equal(await js("document.body.innerText.includes('此桌面版本尚未接通')"),false);checks.push('native governance reads authenticated report and moderation APIs');
 await js("(()=>{const el=document.querySelector('.report-card textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'隔离验收：已核对，可驳回。');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await js("[...document.querySelectorAll('.report-card button')].find(el=>el.textContent==='驳回举报').click()");
 await wait("document.body.innerText.includes('队列已清空')",'moderation decision');checks.push('native governance submits a deliberate decision and refreshes the actual server queue');
 await js("(()=>{const input=document.createElement('input');input.type='file';input.id='management-upload-file';document.body.append(input);})()");
 window.webContents.debugger.attach('1.3');const dom=await window.webContents.debugger.sendCommand('DOM.getDocument');
 const input=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#management-upload-file'});
 await window.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[config.uploadFile]});window.webContents.debugger.detach();
 const uploaded=await js(`(async()=>{const{createDesktopBusinessApi}=await import('mooyu-app://client/management-probe.js');const api=createDesktopBusinessApi(window.mooyuDesktop.account,${JSON.stringify(config.accountApiOrigin)},window.mooyuDesktop.files);return api.uploadContent('upload-one',document.querySelector('#management-upload-file').files[0],'selected-grant');})()`);
 assert.equal(uploaded.data.receivedBytes,(await fs.stat(config.uploadFile)).size);checks.push('native selected-file upload crosses preload and streams through authenticated main transport');
 const fake=await js("window.mooyuDesktop.files.registerUpload(new File(['fake'],'fake.zip')).catch(()=>({ok:false}))");assert.equal(fake.ok,false);checks.push('fabricated File objects cannot grant filesystem access');
 await fs.writeFile(config.report,JSON.stringify({passed:true,checks,productionConnected:false},null,2));window.destroy();app.quit();
}
run().catch(async error=>{console.error(error.stack);if(config?.report)await fs.writeFile(config.report,JSON.stringify({passed:false,error:error.stack,checks},null,2));window?.destroy();app.exit(1);});
