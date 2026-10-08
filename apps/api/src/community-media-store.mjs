import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { hash, uuid, LIMITS } from './community-contract.mjs';
import { fail } from './community-errors.mjs';

export class CommunityMediaStore {
  constructor(root) { this.root=path.resolve(root); }
  directory(id) { if(!uuid(id)) fail('MEDIA_INVALID',400,'图片标识无效。');return path.join(this.root,'assets',id); }
  file(id,name) {
    if(!/^(input|[a-f0-9]{64}-(thumb|display)\.webp)$/.test(name)) fail('MEDIA_INVALID',400,'图片路径无效。');
    return path.join(this.directory(id),name);
  }
  async put(id,name,bytes) {
    const target=this.file(id,name);await fs.mkdir(path.dirname(target),{recursive:true});
    const temp=target+'.'+crypto.randomUUID()+'.partial';
    try {
      await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});
      try{await fs.link(temp,target);}catch(error){
        if(error.code!=='EEXIST') throw error;
        const prior=await fs.readFile(target);
        if(!prior.equals(bytes)) fail('MEDIA_CONFLICT',409,'图片内容与已有上传不一致。');
      }
    } finally { await fs.rm(temp,{force:true}); }
    return name;
  }
  async get(id,name,expectedHash,limit=LIMITS.inputBytes) {
    const file=this.file(id,name),stat=await fs.stat(file);
    if(!stat.isFile()||stat.size<1||stat.size>limit) fail('MEDIA_INTEGRITY',503,'图片文件校验失败。');
    const bytes=await fs.readFile(file);
    if(hash(bytes)!==expectedHash) fail('MEDIA_INTEGRITY',503,'图片文件校验失败。');
    return bytes;
  }
  async remove(id) { await fs.rm(this.directory(id),{recursive:true,force:true}); }
}
