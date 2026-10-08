import fs from 'node:fs/promises';
import path from 'node:path';
import { uuid } from './community-contract.mjs';
import { executeImage,readJobJson,atomicJson } from './community-image-runner.mjs';
const root=path.resolve(process.env.COMMUNITY_PROCESSOR_ROOT??'/data/community-processor');
const media=path.resolve(process.env.COMMUNITY_MEDIA_ROOT??'/data/community-media');
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
await fs.mkdir(path.join(root,'requests'),{recursive:true});
await fs.mkdir(path.join(root,'processing'),{recursive:true});
while(!stopping) {
  const names=(await fs.readdir(path.join(root,'requests'))).filter(name=>name.endsWith('.json')&&uuid(name.slice(0,-5))).sort();
  if(!names.length){await new Promise(resolve=>setTimeout(resolve,500));continue;}
  const name=names[0],id=name.slice(0,-5),claimed=path.join(root,'processing',name);
  try{await fs.rename(path.join(root,'requests',name),claimed);}catch{continue;}
  let result;
  try{
    const job=await readJobJson(claimed);
    if(job.version!==1||job.id!==id||!uuid(job.assetId)||!Number.isFinite(job.expiresAt)||job.expiresAt<Date.now()||job.expiresAt>Date.now()+30000)throw new Error('Invalid job');
    result=await executeImage(path.join(media,'assets',job.assetId,'input'),path.join(root,'attempts',id));
  }catch{result={ok:false,code:'IMAGE_INVALID'};}
  await atomicJson(path.join(root,'responses',name),{...result,id});
  await fs.rm(claimed,{force:true});
}
