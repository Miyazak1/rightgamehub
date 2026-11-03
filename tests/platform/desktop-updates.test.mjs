import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {canonicalUpdate,updateKeyId,updateTrust,verifyUpdateEnvelope,fetchUpdateEnvelope} from '../../apps/desktop/src/update-manifest.mjs';
import {isNewerUpdate} from '../../apps/desktop/src/update-version.mjs';
import {createDesktopUpdater} from '../../apps/desktop/src/update-service.mjs';
import {createUpdateEngine} from '../../apps/desktop/src/update-engine.cjs';
import {prepareDesktopUpdate} from '../../scripts/prepare-desktop-updates.mjs';
import {prepareUpdateHandoff} from '../../apps/desktop/src/update-handoff.mjs';
import {createDesktopTray} from '../../apps/desktop/electron/tray.cjs';

function signedFixture(origin='http://127.0.0.1:31234',bytes=Buffer.from('MZ isolated test installer, never execute')){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),version='0.2.0-preview.5',now=Date.now();
  const key={id:updateKeyId(publicKey),publicKey:publicKey.export({type:'spki',format:'pem'}).toString()};
  const configuration={schemaVersion:1,channel:'preview',feed:origin+'/downloads/desktop/updates/preview.json',keys:[key]};
  const payload={schemaVersion:1,product:'mooyu-desktop-acceptance',platform:'windows',arch:'x64',channel:'preview',version,releasedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),installer:{path:`/downloads/desktop/${version}/MooyuWorkshop-${version}-x64-Setup.exe`,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),exeSha256:crypto.createHash('sha256').update(bytes).digest('hex'),sha512:crypto.createHash('sha512').update(bytes).digest('base64')}};
  const sign=p=>({keyId:key.id,payload:p,signature:crypto.sign(null,Buffer.from(canonicalUpdate(p)),privateKey).toString('base64')});
  return {bytes,key,privateKey,configuration,payload,sign,envelope:sign(payload),trust:updateTrust(configuration,{localTest:true})};
}
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-update-'));t.after(async()=>{assert.ok(directory.startsWith(path.join(os.tmpdir(),'mooyu-update-')));await fs.rm(directory,{recursive:true,force:true});});
  let f,mode='normal',downloads=0;
  const server=http.createServer((request,response)=>{
    assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.cookie,undefined);
    if(request.url.includes('/updates/')){if(mode==='withdraw'){response.writeHead(404);response.end();return;}response.setHeader('Content-Type','application/json');response.end(JSON.stringify(f.envelope));}
    else {downloads++;if(mode==='redirect'){response.writeHead(302,{Location:'https://production-must-not-be-contacted.invalid/'});response.end();}else response.end(mode==='corrupt'?Buffer.from('not an installer'):f.bytes);}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  f=signedFixture('http://127.0.0.1:'+server.address().port);
  const appRoot=path.join(directory,'app'),profileRoot=path.join(directory,'profile');await fs.mkdir(appRoot);await fs.mkdir(profileRoot);
  await fs.writeFile(path.join(appRoot,'build-info.json'),JSON.stringify({updaterCacheDirName:'isolated-updates'}));
  await fs.writeFile(path.join(profileRoot,'session-sentinel'),'retained');
  const app=new EventEmitter();let installs=0,quits=0,engine,busy=false,allow=true,cancelQuit=false,tray,panelRequests=0;
  const window={visible:false,isDestroyed:()=>false,isMinimized:()=>false,show(){this.visible=true;},focus(){},hide(){throw Error('UPDATE_HIDDEN_INSTEAD_OF_EXIT');}};
  Object.assign(app,{getVersion:()=> '0.2.0-preview.4',getPath:()=>path.join(appRoot,'app.exe'),whenReady:async()=>{},quit(){quits++;app.emit('before-quit');if(cancelQuit){controller.cancelInstall();tray.cancelQuit();return;}const event={preventDefault(){throw Error('TRAY_BLOCKED_UPDATE_EXIT');}};tray.close(event);app.emit('will-quit');app.emit('quit');}});
  const controller=await createDesktopUpdater({configuration:f.configuration,localTest:true,app,appRoot,profileRoot,engineFactory:options=>{engine=createUpdateEngine(options);return engine;},prepareInstall:async()=>()=>{installs++;},confirmInstall:async()=>allow,isBusy:()=>busy});
  app.once('will-quit',()=>controller.dispose());t.after(()=>controller.dispose());
  class Tray extends EventEmitter {setToolTip(){}setContextMenu(){}isDestroyed(){return !!this.dead;}destroy(){this.dead=true;}}
  tray=createDesktopTray({app,Tray,Menu:{buildFromTemplate:value=>value},assetRoot:appRoot,updates:controller,getWindow:()=>window,onCheckUpdates(){assert.equal(window.visible,true);panelRequests++;}});
  t.after(()=>tray.dispose());
  return {...f,directory,appRoot,profileRoot,controller,tray,window,get panelRequests(){return panelRequests;},get installer(){return engine.installerPath;},get installs(){return installs;},get quits(){return quits;},get downloads(){return downloads;},mode:value=>mode=value,busy:value=>busy=value,confirm:value=>allow=value,cancelQuit:value=>cancelQuit=value};
}
test('signed metadata binds product, channel, platform, canonical same-origin path, hashes and expiry',()=>{
  const f=signedFixture();assert.equal(verifyUpdateEnvelope(f.envelope,f.trust).payload.version,f.payload.version);
  assert.throws(()=>updateTrust(f.configuration),/UNTRUSTED/);
  assert.throws(()=>updateTrust({...f.configuration,feed:'https://mooyu.fun/downloads/desktop/updates/preview.json'},{localTest:true}),/UNTRUSTED/);
  for(const change of [{platform:'linux'},{product:'mooyu-desktop'},{channel:'stable'},{expiresAt:new Date(0).toISOString()},{installer:{...f.payload.installer,path:'https://evil.test/a.exe'}},{installer:{...f.payload.installer,path:'/downloads/desktop/../private.exe'}}])assert.throws(()=>verifyUpdateEnvelope(f.sign({...f.payload,...change}),f.trust),/UNTRUSTED/);
  assert.throws(()=>verifyUpdateEnvelope({...f.envelope,payload:{...f.payload,version:'0.2.0-preview.6'}},f.trust),/UNTRUSTED/);
  assert.throws(()=>verifyUpdateEnvelope({...f.envelope,keyId:'unknown'},f.trust),/UNTRUSTED/);
  assert.throws(()=>updateTrust({...f.configuration,feed:'https://mooyu.fun/downloads/desktop/updates/preview.json?secret=1'}),/UNTRUSTED/);
});
test('metadata transport refuses HTML fallback, redirects and oversized feeds',async()=>{
  const f=signedFixture();for(const response of [new Response('<html>',{headers:{'content-type':'text/html'}}),new Response('x'.repeat(32769),{headers:{'content-type':'application/json'}})])await assert.rejects(fetchUpdateEnvelope(async()=>response,f.trust));
  await assert.rejects(fetchUpdateEnvelope(async()=>({ok:true,redirected:true}),f.trust));
});
test('preview ordering is numeric and never treats stable or older versions as an upgrade',()=>{
  assert.equal(isNewerUpdate('0.2.0-preview.10','0.2.0-preview.2'),true);assert.equal(isNewerUpdate('0.2.0-preview.2','0.2.0-preview.10'),false);assert.equal(isNewerUpdate('0.2.0-preview.10','0.2.0'),false);assert.equal(isNewerUpdate('0.2.0','0.2.0-preview.10'),true);assert.equal(isNewerUpdate('0.2.0','0.2.0'),false);
});
test('real NSIS engine checks and downloads over loopback, installs only after explicit confirmed quit, and preserves profile',async t=>{
  const f=await fixture(t);assert.equal((await f.controller.run('check')).status,'available');assert.equal((await f.controller.run('download')).status,'ready');assert.equal(f.installs,0);assert.equal(f.downloads,1);
  f.confirm(false);assert.equal((await f.controller.run('install')).status,'ready');assert.equal(f.quits,0);
  f.confirm(true);assert.equal((await f.controller.run('install')).status,'installing');assert.equal(f.installs,1);assert.equal(f.quits,1);assert.equal(await fs.readFile(path.join(f.profileRoot,'session-sentinel'),'utf8'),'retained');
});
test('tray checks restore the panel and retain a verified ready installer for confirmed installation',async t=>{
  const f=await fixture(t);
  await f.tray.checkForUpdates();assert.equal(f.controller.state().status,'available');
  await f.controller.run('download');const ready=f.controller.state(),installer=f.installer;
  for(let i=0;i<2;i++){
    f.window.visible=false;await f.tray.checkForUpdates();
    assert.equal(f.window.visible,true);assert.deepEqual(f.controller.state(),ready);assert.equal(f.installer,installer);
  }
  assert.equal(f.panelRequests,3);assert.equal(f.downloads,1);assert.equal(f.installs,0);
  assert.equal((await f.controller.run('install')).status,'installing');assert.equal(f.installs,1);assert.equal(f.quits,1);
});
test('tray check after a cancelled installation preserves readiness but cannot bypass final feed validation',async t=>{
  const f=await fixture(t);await f.tray.checkForUpdates();await f.controller.run('download');
  f.cancelQuit(true);assert.equal((await f.controller.run('install')).status,'ready');f.cancelQuit(false);
  await f.tray.checkForUpdates();assert.equal(f.controller.state().status,'ready');assert.equal(f.downloads,1);
  f.mode('withdraw');assert.equal((await f.controller.run('install')).status,'error');assert.equal(f.installs,0);assert.equal(f.quits,1);
});
for(const mode of ['corrupt','redirect'])test('download '+mode+' is rejected without quitting or executing',async t=>{const f=await fixture(t);await f.controller.run('check');f.mode(mode);assert.equal((await f.controller.run('download')).status,'error');assert.equal(f.quits,0);assert.equal(f.installs,0);});
for(const mode of ['cache','withdraw','busy'])test('install rejects '+mode+' without executing',async t=>{const f=await fixture(t);await f.controller.run('check');assert.equal((await f.controller.run('download')).status,'ready');if(mode==='cache')await fs.appendFile(f.installer,'tampered');if(mode==='withdraw')f.mode('withdraw');if(mode==='busy')f.busy(true);assert.equal((await f.controller.run('install')).status,'error');assert.equal(f.installs,0);assert.equal(f.quits,0);});
test('cancelled window close disarms installation and a later ordinary quit does not install',async t=>{const f=await fixture(t);await f.controller.run('check');await f.controller.run('download');f.cancelQuit(true);assert.equal((await f.controller.run('install')).status,'ready');f.cancelQuit(false);await f.controller.run('check');assert.equal(f.installs,0);});
test('duplicate checks share one operation and an unconfigured development build performs no network requests',async t=>{const f=await fixture(t);await Promise.all([f.controller.run('check'),f.controller.run('check')]);assert.equal(f.controller.state().status,'available');const disabled=await createDesktopUpdater({app:{getVersion:()=> '0.2.0-preview.4'},profileRoot:f.directory,fetchImpl:()=>{throw Error('must not run');}});assert.equal((await disabled.run('check')).status,'disabled');});
test('signed feed preparation requires an audited acceptance report and excludes private key material',async t=>{
  const f=await fixture(t),keyFile=path.join(f.directory,'test-key.pem'),reportFile=path.join(f.directory,'report.json'),installer=path.join(f.directory,'test.exe'),directory=path.join(f.directory,'distribution');
  await fs.writeFile(keyFile,f.privateKey.export({type:'pkcs8',format:'pem'}));await fs.writeFile(installer,f.bytes);
  const report={passed:true,acceptance:true,version:f.payload.version,installer,executable:installer,installerSha256:f.payload.installer.sha256,installerBytes:f.bytes.length,preArchiveAudit:{payloadAuditPassed:true},finalPayloadAudit:{payloadAuditPassed:true}};await fs.writeFile(reportFile,JSON.stringify(report));
  const result=await prepareDesktopUpdate({reportFile,keyFile,directory,acceptance:true});const text=await fs.readFile(result.feed,'utf8');assert.doesNotMatch(text,/PRIVATE KEY|test-key|profile|installerBytes/);assert.equal(verifyUpdateEnvelope(JSON.parse(text),f.trust).payload.version,f.payload.version);
  await assert.rejects(prepareDesktopUpdate({reportFile,keyFile,directory,acceptance:false}),/AUDITED/);await fs.appendFile(installer,'corrupt');await assert.rejects(prepareDesktopUpdate({reportFile,keyFile,directory,acceptance:true}),/INTEGRITY/);assert.equal(await fs.readFile(result.feed,'utf8'),text);
});
test('handoff rejects a modified packaged helper before creating an executable request',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.appRoot,'update-runner.exe'),'MZ test helper, never execute');
  await assert.rejects(prepareUpdateHandoff({app:{getAppPath:()=>f.appRoot,getPath:()=>path.join(f.appRoot,'client.exe')},profileRoot:f.profileRoot,installer:'not-used',payload:f.payload}),/HELPER_INTEGRITY/);
  assert.equal((await fs.readdir(path.join(f.profileRoot,'updates'))).some(file=>file.startsWith('runner-')),false);
});
test('no-install and cancelled checks cannot leave the controller locked',async t=>{
  const f=await fixture(t);await f.controller.run('download');assert.equal((await f.controller.run('check')).status,'available');await f.controller.run('cancel');assert.equal((await f.controller.run('check')).status,'available');
});
