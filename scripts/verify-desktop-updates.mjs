import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createIsolatedAccountApi} from '../tests/desktop/account-api-fixture.mjs';
import {prepareDesktopUpdate} from './prepare-desktop-updates.mjs';
import {updateKeyId} from '../apps/desktop/src/update-manifest.mjs';

const reuse=process.argv.length===4&&process.argv[2]==='--reuse'?path.resolve(process.argv[3]):null;
if(process.argv.length!==2&&!reuse)throw Error('UPDATE_ACCEPTANCE_ARGUMENTS_INVALID');
if(process.platform!=='win32')throw Error('WINDOWS_ACCEPTANCE_REQUIRED');
const root=fileURLToPath(new URL('../',import.meta.url)),parent=path.join(root,'.runtime/desktop-update-acceptance');await fs.mkdir(parent,{recursive:true});
if(reuse&&!reuse.startsWith(parent+path.sep+'check-'))throw Error('REUSE_OUTSIDE_ACCEPTANCE_WORKSPACE');
const oldTrust=reuse?JSON.parse(await fs.readFile(path.join(reuse,'test-public-trust.json'))):null;
const directory=await fs.mkdtemp(path.join(parent,'check-')),install=path.join(directory,'安装 验证','client'),profile=path.join(directory,'profile'),mailbox=path.join(directory,'mailbox.txt');
const pointerDirectory=path.join(process.env.APPDATA,'MooyuWorkshopUpdateAcceptance'),pointer=path.join(pointerDirectory,'restart.json');
const exists=file=>fs.access(file).then(()=>true,()=>false),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(check,label)=>{const until=Date.now()+90000;while(!await check()){if(Date.now()>until)throw Error('UPDATE_ACCEPTANCE_TIMEOUT: '+label);await delay(250);}};
const registry=()=>{const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -eq '墨鱼工坊安装验收' | Select-Object DisplayName,DisplayVersion,UninstallString) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true});const value=text.trim()?JSON.parse(text):[];return value==null?[]:Array.isArray(value)?value:[value];};
if(await exists(pointerDirectory)||registry().length)throw Error('EXISTING_ACCEPTANCE_DATA_NOT_TOUCHED');
await fs.mkdir(pointerDirectory);await fs.mkdir(path.dirname(install),{recursive:true});
const report={passed:false,directory,installDirectory:install,profileRoot:profile,versions:['0.2.0-preview.4','0.2.0-preview.5'],productionConnected:false,realCredentialsUsed:false,published:false,deployed:false,checks:[]};
async function run(exe,args,label,timeout=240000){return new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>{child.kill();reject(Error('UPDATE_PROCESS_TIMEOUT: '+label));},timeout);child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',async code=>{clearTimeout(timer);await fs.writeFile(path.join(directory,label+'.log'),output);code===0?resolve():reject(Error('UPDATE_PROCESS_FAILED: '+label));});});}
const account=await createIsolatedAccountApi({onMail:code=>fs.writeFile(mailbox,code)});
const distribution=path.join(directory,'distribution');let feedRequests=0,downloadRequests=0;
const server=http.createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/downloads/desktop/updates/preview.json'){feedRequests++;if(feedRequests>=4)account.expireAccess();const bytes=await fs.readFile(path.join(distribution,'updates/preview.json'));res.writeHead(200,{'Content-Type':'application/json'});res.end(bytes);}else if(url.pathname==='/downloads/desktop/0.2.0-preview.5/MooyuWorkshop-0.2.0-preview.5-x64-Setup.exe'){downloadRequests++;const bytes=await fs.readFile(path.join(distribution,'0.2.0-preview.5/MooyuWorkshop-0.2.0-preview.5-x64-Setup.exe'));res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length});res.end(bytes);}else {res.writeHead(404);res.end();}}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>server.listen(oldTrust?Number(new URL(oldTrust.feed).port):0,'127.0.0.1',resolve));
const pair=reuse?{privateKey:crypto.createPrivateKey(await fs.readFile(path.join(reuse,'test-signing-key.pem')))}:crypto.generateKeyPairSync('ed25519');
const privateKey=pair.privateKey,publicKey=crypto.createPublicKey(privateKey),keyFile=path.join(directory,'test-signing-key.pem'),trustFile=path.join(directory,'test-public-trust.json');
const trust={schemaVersion:1,channel:'preview',feed:`http://127.0.0.1:${server.address().port}/downloads/desktop/updates/preview.json`,keys:[{id:updateKeyId(publicKey),publicKey:publicKey.export({type:'spki',format:'pem'}).toString()}]};
await fs.writeFile(keyFile,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});await fs.writeFile(trustFile,JSON.stringify(trust));
const configBase={accountApiOrigin:account.origin,accountEnvironment:'local-test',profileRoot:profile,mailbox};
async function phase(name,extra={}){const config=path.join(directory,name+'.json'),result=path.join(directory,name+'-result.json');await fs.writeFile(config,JSON.stringify({...configBase,phase:name==='seed'?'seed':'restore',report:result,...extra}));await run(path.join(install,'MooyuWorkshopAcceptance.exe'),['--acceptance-config',config],name);const data=JSON.parse(await fs.readFile(result));assert.equal(data.passed,true);return data;}
async function cleanup(){const rows=registry();if(!rows.length)return;assert.equal(rows.length,1);assert.ok(rows[0].UninstallString.includes(install));const name=(await fs.readdir(install)).find(file=>/^Uninstall .*\.exe$/.test(file));assert.ok(name);await run(path.join(install,name),['/S'],'uninstall');await wait(()=>registry().length===0,'acceptance uninstall');}
try{
  for(const version of report.versions){if(reuse){const old=JSON.parse(await fs.readFile(path.join(reuse,version+'-package.json')));assert.equal(old.passed,true);assert.equal(old.acceptance,true);assert.equal(old.version,version);for(const file of old.overlay)assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(root,file.file))).digest('hex'),file.sha256);await fs.writeFile(path.join(directory,version+'-package.json'),JSON.stringify(old));continue;}console.log(JSON.stringify({phase:'building-isolated-installer',version}));await run(process.execPath,['scripts/package-desktop-windows.mjs','--version',version,'--acceptance','true','--update-config',trustFile],'build-'+version,360000);const built=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-windows-package/acceptance-latest.json')));assert.equal(built.passed,true);assert.equal(built.acceptance,true);assert.equal(built.version,version);await fs.writeFile(path.join(directory,version+'-package.json'),JSON.stringify(built));}
  const before=JSON.parse(await fs.readFile(path.join(directory,report.versions[0]+'-package.json'))),after=JSON.parse(await fs.readFile(path.join(directory,report.versions[1]+'-package.json')));
  await prepareDesktopUpdate({reportFile:path.join(directory,report.versions[1]+'-package.json'),keyFile,directory:distribution,acceptance:true});
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(before.installer)).digest('hex'),before.installerSha256);
  await run(before.installer,['/S','/D='+install],'initial-install');assert.equal(registry()[0].DisplayVersion,report.versions[0]);
  report.seed=await phase('seed');report.checks.push('v4 installed; isolated DPAPI session and real IndexedDB save seeded');
  const restartResult=path.join(directory,'automatic-restart-result.json'),screenshot=path.join(directory,'updates.png');
  await fs.writeFile(pointer,JSON.stringify({...configBase,phase:'restore',report:restartResult,screenshot,updateTrust:trust}));
  report.beforeUpdate=await phase('apply',{updateTrust:trust,updatePhase:'apply'});
  await wait(()=>exists(restartResult),'NSIS automatic restart');await wait(()=>exists(screenshot),'updated window screenshot');
  report.restarted=JSON.parse(await fs.readFile(restartResult));assert.equal(report.restarted.passed,true);assert.equal(report.restarted.version,report.versions[1]);assert.equal(registry()[0].DisplayVersion,report.versions[1]);assert.equal(downloadRequests,1);
  report.checks.push('authenticated installer downloaded by real NSIS updater, installed after confirmed app quit, and new executable restarted with --updated');
  report.checks.push('same DPAPI account, IndexedDB chapter/score and local preference restored by the restarted v5 application');
  await delay(750);await cleanup();report.checks.push('only acceptance installation removed; isolated profile retained');report.passed=true;report.refreshCount=account.refreshCount;assert.ok(report.refreshCount>=1);report.feedRequests=feedRequests;report.downloadRequests=downloadRequests;report.screenshot=screenshot;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  try{await cleanup();}catch(error){report.cleanupError=error.message;report.passed=false;process.exitCode=1;}
  await account.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  await fs.rm(pointer,{force:true});await fs.rmdir(pointerDirectory);await fs.rm(mailbox,{force:true});
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(parent,'latest.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));
