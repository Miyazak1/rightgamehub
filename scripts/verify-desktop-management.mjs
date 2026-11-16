import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {createManagementApiFixture} from '../tests/desktop/management-api-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..'),directory=await fs.mkdtemp(path.join(root,'.runtime/desktop-management/acceptance-'));
const codeFile=path.join(directory,'otp.txt'),uploadFile=path.join(directory,'selected-game.zip'),report=path.join(directory,'report.json');
await fs.writeFile(uploadFile,'isolated desktop game archive');
const backend=await createManagementApiFixture({onMail:code=>fs.writeFile(codeFile,code)});
const req=createRequire(path.join(root,'package.json'));await req('esbuild').build({entryPoints:[path.join(root,'apps/desktop/renderer/business-api.mjs')],bundle:true,format:'esm',platform:'browser',outfile:path.join(root,'.runtime/desktop-shell/web/management-probe.js')});
try{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.env.MOOYU_ELECTRON_EXECUTABLE||path.resolve(root,'../../.runtime/electron-v44.4.5-win32-x64/electron.exe');
 const results=[];
 for(const phase of ['connected','denied']){
 backend.denyAdmin(phase==='denied');const report=path.join(directory,phase+'-report.json');
 const file=path.join(directory,phase+'-config.json');await fs.writeFile(file,JSON.stringify({assetRoot:path.join(root,'.runtime/desktop-shell/web'),profileRoot:path.join(directory,phase+'-profile'),accountApiOrigin:backend.origin,accountEnvironment:'local-test',codeFile,uploadFile,report,checkDenied:phase==='denied'}));
 await new Promise((resolve,reject)=>{const p=spawn(executable,[path.join(root,'tests/desktop/electron-management-acceptance.cjs'),'--config',file],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.pipe(process.stdout);p.stderr.pipe(process.stderr);const timer=setTimeout(()=>{p.kill();reject(Error('MANAGEMENT_ACCEPTANCE_TIMEOUT'));},180000);p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('MANAGEMENT_ACCEPTANCE_FAILED: '+report));});});
 results.push(JSON.parse(await fs.readFile(report,'utf8')));
 }
 const result={passed:results.every(r=>r.passed),checks:results.flatMap(r=>r.checks),productionConnected:false,directory};await fs.writeFile(path.join(root,'.runtime/desktop-management/native-latest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await backend.close();await fs.rm(codeFile,{force:true});}
