// Standalone host diagnostic. Reads the existing worker's signed snapshot;
// never creates a NapCat management client, requests a QR, or starts recovery.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const safe=e=>/^[A-Z0-9_]{1,80}$/u.test(e?.code??'')?e.code:'READ_FAILED';
const run=(cmd,args,{allowFailure=false}={})=>{
 const r=spawnSync(cmd,args,{encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
 if(r.status!==0||r.error){if(allowFailure)return null;throw Error('READ_TOOL_FAILED');}return r.stdout.trim();
};
const emit=(section,data)=>console.log(JSON.stringify({section,...data}));
const readJson=file=>{
 const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024)throw Error('PRIVATE_RECORD_INVALID');
 return JSON.parse(fs.readFileSync(file,'utf8'));
};
const controlProbe=String.raw`
import fs from 'node:fs';import crypto from 'node:crypto';
import {qqSignature} from '/app/apps/api/src/qq-admin-protocol.mjs';
const secret=fs.readFileSync(process.env.QQ_ADMIN_SECRET_FILE,'utf8').trim(),agent=process.env.QQ_ADMIN_AGENT_USER_ID;
const time=String(Date.now()),id=crypto.randomUUID(),body=JSON.stringify({operation:'status',actorId:agent,agentUserId:agent,args:{}});
try{
 const r=await fetch('http://127.0.0.1:6780/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':time,'x-qq-request':id,'x-qq-signature':qqSignature(secret,time,id,body)},body,signal:AbortSignal.timeout(10000)});
 const value=await r.json();if(!r.ok){console.log(JSON.stringify({readFailed:true,httpStatus:r.status,code:/^QQ_[A-Z0-9_]+$/.test(value.error?.code??'')?value.error.code:'READ_FAILED'}));}
 else {const d=value.data,r=d.runtime??{},keys=['snapshotVersion','available','loggedIn','coreReady','accountMatches','accountState','groupReady','groupState','connected','phase','observation','checkedAt','verifiedAt','restartRequired','qrAvailable','transport','probeFailure'];console.log(JSON.stringify({runtime:Object.fromEntries(keys.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])),expectedBot:d.binding?.botId==='3922489710',expectedGroup:d.settings?.groupId==='905757031',paperEnabled:typeof d.paperEnabled==='boolean'?d.paperEnabled:null}));}
}catch{console.log(JSON.stringify({readFailed:true,code:'QQ_CONTROL_SNAPSHOT_READ_FAILED'}));}
`;
const workerSourceProbe=String.raw`
const f=require('fs'),c=require('crypto'),out={};
for(const p of ['napcat-control.mjs','control-server.mjs','control-store.mjs','plugins/qq/runtime.mjs'])try{out[p]=c.createHash('sha256').update(f.readFileSync('/app/apps/qq-channel/src/'+p)).digest('hex');}catch{out[p]=null;}
console.log(JSON.stringify(out));`;
const errors=[];
emit('audit',{at:new Date().toISOString(),scope:'READ_ONLY_NO_NATIVE_AUTH_NO_QR_NO_RESTART'});
const containers=new Map();
for(const name of ['mooyu-qq-napcat-1','mooyu-qq-worker-1','gamehub-production-api-1','gamehub-production-web-1']){
 try{const c=JSON.parse(run('docker',['inspect',name]))[0];containers.set(name,c);
  emit('container',{name,image:c.Image,id:c.Id.slice(0,12),running:c.State.Running,restarting:c.State.Restarting,oomKilled:c.State.OOMKilled,started:c.State.StartedAt,restarts:c.RestartCount,health:c.State.Health?.Status??null,...(name==='mooyu-qq-napcat-1'?{multiProcess:(c.Config.Env??[]).includes('NAPCAT_DISABLE_MULTI_PROCESS=0')}:{} )});
 }catch(e){errors.push({section:name,code:safe(e)});}
}
try{emit('workerSources',{hashes:JSON.parse(run('docker',['exec','mooyu-qq-worker-1','node','-e',workerSourceProbe]))});}catch(e){errors.push({section:'workerSources',code:safe(e)});}
for(let n=0;n<2;n++){
 if(n)await new Promise(resolve=>setTimeout(resolve,6000));
 try{emit('existingWorkerSnapshot',{sample:n+1,...JSON.parse(run('docker',['exec','mooyu-qq-worker-1','node','--input-type=module','-e',controlProbe]))});}catch(e){errors.push({section:'workerSnapshot',code:safe(e)});}
}
const stateRoot='/www/backup/gamehub/qq-independent-guardian-20261124-r1';
for(const unit of ['mooyu-qq-guardian.timer','mooyu-qq-guardian.service']){
 const text=run('systemctl',['show',unit,'-p','LoadState','-p','ActiveState','-p','SubState','-p','UnitFileState','-p','Result','-p','ExecMainStatus','-p','ExecMainStartTimestamp','-p','ExecMainExitTimestamp'],{allowFailure:true});
 emit('guardianUnit',{unit,readFailed:text===null,properties:text===null?null:Object.fromEntries(text.split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}))});
}
try{
 const file=path.join(stateRoot,'config.private.json');if(!fs.existsSync(file))emit('guardianConfig',{present:false});
 else{const c=readJson(file);emit('guardianConfig',{present:true,enabled:c.enabled===true,version:c.version,gatewayMatches:c.gateway==='mooyu-qq-napcat-1',workerMatches:c.worker==='mooyu-qq-worker-1',expectedBot:c.botId==='3922489710',expectedGroup:c.groupId==='905757031',imageMatches:c.image===containers.get('mooyu-qq-napcat-1')?.Image});}
 const file2=path.join(stateRoot,'recovery-state.private.json');if(!fs.existsSync(file2))emit('guardianState',{present:false});
 else{const s=readJson(file2);emit('guardianState',{present:true,version:s.version,lastAt:s.lastAt,attempts:Array.isArray(s.attempts)?s.attempts.length:null,manualRequired:s.manualRequired,incidentHandled:s.incidentHandled,lastOutcome:s.lastOutcome,incident:s.incident?{firstAt:s.incident.firstAt,samples:s.incident.samples,lastSample:s.incident.lastSample}:null});}
}catch(e){errors.push({section:'guardianFiles',code:safe(e)});}
const markers={nativeRecoveryUninitialized:/重启功能未初始化/u,nativeRestartFailed:/登录服务重启失败/u,kickedOffline:/KickedOffline|KickedOffLine|踢下线/u,duplicateLogin:/无法重复登录|already.*log.?in/iu,authenticationLimited:/login rate limit|QQ_GATEWAY_RATE_LIMITED/iu,sampleFailed:/QQ_STATUS_SAMPLE_UNAVAILABLE|QQ_STATUS_SAMPLE|worker-waiting/iu};
for(const name of ['mooyu-qq-napcat-1','mooyu-qq-worker-1']){
 const r=spawnSync('docker',['logs','--since','2h','--tail','500',name],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
 const lines=(String(r.stdout??'')+'\n'+String(r.stderr??'')).split(/\r?\n/);
 emit('logMarkers',{name,readFailed:r.status!==0,markers:Object.fromEntries(Object.entries(markers).map(([k,re])=>[k,lines.filter(l=>re.test(l)).length]))});
}
const journal=run('journalctl',['-u','mooyu-qq-guardian.service','--since','2 hours ago','-n','12','--no-pager','-o','cat'],{allowFailure:true});
const outcomes=[];for(const line of (journal??'').split('\n'))try{const v=JSON.parse(line);const item={};for(const k of ['action','reason','result','code'])if(typeof v[k]==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v[k]))item[k]=v[k];if(Object.keys(item).length)outcomes.push(item);}catch{}
emit('guardianOutcomes',{readFailed:journal===null,outcomes});
const lock='/var/lock/mooyu-agent-plugin-cutover.lock';
try{const present=fs.existsSync(lock);let owner=null;if(present){const f=path.join(lock,'qq-guardian-owner.private.json');if(fs.existsSync(f)){const s=readJson(f);owner={kind:s.kind==='mooyu-qq-guardian-v1'?'guardian-protocol':'unknown',pidAlive:Number.isSafeInteger(s.pid)&&fs.existsSync('/proc/'+s.pid),bootMatches:s.boot===fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()};}}emit('maintenanceLock',{present,owner});}catch(e){errors.push({section:'maintenanceLock',code:safe(e)});}
emit('readOnlyEnd',{errors,newNapcatManagementClients:0,qrRequested:false,loginRequested:false,configurationWritten:false,servicesRestarted:false,oldTasksRetried:false,rawLogsOrCredentialsPrinted:false});
