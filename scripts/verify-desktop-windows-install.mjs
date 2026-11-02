import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createIsolatedAccountApi} from '../tests/desktop/account-api-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),options={};
for(let i=2;i<process.argv.length;i+=2){if(!['--previous','--current','--hold'].includes(process.argv[i])||!process.argv[i+1])throw Error('INSTALL_TEST_OPTIONS_INVALID');options[process.argv[i]]=process.argv[i+1];}
if(process.platform!=='win32'||!options['--previous']||!options['--current'])throw Error('TWO_WINDOWS_ACCEPTANCE_REPORTS_REQUIRED');
const before=JSON.parse(await fs.readFile(options['--previous'],'utf8')),after=JSON.parse(await fs.readFile(options['--current'],'utf8'));
for(const r of [before,after])if(!r.passed||!r.acceptance||r.sourceCommit!=='0f20ae59d3054bccfbcd65576cd7429e843b8c3d')throw Error('ACCEPTANCE_REPORT_INVALID');
if(before.version===after.version)throw Error('DISTINCT_UPGRADE_VERSION_REQUIRED');
const parent=path.join(root,'.runtime/desktop-windows-install');await fs.mkdir(parent,{recursive:true});const directory=await fs.mkdtemp(path.join(parent,'check-'));
const install=path.join(directory,'安装 验证','client'),profile=path.join(directory,'user-data','profile'),mailbox=path.join(directory,'mailbox.txt');
const inside=(base,target)=>{const r=path.relative(base,target);return r&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
if(!inside(directory,install)||!inside(directory,profile)||inside(install,profile))throw Error('UNSAFE_TEST_PATH');
await fs.mkdir(path.dirname(install),{recursive:true});
const exists=p=>fs.access(p).then(()=>true,()=>false),delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{const until=Date.now()+30000;while(!await fn()){if(Date.now()>until)throw Error('INSTALL_WAIT_TIMEOUT: '+label);await delay(200);}};
const registry=()=>{const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -eq '墨鱼工坊安装验收' | Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString,PSChildName) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true});const data=text.trim()?JSON.parse(text):[];return data==null?[]:Array.isArray(data)?data:[data];};
const registeredDirectory=row=>{const match=/^"([^"]+MooyuWorkshopAcceptance\.exe)"/.exec(row.UninstallString??'');if(!match)throw Error('UNINSTALL_REGISTRATION_INVALID');return path.resolve(path.dirname(match[1]));};
if(registry().length)throw Error('EXISTING_ACCEPTANCE_INSTALLATION_NOT_OVERWRITTEN');
const backend=await createIsolatedAccountApi({onMail:code=>fs.writeFile(mailbox,code)}),phases=[],checks=[];
const report={passed:false,directory,installDirectory:install,profileRoot:profile,versions:[before.version,after.version],sourceCommit:after.sourceCommit,productionConnected:false,published:false,deployed:false,phases,checks};
async function run(exe,args,label,timeout=120000){return new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(exe,args,{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',s=>{output+=s;if(label==='visible-reinstall')process.stdout.write(s);});child.stderr.on('data',s=>output+=s);const timer=setTimeout(()=>{child.kill();reject(Error('INSTALL_PROCESS_TIMEOUT: '+label));},timeout);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',async code=>{clearTimeout(timer);await fs.writeFile(path.join(directory,label+'.log'),output);code===0?resolve():reject(Error('INSTALL_PROCESS_FAILED: '+label+' ('+code+')'));});});}
async function installVersion(r,label){const bytes=await fs.readFile(r.installer);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),r.installerSha256);await run(r.installer,['/S','/D='+install],label);await wait(()=>exists(path.join(install,'MooyuWorkshopAcceptance.exe')),label);const rows=registry();assert.equal(rows.length,1);assert.equal(registeredDirectory(rows[0]).toLowerCase(),install.toLowerCase());assert.equal(rows[0].DisplayVersion,r.version);checks.push(label+' registers only the current-user acceptance app at the requested path');}
async function phase(name,hold=false){const config=path.join(directory,name+'.json'),result=path.join(directory,name+'-result.json');await fs.writeFile(config,JSON.stringify({accountApiOrigin:backend.origin,accountEnvironment:'local-test',profileRoot:profile,mailbox,phase:name==='seed'?'seed':'restore',report:result,hold}));await run(path.join(install,'MooyuWorkshopAcceptance.exe'),['--acceptance-config',config],hold?'visible-reinstall':name,hold?240000:90000);const r=JSON.parse(await fs.readFile(result,'utf8'));assert.equal(r.passed,true);phases.push({name,...r});}
async function dataHashes(dir){const out={};for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory()){for(const [f,h] of Object.entries(await dataHashes(p)))out[entry.name+'/'+f]=h;}else if(entry.isFile())out[entry.name]=crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');}return out;}
async function uninstall(label){const rows=registry();assert.equal(rows.length,1);assert.equal(registeredDirectory(rows[0]).toLowerCase(),install.toLowerCase());const entries=await fs.readdir(install);const exe=entries.find(f=>/^Uninstall .*\.exe$/.test(f));if(!exe)throw Error('UNINSTALLER_MISSING');const hashes=await dataHashes(profile);await run(path.join(install,exe),['/S'],label);await wait(async()=>!await exists(path.join(install,'MooyuWorkshopAcceptance.exe'))&&registry().length===0,label);assert.deepEqual(await dataHashes(profile),hashes);checks.push(label+' removes executable and HKCU registration while retaining every profile byte');}
try{
  await installVersion(before,'install-v1');await phase('seed');await phase('restart');
  backend.expireAccess();await installVersion(after,'upgrade-v2');await phase('upgrade');assert.ok(backend.refreshCount>=1);checks.push('expired access token refreshes after upgrade without a new login');
  await uninstall('uninstall-v2');await installVersion(after,'reinstall-v2');
  await phase('reinstall',options['--hold']==='true');
  await uninstall('final-uninstall');
  report.passed=true;report.refreshCount=backend.refreshCount;report.realCredentialsUsed=false;report.testProfileRetained=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await backend.close();await fs.rm(mailbox,{force:true});await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(parent,'latest.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
