import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {wsSwitchSequence,rebindWSGuardian,assertWSGuardianState,assertWSRuntime,createWSBuildContext,wsGatewayUlimits,wsGatewayPorts,wsNewMessageSQL} from '../../scripts/qq-websocket-release-common.mjs';
import {qqIdentityHash} from '../../scripts/qq-plugin-guardian.mjs';
const container=()=>({Id:'a'.repeat(64),Name:'/mooyu-qq-napcat-1',Image:'sha256:'+'b'.repeat(64),Config:{Hostname:'same-device',Env:['NAPCAT_DISABLE_MULTI_PROCESS=0'],Labels:{}},HostConfig:{RestartPolicy:{Name:'no'},Ulimits:[{Name:'core',Soft:0,Hard:0}]},Mounts:[{Type:'volume',Name:'retained_login',Source:'/synthetic/login',Destination:'/data',RW:true}],NetworkSettings:{Networks:{}}});
test('guardian validation preserves exhausted counters and refuses malformed state or clock rollback',()=>{
 const now=Date.now(),s={version:1,attempts:[now-10000,now-5000],manualRequired:false,lastAt:now};const original=structuredClone(s);
 assert.equal(assertWSGuardianState(s,now).recentAttempts,2);assert.deepEqual(s,original);
 for(const value of [null,{...s,attempts:null},{...s,manualRequired:true},{...s,lastAt:now+1}])assert.throws(()=>assertWSGuardianState(value,now));
});
test('gateway switch stops only after build and warm backup; no failure automatically retries or rolls back',async()=>{
 const phases=['preflight','record','build','warmBackup','recheck','stopWorker','stopGateway','coldBackup','startGateway','bindGuardian','cooldown','startWorker','verify'];
 for(const failure of [...phases,null]){const seen=[];const io=Object.fromEntries(phases.map(p=>[p,async()=>{seen.push(p);if(p===failure)throw Error('INJECTED');}]));if(failure)await assert.rejects(wsSwitchSequence(io),/INJECTED/);else await wsSwitchSequence(io);assert.deepEqual(seen,failure?phases.slice(0,phases.indexOf(failure)+1):phases);assert(seen.filter(p=>p==='stopGateway').length<=1);assert(seen.filter(p=>p==='startWorker').length<=1);}
});
test('guardian rebind changes only the image and identity, preserving enablement, channel and login volume',()=>{
 const c=container(),before={version:1,enabled:true,gateway:'mooyu-qq-napcat-1',worker:'mooyu-qq-worker-1',image:c.Image,identityHash:qqIdentityHash(c),loginVolume:'retained_login',botId:'3922489710',groupId:'905757031'};c.Id='c'.repeat(64);c.Image='sha256:'+'d'.repeat(64);
 const next=rebindWSGuardian(before,before,c);assert.equal(next.image,c.Image);assert.equal(next.identityHash,qqIdentityHash(c));for(const k of Object.keys(before).filter(k=>!['image','identityHash'].includes(k)))assert.deepEqual(next[k],before[k]);
 assert.throws(()=>rebindWSGuardian({...before,enabled:false},before,c));c.Mounts[0].Name='other';assert.throws(()=>rebindWSGuardian(before,before,c));
});
test('runtime comparison refuses changed login, device, resources, native recovery mode or command',()=>{
 const before=container(),next=structuredClone(before);next.Image='sha256:'+'e'.repeat(64);assertWSRuntime(next,before,next.Image);
 for(const change of [c=>c.Config.Hostname='different-device',c=>c.Config.Env=['NAPCAT_DISABLE_MULTI_PROCESS=1'],c=>c.HostConfig.Memory=1024,c=>c.Mounts[0].Source='/other',c=>c.Config.Cmd=['different']]){const c=structuredClone(next);change(c);assert.throws(()=>assertWSRuntime(c,before,next.Image));}
});
test('Compose canonical zero core limit and exact published bindings are preserved',()=>{
 const c=container();wsGatewayUlimits(c,{ulimits:{core:{}}});wsGatewayUlimits(c,{ulimits:{core:0}});assert.throws(()=>wsGatewayUlimits(c,{ulimits:{core:{hard:1}}}));
 c.HostConfig.PortBindings={'6099/tcp':[{HostIp:'127.0.0.1',HostPort:'6099'}]};wsGatewayPorts(c,{ports:[{target:6099,published:'6099',host_ip:'127.0.0.1'}]});assert.throws(()=>wsGatewayPorts(c,{ports:[]}));
});
test('new native image context cannot include private records or login backups',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-ws-context-'));t.after(()=>{assert(fs.realpathSync(dir).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true});});fs.writeFileSync(path.join(dir,'state.private.json'),'PRIVATE');fs.writeFileSync(path.join(dir,'login.tar'),'PRIVATE');const context=createWSBuildContext(dir,'audited-patch','mooyu-qq-ws-base:20261127-Test12');assert.deepEqual(fs.readdirSync(context).sort(),['Dockerfile','napcat.mjs']);assert.equal(fs.readFileSync(path.join(context,'napcat.mjs'),'utf8'),'audited-patch');assert.throws(()=>createWSBuildContext(dir,'patch','bad\nCOPY private /app'));
});
test('acceptance query requires fresh matching test input and a confirmed direct or child reply',()=>{
 const q=wsNewMessageSQL('2026-11-27T14:31:51Z');assert(q.includes('2026-11-27T14:31:51.000Z'));assert(q.includes("m.status='delivered' AND m.remote_message_id IS NOT NULL"));assert(q.includes('agent_deliveries'));assert(q.includes('QQ连接修复验收20261127R1'));assert.throws(()=>wsNewMessageSQL("x' OR true"));
});
