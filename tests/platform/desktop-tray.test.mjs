import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {createDesktopTray} from '../../apps/desktop/electron/tray.cjs';

function fixture(t,{failure=false,menuFailure=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-tray-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let icon,menu,quits=0,checks=0;
  const window={visible:true,minimized:false,destroyed:false,focusCount:0,isDestroyed(){return this.destroyed;},isMinimized(){return this.minimized;},restore(){this.minimized=false;},minimize(){this.minimized=true;},show(){this.visible=true;},hide(){this.visible=false;},focus(){this.focusCount++;}};
  class Tray extends EventEmitter {
    constructor(file){super();if(failure)throw Error('native tray unavailable');this.file=file;this.dead=false;icon=this;}
    setToolTip(value){this.tooltip=value;}setContextMenu(value){menu=value;}isDestroyed(){return this.dead;}destroy(){this.dead=true;}
  }
  const app=new EventEmitter();app.quit=()=>{quits++;app.emit('before-quit');};
  const controller=createDesktopTray({app,Tray,Menu:{buildFromTemplate:value=>{if(menuFailure)throw Error('menu unavailable');return value;}},dialog:{showMessageBox(){throw Error('UNEXPECTED_CLOSE_DIALOG');}},assetRoot:directory,getWindow:()=>window,onCheckUpdates:()=>{assert.equal(window.visible,true);checks++;}});
  t.after(()=>controller.dispose());
  return {directory,window,app,controller,menu,icon,get quits(){return quits;},get checks(){return checks;},event(){return {prevented:false,preventDefault(){this.prevented=true;}};}};
}

test('every native close hides to tray immediately without a prompt or preference writes',t=>{
  const f=fixture(t);assert.equal(f.controller.state().closeBehavior,'tray');
  for(let i=0;i<2;i++){f.controller.restore();const event=f.event();f.controller.close(event);assert.equal(event.prevented,true);assert.equal(f.window.visible,false);}
  assert.equal(f.quits,0);assert.deepEqual(fs.readdirSync(f.directory),[]);
});

test('legacy unshipped close preferences cannot restore a close prompt or exit-on-close',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.directory,'desktop-preferences.json'),JSON.stringify({schemaVersion:1,closeBehavior:'quit'}));
  f.controller.close(f.event());assert.equal(f.window.visible,false);assert.equal(f.quits,0);
});

test('tray click and double-click restore the same minimized or hidden window',t=>{
  const f=fixture(t);f.controller.close(f.event());f.window.minimized=true;
  f.icon.emit('click');assert.equal(f.window.visible,true);assert.equal(f.window.minimized,false);
  f.window.hide();f.icon.emit('double-click');assert.equal(f.window.visible,true);
  assert.ok(f.icon.file.endsWith(path.join('desktop-icons','mooyu.ico')));
});

test('tray Check for updates restores the window before requesting the update panel',t=>{
  const f=fixture(t);f.window.hide();f.menu[1].click();assert.equal(f.checks,1);
});

test('tray update action cannot start another check while installation is exiting',t=>{
  const app=new EventEmitter();let panelRequests=0;
  class Tray extends EventEmitter {setToolTip(){}setContextMenu(){}isDestroyed(){return false;}destroy(){}}
  const window={isDestroyed:()=>false,isMinimized:()=>false,show(){},focus(){}};
  const tray=createDesktopTray({app,Tray,Menu:{buildFromTemplate:value=>value},assetRoot:os.tmpdir(),getWindow:()=>window,
    updates:{state:()=>({status:'installing'}),run(){assert.fail('must not reset installation');}},onCheckUpdates(){panelRequests++;}});
  t.after(()=>tray.dispose());tray.checkForUpdates();assert.equal(panelRequests,1);
});

test('explicit tray exit and app.quit used by update installation bypass hide-on-close',t=>{
  const f=fixture(t);f.menu.at(-1).click();assert.equal(f.quits,1);
  const event=f.event();f.controller.close(event);assert.equal(event.prevented,false);
  f.app.emit('will-quit');assert.equal(f.icon.isDestroyed(),true);
});

test('cancelling an unsaved-page exit restores normal tray closing',t=>{
  const f=fixture(t);f.controller.quit();f.controller.cancelQuit();const event=f.event();f.controller.close(event);
  assert.equal(event.prevented,true);assert.equal(f.window.visible,false);
});

test('system session ending bypasses hiding',t=>{
  const f=fixture(t);f.controller.markQuitting();const event=f.event();f.controller.close(event);assert.equal(event.prevented,false);
});

for(const options of [{failure:true},{menuFailure:true}])test('tray failure minimizes to the taskbar instead of stranding a hidden window: '+JSON.stringify(options),t=>{
  const f=fixture(t,options),event=f.event();assert.equal(f.controller.state().trayAvailable,false);
  f.controller.close(event);assert.equal(event.prevented,true);assert.equal(f.window.visible,true);assert.equal(f.window.minimized,true);
  assert.equal(f.controller.state().closeBehavior,'minimize');if(f.icon)assert.equal(f.icon.dead,true);
});

test('disposing prevents late tray actions from restoring the window or checking updates',t=>{
  const f=fixture(t);f.window.hide();f.controller.dispose();f.controller.restore();f.controller.checkForUpdates();f.controller.quit();
  assert.equal(f.window.visible,false);assert.equal(f.checks,0);assert.equal(f.quits,0);
});
