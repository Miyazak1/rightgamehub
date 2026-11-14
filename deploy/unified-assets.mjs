import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import {pathToFileURL} from 'node:url';
const digest=async file=>{const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const safe=relative=>typeof relative==='string'&&/^(?:agent|desktop)\/[A-Za-z0-9._/-]+$/.test(relative)&&!relative.split('/').some(s=>!s||s==='.'||s==='..');
const pointer=relative=>['agent/manifest.json','agent/gamehub-creator-tools-v1.json','agent/gamehub-agent-latest.vsix','agent/gamehub-dsh-plugin-latest.tgz','desktop/manifest.json','desktop/updates/preview.json'].includes(relative);
const regular=async file=>{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('ASSET_NOT_REGULAR: '+file);return stat;};
async function ensureDirectory(directory){await fs.mkdir(directory,{recursive:true});if((await fs.lstat(directory)).isSymbolicLink())throw Error('ASSET_DIRECTORY_LINK_DENIED');}
async function writeAtomic(file,bytes){await ensureDirectory(path.dirname(file));const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes,{flag:'wx',mode:0o644});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
export async function verifyAssets(bundle,expected={}) {
  const manifest=JSON.parse(await fs.readFile(path.join(bundle,'bundle.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||manifest.files.length<8||manifest.files.length>100||manifest.paperEnabled!==false)throw Error('ASSET_MANIFEST_INVALID');
  for(const key of ['desktopVersion','harnessVersion','editorVersion','agentVersion'])if(expected[key]&&expected[key]!==manifest[key])throw Error('ASSET_RELEASE_MISMATCH');
  const names=new Set();for(const row of manifest.files){if(!safe(row.path)||names.has(row.path)||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<1)throw Error('ASSET_ENTRY_INVALID');names.add(row.path);const file=path.join(bundle,row.path);if((await regular(file)).size!==row.bytes||await digest(file)!==row.sha256)throw Error('ASSET_INTEGRITY_FAILED: '+row.path);}
  async function walk(directory,relative=''){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;const target=path.join(directory,entry.name);const stat=await fs.lstat(target);if(stat.isSymbolicLink())throw Error('ASSET_LINK_DENIED');if(stat.isDirectory())await walk(target,name);else if(!stat.isFile()||name!=='bundle.json'&&!names.has(name))throw Error('ASSET_UNDECLARED: '+name);}}
  await walk(bundle);
  for(const name of ['agent/manifest.json','desktop/manifest.json','desktop/updates/preview.json'])if(!names.has(name))throw Error('ASSET_POINTER_MISSING');
  const agents=JSON.parse(await fs.readFile(path.join(bundle,'agent/manifest.json'),'utf8'));
  for(const [key,versionKey] of [['harnessPlugin','harnessVersion'],['editorExtension','editorVersion'],['agentPlugin','agentVersion']]){const item=agents[key];if(item?.version!==manifest[versionKey]||!names.has('agent/'+item.filename)||manifest.files.find(row=>row.path==='agent/'+item.filename).sha256!==item.sha256)throw Error('AGENT_MANIFEST_MISMATCH');}
  const desktop=JSON.parse(await fs.readFile(path.join(bundle,'desktop/manifest.json'),'utf8')).windowsX64;
  const signed=JSON.parse(await fs.readFile(path.join(bundle,'desktop/updates/preview.json'),'utf8'));
  const key=crypto.createPublicKey(manifest.desktopPublicKey),keyId=crypto.createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex').slice(0,32);
  if(keyId!==manifest.desktopKeyId||signed.keyId!==keyId||expected.desktopKeyId&&expected.desktopKeyId!==keyId)throw Error('DESKTOP_UPDATE_KEY_MISMATCH');
  // Match the recursively canonical update protocol used by installed clients.
  const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])])):value;
  if(!crypto.verify(null,Buffer.from(JSON.stringify(normalize(signed.payload))),key,Buffer.from(signed.signature,'base64'))||new Date(signed.payload.expiresAt).getTime()<=Date.now())throw Error('DESKTOP_UPDATE_SIGNATURE_INVALID_OR_EXPIRED');
  const installer='desktop/'+desktop?.version+'/'+desktop?.filename;
  if(desktop?.version!==manifest.desktopVersion||signed.payload.product!=='mooyu-desktop'||signed.payload.platform!=='windows'||signed.payload.arch!=='x64'||signed.payload.channel!=='preview'||signed.payload.version!==desktop.version||signed.payload.installer.sha256!==desktop.sha256||signed.payload.installer.size!==desktop.sizeBytes||!names.has(installer)||manifest.files.find(row=>row.path===installer).sha256!==desktop.sha256)throw Error('DESKTOP_MANIFEST_MISMATCH');
  return manifest;
}
export async function stageAssets(bundle,desktop,agent,record,expected={}) {
  const manifest=await verifyAssets(bundle,expected);await ensureDirectory(record);
  const previous=[];
  // Validate every immutable destination before copying anything.
  for(const row of manifest.files){const relative=row.path.slice(row.path.indexOf('/')+1),root=row.path.startsWith('desktop/')?desktop:agent,file=path.join(root,relative);await ensureDirectory(root);let existing;try{existing=await regular(file);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!pointer(row.path)&&existing&&(existing.size!==row.bytes||await digest(file)!==row.sha256))throw Error('ASSET_VERSION_COLLISION: '+row.path);
    if(pointer(row.path)){previous.push({path:row.path,exists:Boolean(existing)});if(existing){const backup=path.join(record,'pointers',row.path);await ensureDirectory(path.dirname(backup));await fs.copyFile(file,backup);}}
  }
  await fs.writeFile(path.join(record,'pointers.json'),JSON.stringify(previous));
  for(const row of manifest.files.filter(row=>!pointer(row.path))){const relative=row.path.slice(row.path.indexOf('/')+1),root=row.path.startsWith('desktop/')?desktop:agent;await writeAtomic(path.join(root,relative),await fs.readFile(path.join(bundle,row.path)));}
  return {staged:true,files:manifest.files.length};
}
export async function activateAssets(bundle,desktop,agent,record,expected={}) {
  const manifest=await verifyAssets(bundle,expected);
  // Installer files and plugin archives exist before any active pointer changes.
  for(const row of manifest.files.filter(row=>!pointer(row.path))){const relative=row.path.slice(row.path.indexOf('/')+1),root=row.path.startsWith('desktop/')?desktop:agent;if(await digest(path.join(root,relative))!==row.sha256)throw Error('STAGED_ASSET_CHANGED');}
  await fs.writeFile(path.join(record,'pointers-activation-started'),'started');
  for(const row of manifest.files.filter(row=>pointer(row.path))){const relative=row.path.slice(row.path.indexOf('/')+1),root=row.path.startsWith('desktop/')?desktop:agent;await writeAtomic(path.join(root,relative),await fs.readFile(path.join(bundle,row.path)));}
  return {activated:true,desktopVersion:manifest.desktopVersion};
}
export async function rollbackAssets(desktop,agent,record){
  const rows=JSON.parse(await fs.readFile(path.join(record,'pointers.json'),'utf8'));
  for(const row of rows){if(!safe(row.path)||!pointer(row.path))throw Error('ROLLBACK_POINTER_INVALID');const relative=row.path.slice(row.path.indexOf('/')+1),root=row.path.startsWith('desktop/')?desktop:agent,file=path.join(root,relative);if(row.exists)await writeAtomic(file,await fs.readFile(path.join(record,'pointers',row.path)));else await fs.rm(file,{force:true});}
  return {rolledBack:true,immutableFilesRetained:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [action,bundle,desktop,agent,record,config]=process.argv.slice(2);const expected=config?JSON.parse(await fs.readFile(config,'utf8')):{};
  const result=action==='verify'?await verifyAssets(bundle,expected):action==='stage'?await stageAssets(bundle,desktop,agent,record,expected):action==='activate'?await activateAssets(bundle,desktop,agent,record,expected):action==='rollback'?await rollbackAssets(desktop,agent,record):(()=>{throw Error('ASSET_ACTION_INVALID');})();
  console.log(JSON.stringify(action==='verify'?{verified:true,files:result.files.length,desktopVersion:result.desktopVersion}:result));
}
