import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';

export async function sha256File(file) {
  const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
export async function runtimeFiles(directory) {
  const files=[];
  async function walk(relative='') {
    for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})) {
      const file=relative?relative+'/'+entry.name:entry.name,absolute=path.join(directory,file);
      const stat=await fs.lstat(absolute);
      if(stat.isSymbolicLink())throw Error('DESKTOP_PAYLOAD_LINK_DENIED: '+file);
      if(stat.isDirectory())await walk(file);
      else if(stat.isFile())files.push({file,sha256:await sha256File(absolute)});
      else throw Error('DESKTOP_PAYLOAD_TYPE_DENIED: '+file);
    }
  }
  await walk();return files.sort((a,b)=>a.file.localeCompare(b.file));
}
async function extractArchive(archive,directory) {
  await new Promise((resolve,reject)=>{
    const child=spawn('tar',['-xf',archive,'-C',directory],{windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill();reject(Error('ELECTRON_EXTRACT_TIMEOUT'));},120000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('ELECTRON_EXTRACT_FAILED'));});
  });
}
// Only bytes from the pinned release archive are trusted. Nearby executables,
// provenance, debug logs or credentials in a developer's runtime are not copied.
export async function prepareDesktopRuntime({runtime,destination,manifest,extract=extractArchive}) {
  const archive=(await fs.stat(runtime)).isDirectory()?path.join(runtime,`electron-v${manifest.electronVersion}-win32-x64.zip`):runtime;
  await fs.mkdir(destination); // A fresh directory is mandatory, never reuse a profile.
  const snapshot=path.join(destination,'..','electron-input.zip');
  let copied=false;
  try {
    await fs.copyFile(archive,snapshot,1);
    copied=true;
    if(await sha256File(snapshot)!==manifest.electronArchiveSha256)throw Error('ELECTRON_ARCHIVE_HASH_MISMATCH');
    await extract(snapshot,destination);
    if(await sha256File(path.join(destination,'electron.exe'))!==manifest.electronExecutableSha256)throw Error('ELECTRON_HASH_MISMATCH');
    // The development fallback loader has no role in an installed application.
    await fs.rm(path.join(destination,'resources/default_app.asar'),{force:true});
    return {directory:destination,archiveSha256:manifest.electronArchiveSha256,files:await runtimeFiles(destination)};
  }finally{if(copied)await fs.rm(snapshot,{force:true});}
}
