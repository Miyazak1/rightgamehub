import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {prepareDesktopDownloads} from './lib/desktop-downloads.mjs';
import {verifyAssets} from '../deploy/unified-assets.mjs';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.runtime/unified-distribution');
const raw=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-windows-package/latest.json'),'utf8'));
if(!raw.passed||raw.acceptance||!raw.preArchiveAudit?.payloadAuditPassed||!raw.finalPayloadAudit?.payloadAuditPassed)throw Error('VERIFIED_PRODUCTION_PACKAGE_REQUIRED');
const report={...raw,codeSigned:false,bytes:raw.installerBytes,sha256:raw.installerSha256};
const normalized=path.join(root,'.runtime/unified-desktop-download-report.json');await fs.writeFile(normalized,JSON.stringify(report));
await prepareDesktopDownloads({reportFile:normalized,releaseFile:path.join(root,'config/desktop-download-release.json'),outputDirectory:path.join(output,'desktop')});
// The signed desktop feed is prepared separately with the existing release key.
const signed=JSON.parse(await fs.readFile(path.join(output,'desktop/updates/preview.json'),'utf8'));
const publicTrust=JSON.parse(await fs.readFile(path.join(root,'config/desktop-update-trust.json'),'utf8'));
if(!publicTrust.keys.some(key=>key.id===signed.keyId))throw Error('RELEASE_PUBLIC_KEY_MISMATCH');
const manifest=JSON.parse(await fs.readFile(path.join(root,'apps/web/public/downloads/manifest.json'),'utf8'));
const agent=path.join(output,'agent');await fs.mkdir(agent,{recursive:true});
const copies=new Set(['manifest.json','gamehub-agent-latest.vsix','gamehub-dsh-plugin-latest.tgz']);
for(const key of ['editorExtension','harnessPlugin','agentPlugin','creatorTools']){
 const item=manifest[key];if(!item||!/^[-A-Za-z0-9._]+$/.test(item.filename))throw Error('PLUGIN_FILENAME_INVALID');copies.add(item.filename);
 const bytes=await fs.readFile(path.join(root,'apps/web/public/downloads',item.filename));if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('PLUGIN_DIGEST_MISMATCH');
}
for(const filename of copies)await fs.copyFile(path.join(root,'apps/web/public/downloads',filename),path.join(agent,filename));
for(const item of [manifest.updater.windows,manifest.updater.portable]){
 const bytes=await fs.readFile(path.join(root,'apps/web/public',item.filename));if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('UPDATER_DIGEST_MISMATCH');await fs.writeFile(path.join(agent,item.filename),bytes);
}
const release={schemaVersion:1,paperEnabled:false,sourceCommit:raw.sourceCommit,desktopVersion:raw.version,
 editorVersion:manifest.editorExtension.version,harnessVersion:manifest.harnessPlugin.version,agentVersion:manifest.agentPlugin.version,
 desktopKeyId:signed.keyId,desktopPublicKey:publicTrust.keys.find(key=>key.id===signed.keyId).publicKey,files:[]};
async function walk(relative){for(const entry of await fs.readdir(path.join(output,relative),{withFileTypes:true})){const name=relative+'/'+entry.name;if(entry.isDirectory())await walk(name);else{const bytes=await fs.readFile(path.join(output,name));release.files.push({path:name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}}}
await walk('agent');await walk('desktop');release.files.sort((a,b)=>a.path.localeCompare(b.path));await fs.writeFile(path.join(output,'bundle.json'),JSON.stringify(release,null,2)+'\n');
await verifyAssets(output,release);
const filename='mooyu-unified-20261114-chat.tar.gz',archive=path.join(root,'artifacts',filename);
const tar=spawnSync('tar',['-czf',archive,'-C',output,'.'],{windowsHide:true,encoding:'utf8'});if(tar.status!==0)throw Error('ARCHIVE_FAILED: '+tar.stderr);
const bytes=await fs.readFile(archive),config={schemaVersion:1,release:'20261114-chat',archiveFilename:filename,
 archiveSha256:crypto.createHash('sha256').update(bytes).digest('hex'),archiveBytes:bytes.length,
 sourceCommit:release.sourceCommit,desktopVersion:release.desktopVersion,editorVersion:release.editorVersion,harnessVersion:release.harnessVersion,agentVersion:release.agentVersion,desktopKeyId:release.desktopKeyId,paperEnabled:false};
await fs.writeFile(path.join(root,'config/unified-release.json'),JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({...config,archive,distribution:output},null,2));
