// Extract and validate only a newly prepared local release, never run its updater.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileHash} from './qq-independent-release-common.mjs';
const packageDir=path.resolve(process.argv[2]??''),out=path.resolve(process.argv[3]??'');
for(const p of [packageDir,out])assert(p.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\20261127\\'));assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const info=JSON.parse(fs.readFileSync(packageDir+'/package-result.json','utf8'));assert.equal(info.result,'QQ_WEBSOCKET_RELEASE_PREPARED_NOT_DEPLOYED');assert.equal(fileHash(info.archive),info.sha256);
const call=(command,args,options={})=>{const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,...options});assert.equal(r.status,0,command+'_FAILED');return r.stdout;};
const list=call('tar',['-tzf',info.archive]).trim().split(/\r?\n/);assert(list.every(p=>/^[A-Za-z0-9_./-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').includes('..')));call('tar',['-xzf',info.archive,'-C',out]);
const manifest=JSON.parse(fs.readFileSync(out+'/manifest.json','utf8'));
for(const f of manifest.files)assert.equal(fileHash(path.join(out,f.path)),f.sha256,f.path);
for(const line of fs.readFileSync(out+'/SHA256SUMS','utf8').trim().split('\n')){const m=line.match(/^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/);assert(m);assert.equal(fileHash(path.join(out,m[2])),m[1],m[2]);}
assert.deepEqual(list.slice().sort(),[...manifest.files.map(v=>v.path),'manifest.json','SHA256SUMS'].sort());
assert(!list.some(p=>/\.private\.|login.*\.tar|\.dump$|images\.tar|\.env$/.test(p)));
const modules=list.filter(p=>p.endsWith('.mjs'));for(const p of modules)call(process.execPath,['--check',path.join(out,p)]);
const probe=`import assert from 'node:assert/strict';for(const p of ${JSON.stringify(modules)})await import('file:///package/'+p);const{updateQQWebSocket}=await import('file:///package/scripts/update-qq-websocket-owner.mjs');await assert.rejects(updateQQWebSocket('plan'),/WS_RELEASE_ENTRY_REQUIRED/);console.log(JSON.stringify({imports:${modules.length},nonProductionEntryRefused:true}));`;
const imported=JSON.parse(call('docker',['run','--rm','--network','none','--read-only','--entrypoint','node','--mount','type=bind,source='+out+',target=/package,readonly','sha256:0bd01de2df9ebae386cd5636f2a2f4282e2250bb917ed88fda90c4ab65a89459','--input-type=module','-e',probe]));
for(const name of info.commands){const body=fs.readFileSync(packageDir+'/'+name,'utf8');call('C:/Program Files/Git/bin/bash.exe',['-n'],{input:body});if(name==='server-update-gateway.txt'||name==='server-rollback-gateway.txt')assert(body.includes('flock -n 9')&&body.includes('flock -w 20 8'));}
const result={result:'PASSED',archiveSha256:info.sha256,manifestFiles:manifest.files.length,archiveMembers:list.length,modulesParsed:modules.length,linuxImportsResolved:imported.imports,nonProductionEntryRefused:imported.nonProductionEntryRefused,bashCommandsParsed:info.commands.length,privateLoginOrDatabaseDataIncluded:false,serverCommandsExecuted:false,productionAccessed:false};fs.writeFileSync(packageDir+'/archive-acceptance.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
