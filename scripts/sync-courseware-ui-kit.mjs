import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const canonicalPath=path.join(root,'packages/courseware-ui-kit/src/index.mjs');
const templateRoot=path.join(root,'templates/courseware');
const checkOnly=process.argv.includes('--check');
const requested=process.argv.slice(2).filter(value=>!value.startsWith('--'));
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

const names=requested.length?requested:(await fs.readdir(templateRoot,{withFileTypes:true}))
  .filter(entry=>entry.isDirectory())
  .map(entry=>entry.name)
  .filter(async name=>fs.stat(path.join(templateRoot,name,'modules/ui-kit/module.json')).catch(()=>null));
const canonical=await fs.readFile(canonicalPath);
const discovered=[];
for(const name of names){
  const moduleRoot=path.join(templateRoot,name,'modules/ui-kit');
  const manifestPath=path.join(moduleRoot,'module.json');
  const manifestBytes=await fs.readFile(manifestPath).catch(error=>error?.code==='ENOENT'?null:Promise.reject(error));
  if(!manifestBytes){if(requested.length)throw new Error(`${name} does not declare modules/ui-kit/module.json`);continue}
  const entryPath=path.join(moduleRoot,'index.mjs');
  const current=await fs.readFile(entryPath).catch(error=>error?.code==='ENOENT'?null:Promise.reject(error));
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  const integrity=`sha256:${sha256(canonical)}`;
  const stale=!current||!current.equals(canonical)||manifest.integrity!==integrity;
  if(checkOnly&&stale)throw new Error(`${name} has a stale courseware UI Kit release copy`);
  if(!checkOnly&&stale){
    await fs.mkdir(moduleRoot,{recursive:true});
    await fs.writeFile(entryPath,canonical);
    manifest.integrity=integrity;
    await fs.writeFile(manifestPath,`${JSON.stringify(manifest,null,2)}\n`);
  }
  discovered.push(`${name}${stale&&!checkOnly?' (synced)':''}`);
}
if(!discovered.length)throw new Error('No courseware templates with a UI Kit module were found.');
console.log(`${checkOnly?'Verified':'Prepared'} courseware UI Kit: ${discovered.join(', ')}`);
