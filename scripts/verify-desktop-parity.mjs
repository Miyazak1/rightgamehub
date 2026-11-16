import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {createParityApiFixture} from '../tests/desktop/parity-api-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..'),directory=await fs.mkdtemp(path.join(root,'.runtime/desktop-parity/native-'));
const codeFile=path.join(directory,'otp.txt'),uploadFile=path.join(directory,'selected-rule.zip'),report=path.join(directory,'report.json');
const avatarFile=path.join(directory,'selected-avatar.png');await fs.writeFile(avatarFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));
await fs.writeFile(uploadFile,'PK-isolated-rule-archive');
const backend=await createParityApiFixture({onMail:code=>fs.writeFile(codeFile,code)});
const req=createRequire(path.join(root,'package.json'));await req('esbuild').build({entryPoints:[path.join(root,'apps/desktop/renderer/business-api.mjs')],bundle:true,format:'esm',platform:'browser',outfile:path.join(root,'.runtime/desktop-shell/web/parity-probe.js')});
try{
  const config=path.join(directory,'config.json');await fs.writeFile(config,JSON.stringify({assetRoot:path.join(root,'.runtime/desktop-shell/web'),profileRoot:path.join(directory,'profile'),accountApiOrigin:backend.origin,accountEnvironment:'local-test',codeFile,uploadFile,avatarFile,report,directory}));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{const child=spawn(process.env.MOOYU_ELECTRON_EXECUTABLE||'E:/CODE/Right/.runtime/electron-v44.4.5-win32-x64/electron.exe',[path.join(root,'tests/desktop/electron-parity-acceptance.cjs'),'--config',config],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);const timer=setTimeout(()=>{child.kill();reject(Error('DESKTOP_PARITY_TIMEOUT'));},180000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('DESKTOP_PARITY_FAILED '+report));});});
  const result={...JSON.parse(await fs.readFile(report,'utf8')),directory,calls:backend.calls};await fs.writeFile(path.join(root,'.runtime/desktop-parity/native-latest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await backend.close();await fs.rm(codeFile,{force:true});}
