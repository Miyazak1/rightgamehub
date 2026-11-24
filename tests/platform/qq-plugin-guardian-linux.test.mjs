import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {runGuardian,qqIdentityHash,acquireGuardianLease} from '../../scripts/qq-plugin-guardian.mjs';
test('Linux host guardian persists its circuit breaker, fully verifies backups and starts only the same simulated gateway',{skip:process.platform!=='linux'||process.getuid?.()!==0},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-guardian-isolated-')),oldPath=process.env.PATH;
 try{
  fs.chmodSync(root,0o700);const bin=path.join(root,'bin'),data=path.join(root,'login');fs.mkdirSync(bin);fs.mkdirSync(data);fs.writeFileSync(path.join(data,'synthetic-session'),'preserve-login-and-history');
  const lease=path.join(root,'lease');fs.mkdirSync(lease,{mode:0o700});assert.equal(acquireGuardianLease(lease),null);assert(fs.existsSync(lease));fs.writeFileSync(path.join(lease,'qq-guardian-owner.private.json'),JSON.stringify({kind:'mooyu-qq-guardian-v1',pid:99999999,start:'1',boot:'previous-boot'}),{mode:0o600});const release=acquireGuardianLease(lease);assert.equal(typeof release,'function');assert.equal(acquireGuardianLease(lease),null);release();assert(!fs.existsSync(lease));
  const archive=path.join(root,'synthetic.tar');assert.equal(spawnSync('tar',['-cf',archive,'-C',data,'.']).status,0);
  const gateway={Id:'a'.repeat(64),Name:'/mooyu-qq-napcat-1',Image:'sha256:'+'b'.repeat(64),State:{Running:true,Restarting:false},Config:{Env:['NAPCAT_DISABLE_MULTI_PROCESS=0']},HostConfig:{},Mounts:[{Type:'volume',Name:'synthetic_login',Source:data,Destination:'/data'}],NetworkSettings:{Networks:{}}};
  fs.writeFileSync(path.join(root,'container.json'),JSON.stringify(gateway));
  const config={version:1,enabled:true,gateway:'mooyu-qq-napcat-1',worker:'mooyu-qq-worker-1',image:gateway.Image,identityHash:qqIdentityHash(gateway),loginVolume:'synthetic_login',botId:'3922489710',groupId:'905757031'},file=path.join(root,'config.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
  const snapshot={binding:{botId:config.botId},groupId:config.groupId,paperEnabled:false,runtime:{snapshotVersion:2,available:true,loggedIn:false,connected:false,restartRequired:true,phase:'offline',checkedAt:new Date().toISOString(),verifiedAt:new Date().toISOString()}};fs.writeFileSync(path.join(root,'snapshot.json'),JSON.stringify(snapshot));
  fs.writeFileSync(path.join(root,'recovery-state.private.json'),JSON.stringify({version:1,attempts:[],manualRequired:false,incident:{firstAt:Date.now()-61000,samples:2,lastSample:new Date(Date.now()-30000).toISOString()}}),{mode:0o600});
  const docker=path.join(bin,'docker');
  fs.writeFileSync(docker,`#!/usr/bin/env node\nconst fs=require('fs'),p=${JSON.stringify(root)},a=process.argv.slice(2),c=JSON.parse(fs.readFileSync(p+'/container.json'));fs.appendFileSync(p+'/commands.jsonl',JSON.stringify(a.slice(0,3))+'\\n');
if(a[0]==='inspect'&&a[1]==='mooyu-qq-napcat-1')console.log(JSON.stringify([c]));
else if(a[0]==='exec'&&a[1]==='mooyu-qq-worker-1'){if(a.at(-1).includes("status='sending'"))console.log('{"count":0}');else console.log(fs.readFileSync(p+'/snapshot.json','utf8'));}
else if(a[0]==='cp'&&a[1]==='-a'&&a[2]==='mooyu-qq-napcat-1:/data/.'&&a[3]==='-')process.stdout.write(fs.readFileSync(p+'/synthetic.tar'));
else if(a[0]==='stop'&&a.at(-1)==='mooyu-qq-napcat-1'){c.State.Running=false;fs.writeFileSync(p+'/container.json',JSON.stringify(c));}
else if(a[0]==='start'&&a[1]==='mooyu-qq-napcat-1'){c.State.Running=true;fs.writeFileSync(p+'/container.json',JSON.stringify(c));}
else process.exit(9);\n`,{mode:0o700});
  process.env.PATH=bin+path.delimiter+oldPath;
  const result=await runGuardian({configFile:file,stateDirectory:root,apply:true});assert.equal(result.action,'gateway-started');assert.equal(result.loginDataRetained,true);
  const state=JSON.parse(fs.readFileSync(path.join(root,'recovery-state.private.json')));assert.equal(state.attempts.length,1);assert.equal(state.manualRequired,false);assert(state.incidentHandled);
  const receipts=JSON.parse(fs.readFileSync(path.join(state.recoveryDirectory,'backups.private.json')));assert.equal(receipts.length,2);assert(receipts.every(r=>r.fullyDecoded&&r.sha256.length===64));assert.equal(receipts[1].quiesced,true);
  assert.equal(fs.readFileSync(path.join(data,'synthetic-session'),'utf8'),'preserve-login-and-history');
  const second=await runGuardian({configFile:file,stateDirectory:root,apply:true});assert.equal(second.reason,'incident-already-handled');
  const commands=fs.readFileSync(path.join(root,'commands.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(commands.filter(a=>a[0]==='stop').length,1);assert.equal(commands.filter(a=>a[0]==='start').length,1);assert(commands.every(a=>!['compose','rm','restart'].includes(a[0])));
 }finally{process.env.PATH=oldPath;const target=fs.realpathSync(root);assert(target.startsWith(fs.realpathSync(os.tmpdir())+path.sep));assert(path.basename(target).startsWith('qq-guardian-isolated-'));fs.rmSync(target,{recursive:true});}
});
