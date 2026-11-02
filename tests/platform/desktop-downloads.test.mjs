import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {prepareDesktopDownloads} from '../../scripts/lib/desktop-downloads.mjs';
import {validateDesktopDownloadManifest,loadDesktopDownloadManifest} from '../../packages/platform-client/src/desktop-download.mjs';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function fixture(t,version='0.2.0-preview.3'){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-download-'));t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),'mooyu-download-')));await fs.rm(dir,{recursive:true,force:true});});
  const bytes=Buffer.from('MZ\0synthetic installer, never execute'),name=`MooyuWorkshop-${version}-x64-Setup.exe`,installer=path.join(dir,name),reportFile=path.join(dir,'report.json'),releaseFile=path.join(dir,'release.json'),outputDirectory=path.join(dir,'downloads/desktop');
  await fs.writeFile(installer,bytes);const report={passed:true,version,installer,bytes:bytes.length,sha256:hash(bytes),codeSigned:false,preArchiveAudit:{payloadAuditPassed:true},finalPayloadAudit:{payloadAuditPassed:true},privateCredential:'not-for-public-output',profileRoot:'C:\\private-profile'};
  const info={version,releaseDate:'2026-11-02',notes:{'zh-CN':['测试预览版本。'],en:['Test preview.']}};
  await fs.writeFile(reportFile,JSON.stringify(report));await fs.writeFile(releaseFile,JSON.stringify(info));return {dir,bytes,name,report,info,installer,reportFile,releaseFile,outputDirectory};
}
const publicManifest=async f=>JSON.parse(await fs.readFile(path.join(f.outputDirectory,'manifest.json')));
test('local preparation verifies bytes, creates separate public metadata and leaves the Agent manifest unchanged',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.dir,'downloads'));await fs.writeFile(path.join(f.dir,'downloads/manifest.json'),'existing Agent manifest');
  const result=await prepareDesktopDownloads(f),manifest=await publicManifest(f);assert.equal(result.uploaded,false);assert.equal(result.deployed,false);assert.equal(manifest.windowsX64.sha256,hash(f.bytes));assert.deepEqual(validateDesktopDownloadManifest(manifest),manifest);
  assert.deepEqual(await fs.readFile(result.installer),f.bytes);assert.match(await fs.readFile(path.join(f.outputDirectory,f.info.version,'SHA256SUMS.txt'),'utf8'),new RegExp('^'+hash(f.bytes)));
  const serialized=JSON.stringify(manifest);for(const privateText of ['privateCredential','profileRoot','C:\\','report.json','.runtime'])assert.equal(serialized.includes(privateText),false);
  assert.equal(await fs.readFile(path.join(f.dir,'downloads/manifest.json'),'utf8'),'existing Agent manifest');assert.equal((await fs.readdir(f.outputDirectory)).includes('.prepare.lock'),false);
  const before=await fs.readFile(path.join(f.outputDirectory,'manifest.json'));await prepareDesktopDownloads(f);assert.deepEqual(await fs.readFile(path.join(f.outputDirectory,'manifest.json')),before);
});
test('corrupt input cannot activate a new version and temporary files are removed',async t=>{
  const f=await fixture(t);await prepareDesktopDownloads(f);const before=await fs.readFile(path.join(f.outputDirectory,'manifest.json'));
  f.info.version='0.2.0-preview.4';f.report.version=f.info.version;f.report.installer=path.join(f.dir,`MooyuWorkshop-${f.info.version}-x64-Setup.exe`);await fs.writeFile(f.report.installer,'changed, not the audited file');await fs.writeFile(f.reportFile,JSON.stringify(f.report));await fs.writeFile(f.releaseFile,JSON.stringify(f.info));
  await assert.rejects(prepareDesktopDownloads(f),/INTEGRITY_FAILED/);assert.deepEqual(await fs.readFile(path.join(f.outputDirectory,'manifest.json')),before);assert.deepEqual(await fs.readdir(path.join(f.outputDirectory,f.info.version)),[]);
});
test('an immutable version collision preserves both the active pointer and old installer',async t=>{
  const f=await fixture(t),result=await prepareDesktopDownloads(f),before=await fs.readFile(path.join(f.outputDirectory,'manifest.json'));
  const changed=Buffer.from('MZchanged installer');await fs.writeFile(f.installer,changed);f.report.bytes=changed.length;f.report.sha256=hash(changed);await fs.writeFile(f.reportFile,JSON.stringify(f.report));
  await assert.rejects(prepareDesktopDownloads(f),/VERSION_COLLISION/);assert.deepEqual(await fs.readFile(result.installer),f.bytes);assert.deepEqual(await fs.readFile(path.join(f.outputDirectory,'manifest.json')),before);
});
test('the single-writer lock refuses a second preparer without removing another writer lock',async t=>{
  const f=await fixture(t);await fs.mkdir(f.outputDirectory,{recursive:true});await fs.writeFile(path.join(f.outputDirectory,'.prepare.lock'),'other writer');await assert.rejects(prepareDesktopDownloads(f),/PREPARATION_BUSY/);assert.equal(await fs.readFile(path.join(f.outputDirectory,'.prepare.lock'),'utf8'),'other writer');
});
test('concurrent preparations produce one consistent active release',async t=>{
  const f=await fixture(t);const results=await Promise.allSettled([prepareDesktopDownloads(f),prepareDesktopDownloads(f)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/PREPARATION_BUSY/);assert.equal((await publicManifest(f)).windowsX64.sha256,hash(f.bytes));
});
test('linked destinations and non-PE bytes cannot become active downloads',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.dir,'outside'));await fs.symlink(path.join(f.dir,'outside'),f.outputDirectory,'junction').catch(async error=>{if(error.code==='ENOENT'){await fs.mkdir(path.dirname(f.outputDirectory));await fs.symlink(path.join(f.dir,'outside'),f.outputDirectory,'junction');}else throw error;});await assert.rejects(prepareDesktopDownloads(f),/DIRECTORY_DENIED/);
  const g=await fixture(t);const bytes=Buffer.from('<html>not an installer</html>');await fs.writeFile(g.installer,bytes);g.report.bytes=bytes.length;g.report.sha256=hash(bytes);await fs.writeFile(g.reportFile,JSON.stringify(g.report));await assert.rejects(prepareDesktopDownloads(g),/NOT_PE/);await assert.rejects(fs.access(path.join(g.outputDirectory,'manifest.json')));
});
test('manifest validation pins platform, preview status, same-origin artifact paths and integrity metadata',async t=>{
  const f=await fixture(t);await prepareDesktopDownloads(f);const value=await publicManifest(f);const bad=[{url:'https://evil.test/setup.exe'},{url:'javascript:alert(1)'},{url:value.windowsX64.url+'?token=x'},{checksumUrl:'/downloads/manifest.json'},{filename:'other.exe'},{signature:'signed'},{sha256:'x'.repeat(64)},{sizeBytes:0},{releaseDate:'2026-02-30'},{platform:'macos'},{version:'../private'}];
  for(const patch of bad)assert.throws(()=>validateDesktopDownloadManifest({...value,windowsX64:{...value.windowsX64,...patch}}),/MANIFEST_INVALID/);assert.throws(()=>validateDesktopDownloadManifest({...value,channel:'stable'}),/MANIFEST_INVALID/);
});
test('the page loader rejects HTML fallback, 404, redirects and oversized manifests',async t=>{
  const f=await fixture(t);await prepareDesktopDownloads(f);const value=await publicManifest(f);let options;
  assert.deepEqual(await loadDesktopDownloadManifest(async(url,settings)=>{assert.equal(url,'/downloads/desktop/manifest.json');options=settings;return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});}),value);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  for(const response of [new Response('not found',{status:404}),new Response('<html>SPA</html>',{headers:{'content-type':'text/html'}}),new Response('x'.repeat(32769),{headers:{'content-type':'application/json'}})])await assert.rejects(loadDesktopDownloadManifest(async()=>response));
  await assert.rejects(loadDesktopDownloadManifest(async()=>({ok:true,redirected:true,headers:new Headers({'content-type':'application/json'})})),/UNAVAILABLE/);
});
