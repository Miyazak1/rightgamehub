// Explicitly authorized one-time recovery. Never recreates a container or volume.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const ROOT='/www/backup/gamehub',GATEWAY='mooyu-qq-napcat-1',TOOLS=ROOT+'/agent-locked-tools-20261123-r1';
const fail=m=>{throw Error(m);},read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const same=(a,b)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
function sha(file){const fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),b=Buffer.alloc(1048576);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function docker(args,options={}){const r=spawnSync('docker',args,{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,...options});if(r.error||r.status!==0)fail('GATEWAY_RECOVERY_DOCKER_FAILED');return r.stdout?.trim()??'';}
export async function recoverySequence(a){await a.preflight();await a.warmBackup();await a.recheck();await a.stopOnce();await a.coldBackup();await a.startOnce();await a.verify();}
export function assertNoActiveDelivery(count){if(!Number.isSafeInteger(count)||count<0)fail('INVALID_DELIVERY_COUNT');if(count!==0)fail('QQ_DELIVERY_IN_FLIGHT');}
export function archiveLoginData(directory,name,{run=docker,hash=sha,quiesced=false}={}){
 if(!['login-before-stop.tar','login-stopped.tar'].includes(name))fail('BACKUP_NAME_INVALID');
 const partial=path.join(directory,name+'.partial'),target=path.join(directory,name);if(fs.existsSync(target))fail('NEW_LOGIN_BACKUP_REQUIRED');const fd=fs.openSync(partial,'wx',0o600);
 try{run(['cp','-a',GATEWAY+':/data/.','-'],{encoding:null,timeout:1200000,stdio:['ignore',fd,'pipe']});}finally{fs.closeSync(fd);}
 // Parse all headers and read every regular file to /dev/null; never extract.
 for(const args of [['-tf',partial],['-xOf',partial]]){const r=spawnSync('tar',args,{stdio:['ignore','ignore','pipe'],timeout:1200000});if(r.error||r.status!==0)fail('LOGIN_ARCHIVE_VALIDATION_FAILED');}
 const bytes=fs.statSync(partial).size;if(bytes<1024)fail('LOGIN_ARCHIVE_EMPTY');fs.renameSync(partial,target);
 return{file:name,bytes,sha256:hash(target),quiesced,archiveFullyRead:true,ownerMetadataRetained:true};
}
const loginProbe=String.raw`
import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';
const c=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:process.env.QQ_ACCESS_TOKEN});let last={readFailed:true};
for(let i=0;i<7;i++){try{const s=await c.post('/QQLogin/CheckLoginStatus'),info=await c.post('/QQLogin/GetQQLoginInfo');last={readFailed:false,loggedIn:s.isLogin===true,coreOnline:info.online===true,coreReady:s.coreReady===true,expectedBotMatches:String(info.uin)==='3922489710',phase:['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed','reconnecting'].includes(s.loginPhase)?s.loginPhase:'unknown',qrAvailable:typeof s.qrcodeurl==='string'&&s.qrcodeurl.length>0};if(last.loggedIn&&last.coreOnline&&last.coreReady&&last.expectedBotMatches||last.phase==='waiting_qrcode'&&last.qrAvailable)break;}catch(e){last={readFailed:true,code:/^QQ_[A-Z0-9_]+$/.test(e.code??'')?e.code:'READ_FAILED'};}if(i<6)await new Promise(r=>setTimeout(r,10000));}
console.log(JSON.stringify(last));
`;
export async function recoverGatewayOnce(){
 let directory=null,phase='preflight',core,record,tool,baseline,gatewayBefore,lockedBefore,lockOwned=false,stopIssued=false,startIssued=false;const backups=[];
 const locked=[ROOT+'/agent-cutover-files-20261122-r1',ROOT+'/agent-cutover-files-post-paper-20261122-r1',ROOT+'/agent-cutover-files-post-paper-20261123-r2'];
 const inspect=()=>{const ids=docker(['ps','-aq']).split(/\s+/).filter(Boolean);return JSON.parse(docker(['inspect',...ids]));};
 const onlyGateway=()=>JSON.parse(docker(['inspect',GATEWAY]))[0];
 const snapshot=c=>({id:c.Id,name:c.Name,image:c.Image,running:c.State.Running,started:c.State.StartedAt,restarts:c.RestartCount,config:c.Config,host:c.HostConfig,mounts:c.Mounts.slice().sort((a,b)=>a.Destination.localeCompare(b.Destination)),networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()});
 const others=cs=>cs.filter(c=>c.Name!=='/'+GATEWAY).map(snapshot).sort((a,b)=>a.id.localeCompare(b.id));
 const oldSnapshot=()=>locked.map(root=>{if(read(root+'/state.private.json').executionLocked!==true)fail('OLD_EXECUTION_LOCK_CHANGED');return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(d=>{if(!d.isFile()||d.isSymbolicLink())fail('OLD_RECORD_LAYOUT_CHANGED');return[d.name,sha(root+'/'+d.name),fs.statSync(root+'/'+d.name).mode&0o777];});});
 let deploymentStateHash;
 function deliveryCheck(){assertNoActiveDelivery(Number(tool.sql(tool.state.databases.qq,"SELECT count(*) FROM mooyu_qq.messages WHERE status='sending'")));}
 function offlineCheck(){const code="import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';const c=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:process.env.QQ_ACCESS_TOKEN});const i=await c.post('/QQLogin/GetQQLoginInfo');console.log(JSON.stringify({online:i.online===true,expectedBotMatches:String(i.uin)==='3922489710'}));";const s=JSON.parse(docker(['exec','mooyu-qq-worker-1','node','--input-type=module','-e',code]));if(s.online)fail('QQ_ALREADY_ONLINE_NO_RESTART_NEEDED');if(!s.expectedBotMatches)fail('QQ_LOGIN_ACCOUNT_MISMATCH');}
 function protectedCheck(){if(!same(others(inspect()),baseline)||!same(oldSnapshot(),lockedBefore)||sha(record+'/state.private.json')!==deploymentStateHash)fail('PROTECTED_STATE_CHANGED');}
 const advance=s=>{phase=s;console.log('QQ恢复阶段：'+s);if(directory)fs.writeFileSync(directory+'/progress.private.json',JSON.stringify({phase,stopIssued,startIssued})+'\n',{mode:0o600});};
 try{
  if(process.env.MOOYU_GATEWAY_RECOVERY_AUTH!=='20261123-once')fail('AUTHORIZED_LOCK_ENTRY_REQUIRED');
  fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});lockOwned=true;
  await recoverySequence({
   preflight:async()=>{
    if(sha(TOOLS+'/agent-server-cutover.mjs')!=='1dcbf5e2e9202867fec8f76de9f3f63b43585c87b27f1bcbd784cf8c352606b6')fail('AUDITED_TOOL_CHANGED');core=await import(pathToFileURL(TOOLS+'/agent-server-cutover.mjs').href);
    const candidates=fs.readdirSync(ROOT).filter(n=>/^agent-authorized-upgrade-20261123-[A-Za-z0-9]+$/.test(n)).filter(n=>fs.existsSync(ROOT+'/'+n+'/result.private.json')).map(n=>({root:ROOT+'/'+n,result:read(ROOT+'/'+n+'/result.private.json')})).filter(v=>v.result.result==='AUTHORIZED_PLUGIN_UPGRADE_VERIFIED');if(candidates.length!==1)fail('SUCCESSFUL_DEPLOYMENT_RECORD_AMBIGUOUS');record=candidates[0].result.record;if(record!==candidates[0].root+'/record')fail('DEPLOYMENT_RECORD_PATH_MISMATCH');
    tool=new core.Cutover(record);tool.load();if(tool.state.phase!=='upgraded')fail('DEPLOYMENT_NOT_COMPLETE');tool.checkConfiguration();deliveryCheck();deploymentStateHash=sha(record+'/state.private.json');
    const cs=inspect();gatewayBefore=cs.find(c=>c.Name==='/'+GATEWAY);if(!gatewayBefore?.State.Running)fail('GATEWAY_NOT_RUNNING');const volume=gatewayBefore.Mounts.find(m=>m.Destination==='/data');if(volume?.Type!=='volume'||volume.Name!=='mooyu-qq-compatible-55b2f7e8-088f12')fail('LOGIN_VOLUME_MISMATCH');
    const vi=JSON.parse(docker(['volume','inspect',volume.Name]))[0];if(vi.Mountpoint!==volume.Source)fail('LOGIN_VOLUME_SOURCE_MISMATCH');
    const usage=spawnSync('du',['-sb','--',volume.Source],{encoding:'utf8',timeout:60000});const bytes=Number(usage.stdout?.split(/\s/)[0]);if(usage.status!==0||!Number.isSafeInteger(bytes)||bytes<1)fail('LOGIN_DATA_SIZE_UNKNOWN');const space=fs.statfsSync(ROOT);if(space.bavail*space.bsize<bytes*3+1073741824)fail('LOGIN_BACKUP_DISK_SPACE_LOW');
    offlineCheck();baseline=others(cs);lockedBefore=oldSnapshot();directory=fs.mkdtempSync(ROOT+'/qq-gateway-recovery-once-20261123-');fs.chmodSync(directory,0o700);console.log('恢复与登录备份目录：'+directory);advance('preflight-passed');
    fs.writeFileSync(directory+'/before.private.json',JSON.stringify({gateway:snapshot(gatewayBefore),deploymentRecord:record,oldLocksPreserved:true,authorization:'explicit-user-once-gateway-recovery',noRecreate:true})+'\n',{flag:'wx',mode:0o600});
   },
   warmBackup:async()=>{advance('backup-before-stop');backups.push(archiveLoginData(directory,'login-before-stop.tar'));fs.writeFileSync(directory+'/backup-receipt.private.json',JSON.stringify(backups,null,2)+'\n',{mode:0o600});},
   recheck:async()=>{protectedCheck();tool.checkConfiguration();deliveryCheck();offlineCheck();const c=onlyGateway();if(c.Id!==gatewayBefore.Id||c.State.StartedAt!==gatewayBefore.State.StartedAt||core.fingerprint(c)!==core.fingerprint(gatewayBefore))fail('GATEWAY_CHANGED_BEFORE_STOP');},
   stopOnce:async()=>{advance('graceful-stop-once');stopIssued=true;docker(['stop','--timeout','-1',GATEWAY],{timeout:90000});const c=onlyGateway();if(c.Id!==gatewayBefore.Id||c.State.Running)fail('GATEWAY_DID_NOT_STOP');},
   coldBackup:async()=>{advance('backup-while-stopped');protectedCheck();backups.push(archiveLoginData(directory,'login-stopped.tar',{quiesced:true}));fs.writeFileSync(directory+'/backup-receipt.private.json',JSON.stringify(backups,null,2)+'\n',{mode:0o600});},
   startOnce:async()=>{advance('start-same-container-once');startIssued=true;docker(['start',GATEWAY]);},
   verify:async()=>{
    advance('verify-container-and-login');const after=onlyGateway();if(after.Id!==gatewayBefore.Id||!after.State.Running||after.State.StartedAt===gatewayBefore.State.StartedAt||core.fingerprint(after)!==core.fingerprint(gatewayBefore))fail('SAME_GATEWAY_RESTART_VERIFICATION_FAILED');protectedCheck();
    const probe=JSON.parse(docker(['exec','mooyu-qq-worker-1','node','--input-type=module','-e',loginProbe],{timeout:155000}));protectedCheck();
    const ready=probe.loggedIn&&probe.coreOnline&&probe.coreReady&&probe.expectedBotMatches;
    const result={result:ready?'GATEWAY_RESTARTED_ONCE_LOGIN_READY':probe.phase==='waiting_qrcode'&&probe.qrAvailable?'GATEWAY_RESTARTED_ONCE_SCAN_REQUIRED':'GATEWAY_RESTARTED_ONCE_LOGIN_PENDING',directory,login:probe,backups,onlyGatewayRestarted:true,sameContainerImageAndLoginVolume:true,otherServicesAndOldRecordsUnchanged:true,automaticSecondRestart:false,databaseRestored:false,deploymentRecordGatewayTimestampNeedsFutureReviewedAcknowledgement:true};
    fs.writeFileSync(directory+'/result.private.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
   }
  });
 }catch(e){const result={result:'GATEWAY_RECOVERY_STOPPED_REVIEW_REQUIRED',directory,phase,stopIssued,startIssued,code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'RECOVERY_FAILED',automaticRetry:false,loginDataMustNotBeCleared:true};if(directory)fs.writeFileSync(directory+'/failure.private.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.error(JSON.stringify(result));process.exitCode=1;
 }finally{if(lockOwned)fs.rmdirSync('/var/lock/mooyu-agent-plugin-cutover.lock');}
}
