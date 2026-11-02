import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {installedDesktopConfig} from '../apps/desktop/src/installed-configuration.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32'||process.argv.length!==2)throw Error('WINDOWS_PREVIEW_CHECK_REQUIRED');
const packageReport=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-windows-package/latest.json')));
if(!packageReport.passed||packageReport.acceptance)throw Error('PREVIEW_PACKAGE_REQUIRED');
const dataRoot=path.join(process.env.APPDATA,'MooyuWorkshop'),exists=p=>fs.access(p).then(()=>true,()=>false);
// Real-user credentials must never be used by an anonymous installation smoke test.
if(await exists(dataRoot))throw Error('EXISTING_PRODUCT_DATA_NOT_TOUCHED');
const registry=()=>{const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -eq '墨鱼工坊' | Select-Object DisplayName,DisplayVersion,UninstallString) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true});const value=out.trim()?JSON.parse(out):null;return value==null?[]:Array.isArray(value)?value:[value];};
if(registry().length)throw Error('EXISTING_INSTALL_NOT_TOUCHED');
const parent=path.join(root,'.runtime/desktop-windows-preview');await fs.mkdir(parent,{recursive:true});const directory=await fs.mkdtemp(path.join(parent,'check-')),install=path.join(directory,'client');
const bytes=await fs.readFile(packageReport.installer);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),packageReport.installerSha256);
const report={passed:false,directory,installDirectory:install,version:packageReport.version,productionConnected:true,anonymousOnly:true,realCredentialsUsed:false,published:false,deployed:false};
async function run(exe,args,label,timeout=120000){return new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(exe,args,{cwd:directory,env,windowsHide:label!=='startup',stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);const timer=setTimeout(()=>{child.kill();reject(Error('PREVIEW_TIMEOUT: '+label));},timeout);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',async code=>{clearTimeout(timer);await fs.writeFile(path.join(directory,label+'.log'),output);code===0?resolve(output):reject(Error('PREVIEW_STEP_FAILED: '+label));});if(label==='startup')console.log(JSON.stringify({windowStarted:true,pid:child.pid,installDirectory:install}));});}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
  await run(packageReport.installer,['/S','/D='+install],'install');
  const rows=registry();assert.equal(rows.length,1);assert.equal(rows[0].DisplayVersion,packageReport.version);
  const executable=path.join(install,'MooyuWorkshop.exe');
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex'),crypto.createHash('sha256').update(await fs.readFile(packageReport.executable)).digest('hex'));
  assert.equal((await run(executable,['--version'],'version')).trim(),packageReport.version);
  // The visible window is checked read-only with computer-use, then Ctrl+Q quits.
  await run(executable,[],'startup',240000);
  const profile=installedDesktopConfig(process.env.APPDATA,install).profileRoot;
  const events=(await fs.readFile(path.join(profile,'startup.ndjson'),'utf8')).trim().split('\n').map(line=>JSON.parse(line).event);assert.ok(events.includes('window-loaded'));assert.ok(events.includes('visible-window-created'));
  assert.equal(await exists(path.join(profile,'account-vault')),false);
  const binding=JSON.parse(await fs.readFile(path.join(profile,'account-server.json')));assert.equal(binding.environment,'production');assert.equal(binding.origin,'https://mooyu.fun');
  const entry=(await fs.readdir(install)).find(f=>/^Uninstall .*\.exe$/.test(f));assert.ok(entry);
  await run(path.join(install,entry),['/S','/currentuser'],'uninstall');
  const until=Date.now()+30000;while((await exists(executable)||registry().length)&&Date.now()<until)await delay(200);
  assert.equal(await exists(executable),false);assert.equal(registry().length,0);assert.equal(await exists(profile),true);
  report.passed=true;report.profileRetained=true;report.installedExecutableMatchesPackage=true;report.startupEvents=events;
}catch(error){report.error=error.stack;process.exitCode=1;}
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(parent,'latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
