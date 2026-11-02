import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {sha256File} from './desktop-runtime.mjs';
import {DESKTOP_DOWNLOAD_PREFIX,validateDesktopDownloadManifest} from '../../packages/platform-client/src/desktop-download.mjs';

async function regularOrMissing(file) {try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('DESKTOP_DOWNLOAD_FILE_TYPE_DENIED');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function directory(file) {await fs.mkdir(file,{recursive:true});const s=await fs.lstat(file);if(!s.isDirectory()||s.isSymbolicLink())throw Error('DESKTOP_DOWNLOAD_DIRECTORY_DENIED');}
async function atomicFile(file,bytes,{immutable=false}={}) {
  if(await regularOrMissing(file)){const current=await fs.readFile(file);if(current.equals(bytes))return;if(immutable)throw Error('DESKTOP_DOWNLOAD_VERSION_COLLISION');}
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
}
/** Local preparation only. No network, upload, deployment or Agent-manifest writes. */
async function prepareLocked({reportFile,releaseFile,outputDirectory}) {
  const report=JSON.parse(await fs.readFile(reportFile,'utf8')),info=JSON.parse(await fs.readFile(releaseFile,'utf8'));
  if(report.passed!==true||report.preArchiveAudit?.payloadAuditPassed!==true||report.finalPayloadAudit?.payloadAuditPassed!==true||report.codeSigned!==false||report.version!==info.version||!path.isAbsolute(report.installer??'')||!Number.isSafeInteger(report.bytes)||!/^[a-f0-9]{64}$/.test(report.sha256??''))throw Error('DESKTOP_DOWNLOAD_REPORT_INVALID');
  const filename=`MooyuWorkshop-${info.version}-x64-Setup.exe`,url=`${DESKTOP_DOWNLOAD_PREFIX}/${info.version}/${filename}`;
  const manifest=validateDesktopDownloadManifest({schemaVersion:1,product:'mooyu-desktop',channel:'preview',windowsX64:{version:info.version,releaseDate:info.releaseDate,notes:info.notes,platform:'windows',arch:'x64',filename,url,checksumUrl:`${DESKTOP_DOWNLOAD_PREFIX}/${info.version}/SHA256SUMS.txt`,signature:'unsigned',sizeBytes:report.bytes,sha256:report.sha256}});
  if(path.basename(report.installer)!==filename||!await regularOrMissing(report.installer))throw Error('DESKTOP_DOWNLOAD_INSTALLER_INVALID');
  const output=path.resolve(outputDirectory);await directory(output);const versionDirectory=path.join(output,info.version);await directory(versionDirectory);
  const executable=path.join(versionDirectory,filename),release=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),sums=Buffer.from(`${report.sha256}  ${filename}\n`);
  // Check immutable metadata BEFORE adding files or activating a new pointer.
  for(const [name,bytes] of [['release.json',release],['SHA256SUMS.txt',sums]])if(await regularOrMissing(path.join(versionDirectory,name))&&!bytes.equals(await fs.readFile(path.join(versionDirectory,name))))throw Error('DESKTOP_DOWNLOAD_VERSION_COLLISION');
  if(await regularOrMissing(executable)) {
    if((await fs.stat(executable)).size!==report.bytes||await sha256File(executable)!==report.sha256)throw Error('DESKTOP_DOWNLOAD_VERSION_COLLISION');
  } else {
    const temporary=path.join(versionDirectory,crypto.randomUUID()+'.tmp');
    try {
      await fs.copyFile(report.installer,temporary,1);
      if((await fs.stat(temporary)).size!==report.bytes||await sha256File(temporary)!==report.sha256)throw Error('DESKTOP_DOWNLOAD_INTEGRITY_FAILED');
      const handle=await fs.open(temporary,'r');try{const bytes=Buffer.alloc(2);await handle.read(bytes,0,2,0);if(bytes.toString('ascii')!=='MZ')throw Error('DESKTOP_DOWNLOAD_NOT_PE');}finally{await handle.close();}
      await fs.rename(temporary,executable);
    }finally{await fs.rm(temporary,{force:true});}
  }
  await atomicFile(path.join(versionDirectory,'SHA256SUMS.txt'),sums,{immutable:true});
  await atomicFile(path.join(versionDirectory,'release.json'),release,{immutable:true});
  // Activate last: missing/corrupt input never replaces the active manifest.
  await atomicFile(path.join(output,'manifest.json'),release);
  return {prepared:true,version:info.version,outputDirectory:output,installer:executable,sha256:report.sha256,bytes:report.bytes,uploaded:false,deployed:false};
}
export async function prepareDesktopDownloads(options) {
  const outputDirectory=path.resolve(options.outputDirectory);await directory(outputDirectory);
  const lockFile=path.join(outputDirectory,'.prepare.lock');let lock;
  try{lock=await fs.open(lockFile,'wx');}catch(error){if(error.code==='EEXIST')throw Error('DESKTOP_DOWNLOAD_PREPARATION_BUSY');throw error;}
  try{return await prepareLocked({...options,outputDirectory});}
  finally{await lock.close();await fs.rm(lockFile,{force:true});}
}
