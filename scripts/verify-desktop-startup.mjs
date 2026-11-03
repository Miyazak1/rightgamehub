import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createBusinessApiFixture} from '../tests/desktop/business-api-fixture.mjs';
import {createApiClient} from '../packages/platform-api-client/src/index.mjs';
import {createWindowsDpapiCredentialVault} from '../apps/capability-executor/src/credential-vault.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32')throw Error('WINDOWS_STARTUP_REQUIRED');
const parent=path.join(root,'.runtime/desktop-startup-acceptance');await fs.mkdir(parent,{recursive:true});
const directory=await fs.mkdtemp(path.join(parent,'check-'));
const clean=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-auth-clean/latest.json')));assert.equal(clean.passed,true);
const source=path.join(clean.directory,'source');
const profileRoot=path.join(directory,'profile');await fs.mkdir(profileRoot);
let code;
const fixture=await createBusinessApiFixture({onMail:value=>{code=value;}});
const report={passed:false,directory,productionConnected:false,realCredentialsUsed:false};
try{
  const appDirectory=path.join(directory,'app');await fs.mkdir(appDirectory);
  const projectRequire=createRequire(path.join(source,'package.json')),toolRequire=createRequire(path.join(root,'.runtime/windows-packaging-tools/package.json'));
  // Exercise the bundled main/preload and ASAR reads used by installed builds,
  // rather than counting hundreds of development dependency-file reads.
  await projectRequire('esbuild').build({absWorkingDir:source,entryPoints:['tests/desktop/electron-startup-acceptance.cjs'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:path.join(appDirectory,'startup.cjs'),external:['electron','bufferutil','utf-8-validate','kerberos'],nodePaths:[path.join(source,'apps/desktop/node_modules'),path.join(root,'.runtime/windows-packaging-tools/node_modules')],sourcemap:false});
  await fs.copyFile(path.join(source,'apps/desktop/electron/preload.cjs'),path.join(appDirectory,'preload.cjs'));
  await fs.cp(path.join(source,'.runtime/desktop-shell/web'),path.join(appDirectory,'web'),{recursive:true,filter:file=>!file.endsWith('.map')});
  await fs.writeFile(path.join(appDirectory,'package.json'),JSON.stringify({name:'mooyu-startup-acceptance',version:'0.2.0-preview.5',main:'startup.cjs'}));
  const archive=path.join(directory,'app.asar');await toolRequire('@electron/asar').createPackage(appDirectory,archive);
  const api=createApiClient({baseUrl:fixture.origin});
  const challenge=await api.createChallenge({email:'startup-acceptance@example.test',clientKind:'browser'});
  const verified=await api.verifyChallenge({challengeId:challenge.data.challengeId,code,deviceLabel:'Isolated startup acceptance'});
  const vault=createWindowsDpapiCredentialVault({directory:path.join(profileRoot,'account-vault')});
  await vault.store('desktop-shell-account:'+crypto.createHash('sha256').update(fixture.origin).digest('hex'),JSON.stringify({origin:fixture.origin,tokens:verified.data}));
  const configFile=path.join(directory,'config.json'),result=path.join(directory,'window.json');
  await fs.writeFile(configFile,JSON.stringify({assetRoot:archive+'/web',profileRoot,accountApiOrigin:fixture.origin,result}));
  const electron=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-shell/launch.json'))).electronExecutable;
  const processStarted=Date.now();
  await new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(electron,[archive+'/startup.cjs',configFile],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>{child.kill();reject(Error('STARTUP_PROCESS_TIMEOUT'));},45000);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);child.once('exit',n=>{clearTimeout(timer);fs.writeFile(path.join(directory,'window.log'),output).then(()=>n===0?resolve():reject(Error('STARTUP_WINDOW_FAILED')));});});
  report.processWallMs=Date.now()-processStarted;report.bundledAsar=true;
  const window=JSON.parse(await fs.readFile(result));assert.equal(window.passed,true);report.window=window;report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await fixture.close();await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(parent,'latest.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
