import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
import {verifyAssets,stageAssets,activateAssets,rollbackAssets} from '../../deploy/unified-assets.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-unified-assets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const bundle=path.join(root,'bundle'),desktop=path.join(root,'desktop'),agent=path.join(root,'agent'),record=path.join(root,'record');await fs.mkdir(bundle);await fs.mkdir(desktop);await fs.mkdir(agent);
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),keyId=hash(publicKey.export({type:'spki',format:'der'})).slice(0,32),version='0.2.0-preview.7',exe='MooyuWorkshop-'+version+'-x64-Setup.exe',bytes=Buffer.from('MZfixture-installer');
 const payload={schemaVersion:1,product:'mooyu-desktop',platform:'windows',arch:'x64',channel:'preview',version,releasedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),installer:{path:'/downloads/desktop/'+version+'/'+exe,sha256:hash(bytes),sha512:crypto.createHash('sha512').update(bytes).digest('base64'),size:bytes.length,exeSha256:hash(Buffer.from('runtime'))}};
 const signed={keyId,payload,signature:crypto.sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
 const m={schemaVersion:1,paperEnabled:false,desktopVersion:version,editorVersion:'0.4.1',harnessVersion:'0.1.29',agentVersion:'0.4.1',desktopKeyId:keyId,desktopPublicKey:publicKey.export({type:'spki',format:'pem'}).toString(),files:[]};
 const agents={schemaVersion:2};for(const [name,filename,v] of [['editorExtension','editor.vsix',m.editorVersion],['harnessPlugin','harness.tgz',m.harnessVersion],['agentPlugin','portable.json',m.agentVersion]]){const bytes=Buffer.from(filename);agents[name]={filename,version:v,sha256:hash(bytes)};await add('agent/'+filename,bytes);}
 async function add(relative,bytes){const file=path.join(bundle,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);m.files.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});}
 const updater=Buffer.from('verified updater');await add('agent/agent-update.mjs',updater);agents.updater={portable:{filename:'agent-update.mjs',sha256:hash(updater)}};
 await add('agent/manifest.json',Buffer.from(JSON.stringify(agents)));await add('agent/gamehub-creator-tools-v1.json',Buffer.from('{}'));await add('desktop/'+version+'/'+exe,bytes);await add('desktop/'+version+'/SHA256SUMS.txt',Buffer.from(hash(bytes)+'  '+exe));await add('desktop/updates/preview.json',Buffer.from(JSON.stringify(signed)));await add('desktop/manifest.json',Buffer.from(JSON.stringify({windowsX64:{version,filename:exe,sha256:hash(bytes),sizeBytes:bytes.length}})));
 async function save(){await fs.writeFile(path.join(bundle,'bundle.json'),JSON.stringify(m));}await save();
 return {root,bundle,desktop,agent,record,m,bytes,exe,save,privateKey};
}
test('unified assets validate signatures, exact files, release identity and traversal before staging',async t=>{
 const f=await fixture(t);assert.equal((await verifyAssets(f.bundle,{desktopKeyId:f.m.desktopKeyId})).desktopVersion,f.m.desktopVersion);
 await assert.rejects(verifyAssets(f.bundle,{desktopKeyId:'f'.repeat(32)}),/KEY_MISMATCH/);
 await assert.rejects(verifyAssets(f.bundle,{desktopVersion:'different'}),/RELEASE_MISMATCH/);
 const file=path.join(f.bundle,'agent/editor.vsix');await fs.writeFile(file,'tampered');await assert.rejects(verifyAssets(f.bundle),/INTEGRITY_FAILED/);await fs.writeFile(file,'editor.vsix');
 await fs.writeFile(path.join(f.bundle,'unexpected'),'data');await assert.rejects(verifyAssets(f.bundle),/UNDECLARED/);await fs.unlink(path.join(f.bundle,'unexpected'));
 f.m.files[0].path='agent/../../outside';await f.save();await assert.rejects(verifyAssets(f.bundle),/ENTRY_INVALID/);
});
test('staging preserves active manifests, activation rechecks copied bytes, rollback restores pointers and retains immutable files',async t=>{
 const f=await fixture(t);const old=Buffer.from('{"old":true}');await fs.writeFile(path.join(f.agent,'manifest.json'),old);await fs.writeFile(path.join(f.desktop,'manifest.json'),old);
 await stageAssets(f.bundle,f.desktop,f.agent,f.record);assert.deepEqual(await fs.readFile(path.join(f.agent,'manifest.json')),old);
 const exe=path.join(f.desktop,f.m.desktopVersion,f.exe);assert.deepEqual(await fs.readFile(exe),f.bytes);
 await fs.writeFile(exe,'tampered');await assert.rejects(activateAssets(f.bundle,f.desktop,f.agent,f.record),/STAGED_ASSET_CHANGED/);assert.deepEqual(await fs.readFile(path.join(f.desktop,'manifest.json')),old);
 await fs.writeFile(exe,f.bytes);await activateAssets(f.bundle,f.desktop,f.agent,f.record);assert.equal(JSON.parse(await fs.readFile(path.join(f.desktop,'manifest.json'))).windowsX64.version,f.m.desktopVersion);
 await rollbackAssets(f.desktop,f.agent,f.record);assert.deepEqual(await fs.readFile(path.join(f.desktop,'manifest.json')),old);assert.deepEqual(await fs.readFile(path.join(f.agent,'manifest.json')),old);assert.deepEqual(await fs.readFile(exe),f.bytes);
});
test('a version collision never replaces an active pointer or existing package',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.agent,'editor.vsix'),'other release');await fs.writeFile(path.join(f.agent,'manifest.json'),'old');
 await assert.rejects(stageAssets(f.bundle,f.desktop,f.agent,f.record),/VERSION_COLLISION/);assert.equal(await fs.readFile(path.join(f.agent,'manifest.json'),'utf8'),'old');assert.equal(await fs.readFile(path.join(f.agent,'editor.vsix'),'utf8'),'other release');
});
const image=process.env.MOOYU_UNIFIED_HTTP_TEST_IMAGE;
test('production Caddy routes serve verified overrides, preserve fallback packages and support installer Range/HEAD',{skip:!image,timeout:90000},async t=>{
 const f=await fixture(t);await stageAssets(f.bundle,f.desktop,f.agent,f.record);await activateAssets(f.bundle,f.desktop,f.agent,f.record);
 const fallback=path.join(f.root,'fallback');await fs.mkdir(fallback);await fs.writeFile(path.join(fallback,'older.tgz'),'older-package');
 const source=await fs.readFile(new URL('../../deploy/Caddyfile',import.meta.url),'utf8'),start=source.indexOf('  # Serve the locally verified'),end=source.indexOf('  # mooyu-desktop-downloads end')+'  # mooyu-desktop-downloads end'.length;
 assert.ok(start>=0&&end>start);const config=path.join(f.root,'Caddyfile');await fs.writeFile(config,':80 {\n'+source.slice(start,end)+'\nhandle {\n respond "SPA fallback"\n}\n}\n');
 const name='mooyu-unified-http-'+crypto.randomUUID();const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true});
 docker('run','-d','--name',name,'--label','mooyu.task=unified-release-test','--memory','96m','-p','127.0.0.1::80','-v',config+':/etc/caddy/Caddyfile:ro','-v',f.agent+':/srv/agent-downloads:ro','-v',f.desktop+':/srv/desktop-downloads:ro','-v',fallback+':/srv/gamehub/downloads:ro',image);
 t.after(()=>docker('rm','-f',name));const info=JSON.parse(docker('inspect',name))[0],port=info.NetworkSettings.Ports['80/tcp'][0].HostPort,base='http://127.0.0.1:'+port;
 let response;for(let n=0;n<50;n++){try{response=await fetch(base+'/downloads/manifest.json');if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(response,'Caddy did not start: '+docker('logs',name));assert.equal(response.status,200,docker('logs',name));assert.equal(hash(Buffer.from(await response.arrayBuffer())),f.m.files.find(r=>r.path==='agent/manifest.json').sha256);
 assert.equal(await (await fetch(base+'/downloads/older.tgz')).text(),'older-package');assert.equal((await fetch(base+'/downloads/missing.tgz')).status,404);
 assert.equal(await (await fetch(base+'/agent-update.mjs')).text(),'verified updater');
 const url=base+'/downloads/desktop/'+f.m.desktopVersion+'/'+f.exe;const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),f.bytes.length);
 const range=await fetch(url,{headers:{Range:'bytes=0-1'}});assert.equal(range.status,206);assert.equal(await range.text(),'MZ');assert.equal((await fetch(url,{method:'POST'})).status,405);
});
