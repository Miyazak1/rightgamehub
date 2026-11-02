import fs from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonicalUpdate,updateKeyId,updateVersion} from '../apps/desktop/src/update-manifest.mjs';

export async function prepareDesktopUpdate({reportFile,keyFile,directory,acceptance=false,now=Date.now()}) {
  const root=path.resolve(directory),keyPath=path.resolve(keyFile),relative=path.relative(root,keyPath);
  if(!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('UPDATE_KEY_MUST_BE_OUTSIDE_DISTRIBUTION');
  const report=JSON.parse(await fs.readFile(reportFile,'utf8'));
  if(report.passed!==true||report.acceptance!==acceptance||!report.preArchiveAudit?.payloadAuditPassed||!report.finalPayloadAudit?.payloadAuditPassed||!updateVersion(report.version))throw Error('UPDATE_AUDITED_PACKAGE_REQUIRED');
  const stat=await fs.lstat(report.installer);if(!stat.isFile()||stat.isSymbolicLink())throw Error('UPDATE_INSTALLER_TYPE_DENIED');
  const sha256=crypto.createHash('sha256'),sha512=crypto.createHash('sha512');for await(const chunk of createReadStream(report.installer)){sha256.update(chunk);sha512.update(chunk);}
  const digest=sha256.digest('hex'),digest512=sha512.digest('base64');
  if(digest!==report.installerSha256||stat.size!==report.installerBytes)throw Error('UPDATE_PACKAGE_INTEGRITY_FAILED');
  const executableStat=await fs.lstat(report.executable);if(!executableStat.isFile()||executableStat.isSymbolicLink())throw Error('UPDATE_EXECUTABLE_TYPE_DENIED');
  const executableHash=crypto.createHash('sha256');for await(const chunk of createReadStream(report.executable))executableHash.update(chunk);const exeSha256=executableHash.digest('hex');
  const key=crypto.createPrivateKey(await fs.readFile(keyPath));if(key.asymmetricKeyType!=='ed25519')throw Error('UPDATE_SIGNING_KEY_INVALID');
  const publicKey=crypto.createPublicKey(key),channel=report.version.includes('-preview.')?'preview':'stable';
  const payload={schemaVersion:1,product:acceptance?'mooyu-desktop-acceptance':'mooyu-desktop',platform:'windows',arch:'x64',channel,version:report.version,releasedAt:new Date(now).toISOString(),expiresAt:new Date(now+7*86400000).toISOString(),installer:{path:`/downloads/desktop/${report.version}/MooyuWorkshop-${report.version}-x64-Setup.exe`,size:stat.size,sha256:digest,sha512:digest512,exeSha256}};
  const envelope={keyId:updateKeyId(publicKey),payload,signature:crypto.sign(null,Buffer.from(canonicalUpdate(payload)),key).toString('base64')};
  for(const target of [root,path.join(root,report.version),path.join(root,'updates')]){await fs.mkdir(target,{recursive:true});if((await fs.lstat(target)).isSymbolicLink())throw Error('UPDATE_DIRECTORY_LINK_DENIED');}
  const installer=path.join(root,report.version,path.posix.basename(payload.installer.path));
  try{await fs.copyFile(report.installer,installer,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;const existing=await fs.lstat(installer);if(!existing.isFile()||existing.isSymbolicLink()||existing.size!==stat.size)throw Error('UPDATE_VERSION_COLLISION');const h=crypto.createHash('sha256');for await(const chunk of createReadStream(installer))h.update(chunk);if(h.digest('hex')!==digest)throw Error('UPDATE_VERSION_COLLISION');}
  const feed=path.join(root,'updates',channel+'.json'),temporary=feed+'.'+crypto.randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,JSON.stringify(envelope,null,2)+'\n',{flag:'wx',mode:0o644});await fs.rename(temporary,feed);}finally{await fs.rm(temporary,{force:true});}
  return {prepared:true,version:report.version,feed,installer,publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),keyId:envelope.keyId,uploaded:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const options={};for(let i=2;i<process.argv.length;i+=2){if(!['--report','--private-key','--output','--acceptance'].includes(process.argv[i])||!process.argv[i+1]||options[process.argv[i]])throw Error('UPDATE_OPTIONS_INVALID');options[process.argv[i]]=process.argv[i+1];}
  if(!options['--report']||!options['--private-key']||!options['--output']||options['--acceptance']&&!['true','false'].includes(options['--acceptance']))throw Error('UPDATE_OPTIONS_INVALID');
  console.log(JSON.stringify(await prepareDesktopUpdate({reportFile:options['--report'],keyFile:options['--private-key'],directory:options['--output'],acceptance:options['--acceptance']==='true'}),null,2));
}
