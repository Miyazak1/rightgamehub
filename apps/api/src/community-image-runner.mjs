import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uuid } from './community-contract.mjs';
import { fail } from './community-errors.mjs';
const cli=fileURLToPath(new URL('./community-image-cli.mjs',import.meta.url));
export async function readJobJson(file) {
  const stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>8192) fail('IMAGE_PROTOCOL_INVALID',503,'图片处理响应无效。');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
export async function atomicJson(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.'+crypto.randomUUID()+'.partial';
  await fs.writeFile(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});
  await fs.rename(tmp,file);
}
export function executeImage(input,output) {
  return new Promise((resolve,reject)=>{
    const env=Object.fromEntries(['SYSTEMROOT','WINDIR','TEMP','TMP','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    const child=spawn(process.execPath,['--max-old-space-size=64',cli,input,output],{env,windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});
    let chunks=[],length=0,finished=false;
    const stop=error=>{if(finished)return;finished=true;clearTimeout(timer);child.kill('SIGKILL');reject(error);};
    const timer=setTimeout(()=>stop(Object.assign(new Error('Image processor timeout'),{code:'IMAGE_TIMEOUT'})),5000);
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>8192)stop(new Error('Image processor output limit'));else chunks.push(chunk);});
    child.on('error',stop);
    child.on('close',code=>{if(finished)return;finished=true;clearTimeout(timer);try{const result=JSON.parse(Buffer.concat(chunks));if(code!==0||!result.ok)throw new Error('Image rejected');resolve(result);}catch(error){reject(Object.assign(error,{code:'IMAGE_INVALID'}));}});
  });
}
export function createCommunityImageRunner({root,mediaRoot,mode='local'}) {
  const directory=path.resolve(root),media=path.resolve(mediaRoot);
  return {async run(asset,leaseId) {
    if(!uuid(asset.id)||!uuid(leaseId)) fail('MEDIA_INVALID',400,'图片任务无效。');
    const output=path.join(directory,'attempts',leaseId),input=path.join(media,'assets',asset.id,'input');
    const request=path.join(directory,'requests',leaseId+'.json'),response=path.join(directory,'responses',leaseId+'.json');
    await fs.mkdir(output,{recursive:true});
    let report;
    if(mode==='local') report=await executeImage(input,output);
    else {
      await atomicJson(request,{version:1,id:leaseId,assetId:asset.id,expiresAt:Date.now()+15000});
      const deadline=Date.now()+18000;
      while(Date.now()<deadline) {
        try{report=await readJobJson(response);break;}catch(error){if(error.code!=='ENOENT')throw error;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!report||report.id!==leaseId) fail('IMAGE_PROCESSOR_UNAVAILABLE',503,'图片处理服务暂不可用。');
      if(!report.ok)fail(report.code==='IMAGE_INVALID'?'IMAGE_INVALID':'IMAGE_PROCESSOR_UNAVAILABLE',400,'图片无法处理，请更换静态 JPG、PNG 或 WebP。');
    }
    const result={report,output};
    return result;
  },async cleanup(leaseId) {
    if(!uuid(leaseId))return;
    for(const file of [path.join(directory,'requests',leaseId+'.json'),path.join(directory,'responses',leaseId+'.json')]) await fs.rm(file,{force:true});
    await fs.rm(path.join(directory,'attempts',leaseId),{force:true,recursive:true});
  },async prune() {
    for(const area of ['requests','responses','processing','attempts']) {
      const folder=path.join(directory,area);
      const entries=await fs.readdir(folder,{withFileTypes:true}).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));
      for(const entry of entries.slice(0,200)) {
        if(entry.isSymbolicLink()||!uuid(entry.name.replace(/\.json(?:\.[0-9a-f-]{36}\.partial)?$/,'')))continue;
        const target=path.join(folder,entry.name),stat=await fs.stat(target).catch(()=>null);
        if(stat&&Date.now()-stat.mtimeMs>120000)await fs.rm(target,{recursive:entry.isDirectory(),force:true});
      }
    }
  }};
}
