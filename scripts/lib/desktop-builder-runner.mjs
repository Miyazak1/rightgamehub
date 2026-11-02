import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

export async function runDesktopBuilder(request,directory) {
  const input=path.join(directory,'builder-request.json'),result=path.join(directory,'builder-result.json');
  await fs.writeFile(input,JSON.stringify(request,null,2));
  const status=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./desktop-builder-worker.mjs',import.meta.url)),input,result],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',chunk=>{log+=chunk;process.stdout.write(chunk);});child.stderr.on('data',chunk=>{log+=chunk;process.stderr.write(chunk);});
    const timer=setTimeout(()=>{child.kill();reject(Error('DESKTOP_BUILDER_TIMEOUT'));},360000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',async(code,signal)=>{clearTimeout(timer);try{await fs.writeFile(path.join(directory,'builder.log'),log);resolve({code,signal});}catch(error){reject(error);}});
  });
  await fs.writeFile(path.join(directory,'builder-status.json'),JSON.stringify(status,null,2));
  let report;try{report=JSON.parse(await fs.readFile(result,'utf8'));}catch{throw Error('DESKTOP_BUILDER_RESULT_MISSING');}
  if(status.code!==0||!report.passed)throw Error('DESKTOP_BUILDER_FAILED: '+(report.error??status.signal??status.code));
  return report;
}
