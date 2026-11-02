import fs from 'node:fs/promises';
import path from 'node:path';
import {sha256File} from './desktop-runtime.mjs';
import crypto from 'node:crypto';

export function auditDesktopArchive(asar,archive,{acceptance=false}={}) {
  const files=asar.listPackage(archive).map(file=>file.replace(/^[\\/]+/,''))
    .filter(file=>!asar.statFile(archive,file).files);
  const forbidden=files.filter(f=>/(?:account-vault|account-server\.json|launch\.json|instance\.env|\.dpapi|\.git[\\/]|node_modules|fixtures|\.map$|test-mailbox)/i.test(f));
  if(forbidden.length)throw Error('PRIVATE_OR_TEST_FILE_IN_PACKAGE: '+forbidden.join(','));
  const code=asar.extractFile(archive,'main.cjs').toString('utf8');
  if(!acceptance&&(/acceptance-config|installer-fixture@example\.test|createIsolatedAccountApi/.test(code)||files.some(f=>f.endsWith('install-save-probe.js'))))throw Error('TEST_ENTRY_IN_PREVIEW');
  if(/[A-Z]:[\\/](?:Users|CODE)[\\/]|github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{30,}/.test(code))throw Error('MACHINE_PATH_OR_SECRET_IN_PACKAGE');
  if(code.includes('DESKTOP_UPDATE_HELPER_INTEGRITY')){
    if(!files.includes('update-runner.exe')||!files.includes('build-info.json'))throw Error('DESKTOP_UPDATE_HELPER_MISSING');
    const info=JSON.parse(asar.extractFile(archive,'build-info.json').toString('utf8'));
    const digest=crypto.createHash('sha256').update(asar.extractFile(archive,'update-runner.exe')).digest('hex');
    if(digest!==info.updateRunnerSha256)throw Error('DESKTOP_UPDATE_HELPER_INTEGRITY');
  }
  return {archiveFiles:files.length,packageFileAuditPassed:true};
}

/** Gate the whole unpacked application BEFORE NSIS archives it, not just ASAR. */
export async function auditDesktopPayload(asar,directory,{runtime,executableName,acceptance=false}) {
  if(!/^[A-Za-z0-9_-]+$/.test(executableName))throw Error('DESKTOP_PAYLOAD_EXECUTABLE_INVALID');
  const executable=executableName+'.exe',expected=new Map();
  if(!runtime?.files?.some(row=>row.file==='electron.exe'))throw Error('DESKTOP_RUNTIME_MANIFEST_INVALID');
  for(const row of runtime.files) {
    if(!row.file||row.file.includes('\\')||row.file.startsWith('/')||row.file.split('/').some(p=>p==='..'||p==='')||!/^[a-f0-9]{64}$/.test(row.sha256)||expected.has(row.file))throw Error('DESKTOP_RUNTIME_MANIFEST_INVALID');
    // Branding and Electron's ASAR integrity resource legitimately edit this copy.
    const outputFile=row.file==='electron.exe'?executable:row.file==='LICENSE'?'LICENSE.electron.txt':row.file;
    expected.set(outputFile,row.file==='electron.exe'?null:row.sha256);
  }
  expected.set('resources/app.asar',null);
  const directories=new Set(['']);for(const file of expected.keys()){let parent=path.posix.dirname(file);while(parent!=='.'){directories.add(parent);parent=path.posix.dirname(parent);}}
  const found=new Set();
  async function walk(relative='') {
    for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})) {
      const file=relative?relative+'/'+entry.name:entry.name,absolute=path.join(directory,file),stat=await fs.lstat(absolute);
      if(stat.isSymbolicLink())throw Error('DESKTOP_PAYLOAD_LINK_DENIED: '+file);
      if(stat.isDirectory()){if(!directories.has(file))throw Error('DESKTOP_PAYLOAD_UNEXPECTED_DIRECTORY: '+file);await walk(file);}
      else {
        if(!stat.isFile()||!expected.has(file))throw Error('DESKTOP_PAYLOAD_UNEXPECTED_FILE: '+file);
        const sha=expected.get(file);if(sha&&await sha256File(absolute)!==sha)throw Error('DESKTOP_PAYLOAD_HASH_MISMATCH: '+file);
        found.add(file);
      }
    }
  }
  await walk();for(const file of expected.keys())if(!found.has(file))throw Error('DESKTOP_PAYLOAD_MISSING_FILE: '+file);
  return {...auditDesktopArchive(asar,path.join(directory,'resources/app.asar'),{acceptance}),payloadAuditPassed:true,payloadFiles:found.size};
}
