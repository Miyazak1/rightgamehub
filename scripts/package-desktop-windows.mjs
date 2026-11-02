import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {auditDesktopArchive} from './lib/desktop-package-audit.mjs';
import {prepareDesktopRuntime} from './lib/desktop-runtime.mjs';
import {runDesktopBuilder} from './lib/desktop-builder-runner.mjs';
import {updateTrust} from '../apps/desktop/src/update-manifest.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await fs.readFile(path.join(root,'scripts/desktop-windows-package.json'),'utf8'));
const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--version','--acceptance','--tools','--electron','--update-config'].includes(key)||!process.argv[i+1]||options[key])throw Error('PACKAGE_OPTIONS_INVALID');options[key]=process.argv[i+1];}
const version=options['--version']??'0.2.0-preview.4',acceptance=options['--acceptance']==='true';
if(!/^0\.2\.0-preview\.[1-9]\d*$/.test(version)||options['--acceptance']&&!['true','false'].includes(options['--acceptance']))throw Error('PACKAGE_VERSION_INVALID');
if(process.platform!=='win32')throw Error('WINDOWS_BUILD_REQUIRED');
const tools=path.resolve(options['--tools']??path.join(root,'.runtime/windows-packaging-tools'));
const runtime=path.resolve(options['--electron']??path.resolve(root,'../../.runtime/electron-v44.4.5-win32-x64'));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const toolRequire=createRequire(path.join(tools,'package.json'));
if(toolRequire('electron-builder/package.json').version!==manifest.builderVersion)throw Error('BUILDER_VERSION_MISMATCH');
const parent=path.join(root,'.runtime/desktop-windows-package');await fs.mkdir(parent,{recursive:true});
const directory=await fs.mkdtemp(path.join(parent,(acceptance?'acceptance-':'preview-')+version+'-'));
const source=path.join(directory,'source'),appDirectory=path.join(directory,'app'),output=path.join(directory,'output');await fs.mkdir(source);
const report={passed:false,sourceCommit:manifest.sourceCommit,version,acceptance,directory,productionConnected:false,published:false,deployed:false};
async function run(command,args,cwd,log){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',s=>text+=s);child.stderr.on('data',s=>text+=s);const timer=setTimeout(()=>{child.kill();reject(Error('PACKAGE_TIMEOUT: '+log));},240000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',async code=>{clearTimeout(timer);await fs.writeFile(path.join(directory,log+'.txt'),text);code===0?resolve(text):reject(Error('PACKAGE_STEP_FAILED: '+log));});});}
const exists=async p=>fs.access(p).then(()=>true,()=>false);
const inside=(base,target)=>{const r=path.relative(base,target);return r!== '..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
try{
  const configuredUpdates=options['--update-config']?updateTrust(JSON.parse(await fs.readFile(path.resolve(options['--update-config']),'utf8')),{localTest:acceptance}):null;
  if(toolRequire('electron-updater/package.json').version!==manifest.updaterVersion)throw Error('UPDATER_VERSION_MISMATCH');
  const preparedRuntime=await prepareDesktopRuntime({runtime,destination:path.join(directory,'electron'),manifest});
  report.runtimeArchiveSha256=preparedRuntime.archiveSha256;
  await run('git',['archive','--format=tar','--output='+path.join(directory,'base.tar'),manifest.sourceCommit],root,'archive');
  await run('tar',['-xf',path.join(directory,'base.tar'),'-C',source],root,'extract');
  report.overlay=[];
  for(const file of manifest.overlay){if(!inside(source,path.resolve(source,file))||file.startsWith('.runtime/'))throw Error('PACKAGE_OVERLAY_INVALID');await fs.mkdir(path.dirname(path.join(source,file)),{recursive:true});await fs.copyFile(path.join(root,file),path.join(source,file));report.overlay.push({file,sha256:hash(await fs.readFile(path.join(source,file)))});}
  // Link installed third-party code only; rebind every internal workspace link
  // to the archive. Uncommitted paper/D1 sources never participate in the build.
  const folders=['.'];for(const name of ['apps','packages','extensions'])for(const item of await fs.readdir(path.join(root,name),{withFileTypes:true}))if(item.isDirectory())folders.push(path.join(name,item.name));
  async function link(from,to){const real=await fs.realpath(from);const workspace=inside(root,real)&&!path.relative(root,real).split(path.sep).includes('node_modules');const target=workspace?path.resolve(source,path.relative(root,real)):real;if(!await exists(target))throw Error('PACKAGE_DEPENDENCY_MISSING');await fs.symlink(target,to,'junction');}
  for(const folder of folders){const from=path.join(root,folder,'node_modules'),to=path.join(source,folder,'node_modules');if(!await exists(from)||!await exists(path.dirname(to)))continue;await fs.mkdir(to,{recursive:true});for(const item of await fs.readdir(from,{withFileTypes:true})){if(!item.isDirectory()&&!item.isSymbolicLink())continue;if(item.name.startsWith('@')){await fs.mkdir(path.join(to,item.name),{recursive:true});for(const name of await fs.readdir(path.join(from,item.name)))await link(path.join(from,item.name,name),path.join(to,item.name,name));}else await link(path.join(from,item.name),path.join(to,item.name));}}
  await run(process.execPath,['scripts/build-desktop-shell.mjs'],source,'web-build');
  await fs.mkdir(appDirectory);
  const projectRequire=createRequire(path.join(source,'package.json')),{build}=projectRequire('esbuild');
  const entry=acceptance?'tests/desktop/electron-installed-acceptance.cjs':'apps/desktop/electron/installed.cjs';
  const bundled=await build({absWorkingDir:source,entryPoints:[entry],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:path.join(appDirectory,'main.cjs'),external:['electron','bufferutil','utf-8-validate','kerberos'],nodePaths:[path.join(source,'apps/desktop/node_modules'),path.join(source,'apps/realtime/node_modules'),path.join(tools,'node_modules')],metafile:true,sourcemap:false,legalComments:'inline'});
  const inputs=Object.keys(bundled.metafile.inputs);if(inputs.some(f=>/agent-paper-|desktop-workbench|paper-review|MooyuWorkbench/.test(f)))throw Error('DEFERRED_CODE_IN_BUNDLE');
  report.bundleInputCount=inputs.length;
  await fs.copyFile(path.join(source,'apps/desktop/electron/preload.cjs'),path.join(appDirectory,'preload.cjs'));
  await fs.cp(path.join(source,'.runtime/desktop-shell/web'),path.join(appDirectory,'web'),{recursive:true,filter:from=>!from.endsWith('.map')});
  if(acceptance)await build({absWorkingDir:source,entryPoints:['packages/save-cache/src/indexeddb-store.mjs'],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:path.join(appDirectory,'web/install-save-probe.js')});
  await run(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/platform:x64','/reference:System.Web.Extensions.dll','/out:'+path.join(appDirectory,'update-runner.exe'),path.join(source,'apps/desktop/native/MooyuUpdateRunner.cs')],source,'update-runner-build');
  const updateRunnerSha256=hash(await fs.readFile(path.join(appDirectory,'update-runner.exe')));
  const info={updateRunnerSha256,sourceCommit:manifest.sourceCommit,version,acceptance,electronVersion:manifest.electronVersion,updateTrust:configuredUpdates,updaterCacheDirName:'mooyu-updates'};
  await fs.writeFile(path.join(appDirectory,'build-info.json'),JSON.stringify(info,null,2));
  await fs.writeFile(path.join(appDirectory,'package.json'),JSON.stringify({name:acceptance?'mooyu-workshop-acceptance':'mooyu-workshop',productName:acceptance?'墨鱼工坊安装验收':'墨鱼工坊',version,main:'main.cjs',description:'墨鱼工坊 Windows 客户端',author:'Mooyu Workshop',private:true},null,2));
  const {default:configuration}=await import(pathToFileURL(path.join(root,'scripts/desktop-windows-builder.cjs')).href);
  const config=configuration({appDirectory,output,version,acceptance,icon:path.join(appDirectory,'web/desktop-icons/mooyu.ico')});config.electronDist=preparedRuntime.directory;config.electronVersion=manifest.electronVersion;
  await fs.writeFile(path.join(directory,'builder.json'),JSON.stringify(config,null,2));
  const builder=await runDesktopBuilder({tools,builderVersion:manifest.builderVersion,config,
    audit:{runtime:{files:preparedRuntime.files},executableName:config.executableName,acceptance}},directory);
  report.preArchiveAudit=builder.preArchiveAudit;report.finalPayloadAudit=builder.finalAudit;
  const asar=toolRequire('@electron/asar'),archive=path.join(output,'win-unpacked/resources/app.asar');
  Object.assign(report,auditDesktopArchive(asar,archive,{acceptance}));
  const installer=(await fs.readdir(output)).find(f=>f.endsWith('.exe'));
  if(!installer)throw Error('INSTALLER_MISSING');report.installer=path.join(output,installer);report.installerSha256=hash(await fs.readFile(report.installer));report.installerBytes=(await fs.stat(report.installer)).size;
  report.executable=path.join(output,'win-unpacked',acceptance?'MooyuWorkshopAcceptance.exe':'MooyuWorkshop.exe');report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(parent,acceptance?'acceptance-latest.json':'latest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
