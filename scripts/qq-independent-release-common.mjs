import fs from 'node:fs';import crypto from 'node:crypto';
export const QQ_RELEASE_ID='qq-independent-20261124-r1';
export const QQ_RELEASE_STAGE='/www/backup/gamehub/qq-independent-plugin-release-20261124-r1';
export const QQ_BASES=Object.freeze({api:'sha256:2b6e0cbc637cdbb1081b803e5b0600053ed3c005a07a7a85e1eee9353b8c5a32',web:'sha256:b41b96165cfce091ef8890debda68c2920cc0fc18f775f21e70572ee6613fdcb',worker:'sha256:7c617838dc3b53987886cf132344dc39b6ac4c69280486ab2107e67cd476797b',localWorker:'sha256:59aa36815825b97d4acddc02b1dd29cb6d6fb3779aac8a5357cf9c626972ba63',gateway:'sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d'});
export const QQ_RELEASE_ROLES=Object.freeze([{key:'api',name:'gamehub-production-api-1',project:'gamehub-production',service:'api'},{key:'web',name:'gamehub-production-web-1',project:'gamehub-production',service:'web'},{key:'worker',name:'mooyu-qq-worker-1',project:'mooyu-qq',service:'worker'}]);
export const QQ_WORKER_PATCHES=Object.freeze(['napcat-control.mjs','control-server.mjs','control-store.mjs','plugins/qq/runtime.mjs']);
export function workerImageProbe(){return "const f=require('fs'),c=require('crypto');console.log(JSON.stringify({uid:process.getuid(),files:Object.fromEntries("+JSON.stringify(QQ_WORKER_PATCHES)+".map(p=>{const file='/app/apps/qq-channel/src/'+p,s=f.statSync(file);return [p,{sha256:c.createHash('sha256').update(f.readFileSync(file)).digest('hex'),owner:s.uid,mode:s.mode&511}];}))}));";}
export function assertWorkerImageProbe(probe,sources){if(probe.uid===0||QQ_WORKER_PATCHES.some(f=>probe.files[f]?.sha256!==sources[f]||probe.files[f]?.owner!==probe.uid||probe.files[f]?.mode!==0o444))throw Error('WORKER_NONROOT_SOURCE_PROOF_FAILED');}
export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const objectHash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function fileHash(file){const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),b=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');}
export const containerEnv=c=>Object.fromEntries((c.Config.Env??[]).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
export function runtimeComparable(c){
 const config=structuredClone(c.Config);for(const k of ['Image','Hostname','AttachStdin','AttachStdout','AttachStderr'])delete config[k];config.Env=(config.Env??[]).slice().sort();config.Labels=Object.fromEntries(Object.entries(config.Labels??{}).filter(([k])=>!k.startsWith('com.docker.compose.')));
 const host=structuredClone(c.HostConfig);host.Binds?.sort();host.Mounts?.sort((a,b)=>String(a.Target).localeCompare(String(b.Target)));
 return {config,host,mounts:c.Mounts.map(m=>[m.Type,m.Name??'',m.Source,m.Destination,m.RW]).sort(),networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()};
}
export async function independentDeploymentSequence(a){await a.preflight();await a.record();await a.prepareWorker();await a.prepareGuardian();await a.stopWorker();await a.stopApi();await a.backup();await a.startApi();await a.startWorker();await a.startWeb();await a.verifyPreservation();await a.enableGuardian();await a.verifyFinal();}
