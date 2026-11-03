import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),native=process.argv.length===3&&process.argv[2]==='--native',nativeClose=native||process.argv.length===3&&process.argv[2]==='--native-close';
if(process.platform!=='win32'||process.argv.length!==2&&!nativeClose)throw Error('WINDOWS_TRAY_ARGUMENTS');
const clean=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-auth-clean/latest.json')));assert.equal(clean.passed,true);
const parent=path.join(root,'.runtime/desktop-tray-acceptance');await fs.mkdir(parent,{recursive:true});const directory=await fs.mkdtemp(path.join(parent,'check-')),profileRoot=path.join(directory,'profile');await fs.mkdir(profileRoot);
const source=path.join(clean.directory,'source'),electron=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-shell/launch.json'))).electronExecutable;
const report={passed:false,directory,productionConnected:false,realCredentialsUsed:false,native,nativeClose,phases:[]};
console.log(JSON.stringify({directory,native,profileRoot}));
try{
  for(const phase of ['initial','restore','explicit-exit']){
    const result=path.join(directory,phase+'-result.json'),config=path.join(directory,phase+'.json');
    await fs.writeFile(config,JSON.stringify({phase,result,profileRoot,native:native&&phase==='initial',nativeClose:nativeClose&&phase==='initial',assetRoot:path.join(source,'.runtime/desktop-shell/web')}));
    await new Promise((resolve,reject)=>{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(electron,[path.join(source,'tests/desktop/electron-tray-acceptance.cjs'),config],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>{child.kill();reject(Error('TRAY_PROCESS_TIMEOUT'));},240000);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);fs.writeFile(path.join(directory,phase+'.log'),output).then(()=>code===0?resolve():reject(Error('TRAY_PHASE_FAILED: '+phase)));});});
    const row=JSON.parse(await fs.readFile(result));assert.equal(row.passed,true);assert.equal(row.trayDestroyed,true);report.phases.push(row);console.log(JSON.stringify(row));
  }
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(parent,'latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
