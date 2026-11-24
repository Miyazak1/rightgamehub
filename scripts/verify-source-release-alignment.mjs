// Source-only integrity check. Never contacts production, loads an environment
// file, starts a service, or dispatches an old task.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ledger=JSON.parse(fs.readFileSync(path.join(root,'docs/releases/non-paper-source-alignment-20261124.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=args=>{
 const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
 if(r.status!==0)throw Error('SOURCE_GIT_CHECK_FAILED');return r.stdout.trim();
};
for(const entry of ledger.sourceFiles){
 const file=path.resolve(root,entry.path);
 if(!file.startsWith(root+path.sep))throw Error('SOURCE_PATH_ESCAPED');
 const bytes=fs.readFileSync(file),normalized=entry.normalization==='lf'?Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')):bytes;
 if(sha(normalized)!==entry.sha256)throw Error('SOURCE_CHANGED:'+entry.path);
}
for(const binding of ledger.runtimeBindings){
 const source=ledger.sourceFiles.find(f=>f.path===binding.path);
 if(!source||source.sha256!==binding.normalizedSourceSha256)throw Error('RUNTIME_BINDING_CHANGED:'+binding.path);
}
if(process.argv.includes('--committed')){
 const changed=git(['diff','--name-only',ledger.baseCommit,'HEAD']).split('\n');
 const paperWorkPath=f=>/paper/i.test(f)&&!/^docs\/(?:releases\/)?non-paper-/.test(f);
 if(changed.some(f=>ledger.excludedLocalFiles.includes(f)||paperWorkPath(f)))throw Error('PAPER_WORK_INCLUDED');
 for(const binding of ledger.runtimeBindings){
  if(git(['rev-parse','HEAD:'+binding.path])!==binding.gitBlob)throw Error('COMMITTED_RUNTIME_SOURCE_DIFFERS:'+binding.path);
 }
}
const at=process.argv.indexOf('--artifact-root');
if(at>=0){
 if(!process.argv[at+1])throw Error('ARTIFACT_ROOT_REQUIRED');
 const base=path.resolve(process.argv[at+1]);
 for(const artifact of ledger.currentArtifacts){
  const file=path.join(base,artifact.buildDirectory,artifact.name),fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),chunk=Buffer.alloc(1024*1024);
  try{let n;while((n=fs.readSync(fd,chunk,0,chunk.length,null)))h.update(chunk.subarray(0,n));}finally{fs.closeSync(fd);}
  if(fs.statSync(file).size!==artifact.bytes||h.digest('hex')!==artifact.sha256)throw Error('ARTIFACT_CHANGED:'+artifact.name);
 }
}
console.log(JSON.stringify({result:'SOURCE_RELEASE_ALIGNMENT_VERIFIED',sourceFiles:ledger.sourceFiles.length,runtimeBindings:ledger.runtimeBindings.length,committed:process.argv.includes('--committed'),artifactsChecked:at>=0,productionAccessed:false}));
