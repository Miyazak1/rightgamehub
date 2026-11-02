const {app,BrowserWindow,session}=require('electron');const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {attachGameIoNavigation}=require('../../apps/desktop/electron/game-io-navigation.cjs');const file=process.argv[process.argv.indexOf('--config')+1];
let window,fixture,bridge;
const delay=ms=>new Promise(r=>setTimeout(r,ms));const wait=async fn=>{const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw Error('LOCAL_ELECTRON_WAIT_TIMEOUT');await delay(10);}};
async function run(){
 const config=JSON.parse(await fs.readFile(file,'utf8'));app.setPath('userData',config.profileRoot);await app.whenReady();
 window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await window.loadURL('data:text/html,'+encodeURIComponent('<iframe srcdoc="first local frame"></iframe>'));
 let retired=0;attachGameIoNavigation(window.webContents,()=>retired++);
 await window.webContents.executeJavaScript('document.querySelector("iframe").contentWindow.location.hash="tab"');await delay(120);assert.equal(retired,0);
 await window.webContents.executeJavaScript('document.querySelector("iframe").srcdoc="reloaded child"');await delay(120);assert.equal(retired,0);
 await window.webContents.executeJavaScript('history.pushState({},"","#main-route")');await wait(()=>retired===1);
 window.webContents.reload();await wait(()=>retired===2);
 const {createProxyWebSocketFixture}=await import('./proxy-websocket-fixture.mjs');const {createDesktopProxyResolver}=await import('../../apps/desktop/src/websocket-proxy.mjs');const {createDesktopRealtime}=await import('../../apps/desktop/src/realtime-bridge.mjs');
 fixture=await createProxyWebSocketFixture();const network=session.fromPartition('local-game-io-proxy-regression');await network.setProxy({proxyRules:fixture.proxyAddress,proxyBypassRules:'<-loopback>'});
 const selected=await network.resolveProxy('wss://127.0.0.1:9/v1/realtime');assert.ok(selected.includes(fixture.proxyAddress));
 const events=[];bridge=createDesktopRealtime({origin:fixture.origin,account:{gameContext:()=>()=>{},realtimeTicket:async()=>fixture.ticket(),receiveRealtime:()=>true},WebSocketImpl:fixture.TrustedFixtureSocket,getProxyRoute:createDesktopProxyResolver(network.resolveProxy.bind(network)),onEvent:e=>events.push(e)});
 bridge.call('open',{id:crypto.randomUUID(),workId:crypto.randomUUID()});await wait(()=>events.some(e=>e.type==='message'||e.type==='error'));assert.ok(events.some(e=>e.type==='message'));assert.equal(fixture.stats.connects,1);assert.equal(fixture.stats.connections,1);
 bridge.closeAll();await fixture.close();fixture=null;
 const report={passed:true,productionConnected:false,checks:['actual Electron child hash and child reload preserve game I/O','actual Electron main history/reload retire game I/O','Chromium proxy resolution drives required local WSS CONNECT tunnel'],retired,proxyTunnelConnections:1};await fs.writeFile(config.report,JSON.stringify(report,null,2));console.log(JSON.stringify(report));window.destroy();app.quit();
}
run().catch(async error=>{console.error(error.stack);bridge?.closeAll();await fixture?.close();window?.destroy();app.exit(1);});
