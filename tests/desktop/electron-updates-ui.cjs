const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {app}=require('electron');
const {createShell}=require('../../apps/desktop/electron/main.cjs');
let window,server,config;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn,label){const until=Date.now()+20000;while(!await fn()){if(Date.now()>until)throw Error('UPDATE_UI_TIMEOUT: '+label);await delay(50);}}
async function run(){
  if(process.argv[2]!=='--config'||!path.isAbsolute(process.argv[3]))throw Error('LOCAL_UI_CONFIG_REQUIRED');
  config=JSON.parse(await fs.readFile(process.argv[3],'utf8'));
  if(!path.resolve(config.directory).includes(path.sep+'.runtime'+path.sep+'desktop-update-ui'+path.sep))throw Error('ISOLATED_UI_DIRECTORY_REQUIRED');
  const {canonicalUpdate,updateKeyId}=await import('../../apps/desktop/src/update-manifest.mjs');
  const bytes=Buffer.alloc(4*1024*1024,42);bytes.write('MZ');const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),version='0.2.0-preview.5',now=Date.now();
  const payload={schemaVersion:1,product:'mooyu-desktop-acceptance',platform:'windows',arch:'x64',channel:'preview',version,releasedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),installer:{path:`/downloads/desktop/${version}/MooyuWorkshop-${version}-x64-Setup.exe`,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),exeSha256:crypto.createHash('sha256').update(bytes).digest('hex'),sha512:crypto.createHash('sha512').update(bytes).digest('base64')}};
  server=http.createServer((req,res)=>{if(req.url.includes('/updates/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({payload,keyId:updateKeyId(publicKey),signature:crypto.sign(null,Buffer.from(canonicalUpdate(payload)),privateKey).toString('base64')}));}else{res.writeHead(200,{'Content-Length':bytes.length});let offset=0;const timer=setInterval(()=>{if(offset>=bytes.length){clearInterval(timer);res.end();return;}res.write(bytes.subarray(offset,offset+32768));offset+=32768;},20);res.on('close',()=>clearInterval(timer));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const appRoot=path.join(config.directory,'app');await fs.mkdir(appRoot);await fs.writeFile(path.join(appRoot,'build-info.json'),JSON.stringify({updaterCacheDirName:'ui-test'}));
  app.getVersion=()=> '0.2.0-preview.4';app.getAppPath=()=>appRoot;
  const shell=await createShell({assetRoot:config.assetRoot,profileRoot:path.join(config.directory,'profile'),visible:false,accountEnvironment:'local-test',updateTrust:{schemaVersion:1,channel:'preview',feed:`http://127.0.0.1:${server.address().port}/downloads/desktop/updates/preview.json`,keys:[{id:updateKeyId(publicKey),publicKey:publicKey.export({type:'spki',format:'pem'}).toString()}]}});
  window=await shell.createWindow('/discover?lang=zh-CN');window.showInactive();
  const js=script=>window.webContents.executeJavaScript(script,true);
  await wait(()=>js('!!document.querySelector("[data-desktop-menu]")'),'desktop menu');await js('document.querySelector("[data-desktop-menu]").click()');
  await wait(()=>js('!!document.querySelector("[role=menuitem]")'),'menu items');await js(`[...document.querySelectorAll('[role=menuitem]')].find(button=>button.textContent.includes('检查更新')).click()`);
  await wait(()=>js('document.querySelector(".desktop-update-info").open'),'update dialog');
  if(!config.automatic){await js(`[...document.querySelectorAll('.desktop-update-info button')].find(button=>button.textContent==='检查更新').click()`);
  await wait(async()=> (await shell.updates.state()).status==='available','available update');
  await delay(300);await fs.writeFile(path.join(config.directory,'available.png'),(await window.webContents.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('.desktop-update-info button')].find(button=>button.textContent==='下载更新').click()`);}
  await wait(async()=> (await shell.updates.state()).status==='downloading','download progress');await delay(300);
  await fs.writeFile(path.join(config.directory,'progress.png'),(await window.webContents.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('.desktop-update-info button')].find(button=>button.textContent==='取消下载').click()`);
  await wait(async()=> (await shell.updates.state()).code==='DESKTOP_UPDATE_CANCELLED','cancelled download');
  assert.ok(await js('document.querySelector(".desktop-update-info").open'));
  await delay(150);await fs.writeFile(path.join(config.directory,'cancelled.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(800,700);await delay(250);await fs.writeFile(path.join(config.directory,'narrow.png'),(await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(config.directory,'report.json'),JSON.stringify({passed:true,automaticStartupCheck:!!config.automatic,checks:['real update dialog','new version displayed','background progress','cancel returns to usable dialog','800px window'],productionConnected:false,installerExecuted:false},null,2));
  window.destroy();server.close();server.closeAllConnections();app.quit();
}
run().catch(async error=>{if(config)await fs.writeFile(path.join(config.directory,'report.json'),JSON.stringify({passed:false,error:error.stack}));console.error(error.stack);window?.destroy();server?.close();server?.closeAllConnections();app.exit(1);});
