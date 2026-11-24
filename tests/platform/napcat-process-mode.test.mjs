import test from 'node:test';import assert from 'node:assert/strict';
import {gatewayComparable,gatewayModeSequence,assertGatewayPorts,assertGatewayUlimits} from '../../scripts/repair-napcat-process-mode.mjs';
const fixture=()=>({Config:{Image:'old',Hostname:'generated',Env:['KEEP=yes','NAPCAT_DISABLE_MULTI_PROCESS=1'],Labels:{'com.docker.compose.config-hash':'old',keep:'same'},Cmd:['/app/load.cjs'],User:'1000'},HostConfig:{Binds:['login:/data:rw','config:/config:ro'],PortBindings:{'6099/tcp':[{HostIp:'127.0.0.1',HostPort:'16099'}]},ReadonlyRootfs:true,CapDrop:['ALL'],RestartPolicy:{Name:'unless-stopped'}},Mounts:[{Type:'volume',Name:'login',Source:'/volume',Destination:'/data',RW:true}],NetworkSettings:{Networks:{qq:{Aliases:['napcat','gateway']}}}});
test('only the selected process flag may differ; native image, security, port and login volume remain protected',()=>{
 const old=fixture(),next=structuredClone(old);next.Config.Env=['NAPCAT_DISABLE_MULTI_PROCESS=0','KEEP=yes'];next.Config.Hostname='new-generated';next.Config.AttachStdout=true;next.Config.Labels['com.docker.compose.config-hash']='new';next.HostConfig.Binds.reverse();
 assert.deepEqual(gatewayComparable(next,'1'),gatewayComparable(old,'1'));
 for(const change of [c=>c.Config.User='0',c=>c.Config.Env.push('NAPCAT_WORKER_PROCESS=1'),c=>c.HostConfig.PortBindings['6099/tcp'][0].HostIp='0.0.0.0',c=>c.HostConfig.ReadonlyRootfs=false,c=>c.Mounts[0].Name='another',c=>c.NetworkSettings.Networks.qq.Aliases=['other'],c=>c.Config.Labels.keep='changed']){const x=structuredClone(next);change(x);assert.notDeepEqual(gatewayComparable(x,'1'),gatewayComparable(old,'1'));}
});
test('both validated backups precede recreation; failure never continues or retries another service',async()=>{
 const steps=['preflight','record','warmBackup','recheck','stop','coldBackup','start','verify'];const seen=[];
 await gatewayModeSequence(Object.fromEntries(steps.map(s=>[s,async()=>seen.push(s)])));assert.deepEqual(seen,steps);
 for(const bad of steps){const log=[];await assert.rejects(gatewayModeSequence(Object.fromEntries(steps.map(s=>[s,async()=>{log.push(s);if(s===bad)throw Error('STOP');}]))));assert.deepEqual(log,steps.slice(0,steps.indexOf(bad)+1));}
});
test('the existing local-only management port must match the full compose declaration before any stop',()=>{
 const c=fixture(),s={ports:[{target:6099,published:'16099',protocol:'tcp',host_ip:'127.0.0.1'}]};assert.doesNotThrow(()=>assertGatewayPorts(c,s));
 for(const mutate of [v=>v.ports[0].host_ip='0.0.0.0',v=>v.ports[0].published='16098',v=>delete v.ports[0].published]){const x=structuredClone(s);mutate(x);assert.throws(()=>assertGatewayPorts(c,x));}
});
test('canonical Compose zero omission is equivalent to explicit core 0/0, without accepting missing or changed runtime limits',()=>{
 const c={HostConfig:{Ulimits:[{Name:'core',Soft:0,Hard:0}]}};
 for(const value of [0,{}, {soft:0,hard:0},{single:0}])assert.doesNotThrow(()=>assertGatewayUlimits(c,{ulimits:{core:value}}));
 for(const value of [-1,{soft:0,hard:-1},{single:1024}])assert.throws(()=>assertGatewayUlimits(c,{ulimits:{core:value}}),/DECLARED_ULIMIT_MISMATCH/);
 assert.throws(()=>assertGatewayUlimits({HostConfig:{Ulimits:[]}}, {ulimits:{core:{}}}),/DECLARED_ULIMIT_MISMATCH/);
 for(const value of [null,'0',[],{soft:null},{soft:'0'},{unknown:0},{single:0,soft:0}])assert.throws(()=>assertGatewayUlimits(c,{ulimits:{core:value}}),/ULIMIT_FORMAT_REVIEW_REQUIRED/);
 const partial={HostConfig:{Ulimits:[{Name:'nofile',Soft:0,Hard:4096}]}};assert.doesNotThrow(()=>assertGatewayUlimits(partial,{ulimits:{nofile:{hard:4096}}}));
});
