import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createIsolatedAccountApi } from '../tests/desktop/account-api-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), base=path.join(root,'.runtime/desktop-shell');
await fs.mkdir(base,{recursive:true});
const directory=await fs.mkdtemp(path.join(base,'account-acceptance-')), mailbox=path.join(directory,'test-mailbox.txt');
const backend=await createIsolatedAccountApi({onMail:code=>fs.writeFile(mailbox,code)});
const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const phases=[];
try {
  for(const phase of ['initial','restore','signed-out']) {
    if(phase==='restore') backend.expireAccess();
    const config=path.join(directory,phase+'-config.json'), report=path.join(directory,phase+'.json');
    await fs.writeFile(config,JSON.stringify({phase,report,mailbox,assetRoot:path.join(base,'web'),profileRoot:path.join(directory,'profile'),accountApiOrigin:backend.origin}));
    await new Promise((resolve,reject)=>{
      const child=spawn(path.resolve(root,'../../.runtime/electron-v44.4.5-win32-x64/electron.exe'),[path.join(root,'tests/desktop/electron-account-acceptance.cjs'),'--config',config],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      const timer=setTimeout(()=>{child.kill();reject(Error('Account acceptance timed out: '+phase));},120000);
      child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Account acceptance failed: '+phase+'; '+report));});
    });
    phases.push(JSON.parse(await fs.readFile(report,'utf8')));
  }
  if(backend.refreshCount!==1) throw Error('Expected exactly one refresh after access expiration');
  const result={ok:true,directory,checkCount:phases.reduce((n,p)=>n+p.checks.length,0),refreshCount:backend.refreshCount,calls:backend.calls};
  await fs.writeFile(path.join(base,'account-verification-latest.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:true,directory,checks:result.checkCount,refreshCount:backend.refreshCount}));
} finally { await backend.close(); await fs.rm(mailbox,{force:true}); }
