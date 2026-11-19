import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import {randomUUID} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code,status:400});};
export function createSelectedUploads({now=Date.now}={}){
  const entries=new Map();let generation=0;
  return {
    clear:()=>{generation++;entries.clear();},
    async register(filename,scope){
      const epoch=generation;
      if(!scope||typeof filename!=='string'||!path.isAbsolute(filename))fail('DESKTOP_UPLOAD_SELECTION_REQUIRED');
      const ext=path.extname(filename).toLowerCase(),types={'.zip':'application/zip','.exe':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
      if(!types[ext])fail('DESKTOP_UPLOAD_TYPE_DENIED');
      const stat=await lstat(filename);
      if(epoch!==generation)fail('DESKTOP_ACCOUNT_SESSION_CHANGED');
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>2*1024**3)fail('DESKTOP_UPLOAD_SIZE_DENIED');
      for(const [id,e]of entries)if(e.expires<now()||e.scope!==scope)entries.delete(id);
      for(const [id,e]of entries)if(e.filename===filename&&e.scope===scope){entries.delete(id);break;}
      if(entries.size>=8)fail('DESKTOP_UPLOAD_BUSY');
      const id=randomUUID();entries.set(id,{filename,scope,size:stat.size,mtime:stat.mtimeMs,ino:stat.ino,type:types[ext],expires:now()+1800000});
      return {desktopUploadId:id};
    },
    async resolve(token,scope,purpose){
      const epoch=generation;
      const e=entries.get(token?.desktopUploadId);
      if(!e||e.scope!==scope||e.expires<now())fail('DESKTOP_UPLOAD_SELECTION_REQUIRED');
      entries.delete(token.desktopUploadId);
      const stat=await lstat(e.filename);
      if(epoch!==generation)fail('DESKTOP_ACCOUNT_SESSION_CHANGED');
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==e.size||stat.mtimeMs!==e.mtime||stat.ino!==e.ino)fail('DESKTOP_UPLOAD_FILE_CHANGED');
      if(['uploadWorkCover','uploadAvatar'].includes(purpose)&&(!e.type.startsWith('image/')||e.size>8*1024**2))fail('DESKTOP_UPLOAD_TYPE_DENIED');
      if(purpose==='uploadAdminAgentAvatar'&&(!e.type.startsWith('image/')||e.size>2*1024**2))fail('DESKTOP_UPLOAD_TYPE_DENIED');
      if(purpose==='uploadContent'&&e.type.startsWith('image/'))fail('DESKTOP_UPLOAD_TYPE_DENIED');
      if(purpose==='uploadMultiplayerRulePackage'&&e.type!=='application/zip')fail('DESKTOP_UPLOAD_TYPE_DENIED');
      const blob=await openAsBlob(e.filename,{type:e.type}),after=await lstat(e.filename);
      if(epoch!==generation)fail('DESKTOP_ACCOUNT_SESSION_CHANGED');
      if(blob.size!==e.size||after.ino!==e.ino||after.mtimeMs!==e.mtime||after.size!==e.size)fail('DESKTOP_UPLOAD_FILE_CHANGED');
      return blob;
    },
  };
}
