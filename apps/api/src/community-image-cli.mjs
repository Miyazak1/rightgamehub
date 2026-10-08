import fs from 'node:fs/promises';
import sharp from 'sharp';
import { LIMITS } from './community-contract.mjs';

// This executable only receives a bounded input file and an attempt directory.
// Production runs it in the networkless, read-only image processor container.
try {
  const [input,output]=process.argv.slice(2);
  const stat=await fs.stat(input);
  if(stat.size<1||stat.size>LIMITS.inputBytes) throw new Error('size');
  sharp.cache(false);sharp.concurrency(1);
  const bytes=await fs.readFile(input);
  const options={limitInputPixels:16000000,failOn:'warning',sequentialRead:true,limitInputChannels:4};
  const metadata=await sharp(bytes,options).metadata();
  if(!['jpeg','png','webp'].includes(metadata.format)||!metadata.width||!metadata.height||metadata.width*metadata.height>16000000||(metadata.pages??1)!==1) throw new Error('format');
  await fs.mkdir(output,{recursive:true});
  const variants={};
  for(const [variant,edge,max] of [['thumb',480,163840],['display',1600,1048576]]) {
    const image=await sharp(bytes,options).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).timeout({seconds:4}).webp({quality:82,effort:2}).toBuffer({resolveWithObject:true});
    if(image.data.length>max) throw new Error('output_size');
    await fs.writeFile(output+'/'+variant+'.webp',image.data,{flag:'wx',mode:0o600});
    variants[variant]={width:image.info.width,height:image.info.height,bytes:image.data.length};
  }
  process.stdout.write(JSON.stringify({ok:true,format:metadata.format,variants}));
} catch { process.stdout.write(JSON.stringify({ok:false,code:'IMAGE_INVALID'}));process.exitCode=1; }
