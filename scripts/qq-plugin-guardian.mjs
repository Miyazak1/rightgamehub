// Opt-in host-side guardian. Never install/run this against production as part
// of an unrelated plugin update. It uses the worker's existing control client,
// not a new NapCat management login, and can only stop/start the pinned gateway.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {decideQQRecovery,executeQQRecovery,resumeQQStart} from '../apps/qq-channel/src/recovery-policy.mjs';
export const QQ_GATEWAY_NAME='mooyu-qq-napcat-1',QQ_WORKER_NAME='mooyu-qq-worker-1';
const fail=code=>{throw Error(code);};
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
export const qqIdentityHash=c=>crypto.createHash('sha256').update(JSON.stringify(canon({id:c.Id,image:c.Image,config:c.Config,host:c.HostConfig,mounts:c.Mounts,networks:Object.entries(c.NetworkSettings.Networks??{}).map(([name,n])=>[name,(n.Aliases??[]).slice().sort()]).sort()}))).digest('hex');
export const WORKER_SNAPSHOT_PROBE=String.raw`
import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {qqSignature} from '/app/apps/api/src/qq-admin-protocol.mjs';
const secret=fs.readFileSync(process.env.QQ_ADMIN_SECRET_FILE,'utf8').trim(),agent=process.env.QQ_ADMIN_AGENT_USER_ID;
const time=String(Date.now()),id=randomUUID(),body=JSON.stringify({operation:'status',actorId:agent,agentUserId:agent,args:{}});
const r=await fetch('http://127.0.0.1:6780/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':time,'x-qq-request':id,'x-qq-signature':qqSignature(secret,time,id,body)},body,signal:AbortSignal.timeout(8000)});
if(!r.ok)throw Error('QQ_CONTROL_SNAPSHOT_UNAVAILABLE');const {data}=await r.json();
console.log(JSON.stringify({runtime:data.runtime,binding:data.binding,groupId:data.settings.groupId,paperEnabled:data.paperEnabled}));`;
const NO_SENDING_PROBE=String.raw`
import pg from '/app/apps/qq-channel/node_modules/pg/lib/index.js';
const pool=new pg.Pool({connectionString:process.env.QQ_DATABASE_URL,max:1,connectionTimeoutMillis:3000,options:'-c default_transaction_read_only=on -c statement_timeout=5000'});
try{const {rows}=await pool.query("SELECT count(*)::int AS count FROM mooyu_qq.messages WHERE status='sending'");console.log(JSON.stringify(rows[0]));}finally{await pool.end();}`;
export function validateGuardianConfig(c){
 if(c?.version!==1||typeof c.enabled!=='boolean'||c.gateway!==QQ_GATEWAY_NAME||c.worker!==QQ_WORKER_NAME||!/^sha256:[a-f0-9]{64}$/u.test(c.image??'')||!/^[a-f0-9]{64}$/u.test(c.identityHash??'')||!/^[a-zA-Z0-9_-]+$/u.test(c.loginVolume??'')||!/^\d{5,16}$/u.test(c.botId??'')||!/^\d{5,16}$/u.test(c.groupId??''))fail('QQ_GUARDIAN_CONFIG_REQUIRED');
 return c;
}
export function assertGuardianIdentity(c,config,{running=true}={}){
 validateGuardianConfig(config);
 const volume=c.Mounts?.filter(m=>m.Destination==='/data');
 if(c.Name!=='/'+config.gateway||c.Image!==config.image||qqIdentityHash(c)!==config.identityHash||volume.length!==1||volume[0].Type!=='volume'||volume[0].Name!==config.loginVolume||c.State.Running!==running||c.State.Restarting)fail('QQ_GATEWAY_IDENTITY_CHANGED');
 const env=new Set(c.Config.Env??[]);
 if(!env.has('NAPCAT_DISABLE_MULTI_PROCESS=0')||env.has('NAPCAT_WORKER_PROCESS=1')||env.has('NAPCAT_DISABLE_MULTIPROCESSING=1'))fail('QQ_NATIVE_RECOVERY_MODE_REQUIRED');
}
export function assertGuardianSnapshot(s,config){
 if(s?.binding?.botId!==config.botId||s.groupId!==config.groupId||s.paperEnabled!==false||s.runtime?.snapshotVersion!==2||!s.runtime?.checkedAt)fail('QQ_WORKER_SNAPSHOT_CONTRACT_REQUIRED');
 return s;
}
function run(command,args,options={}){const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576,...options});if(r.status!==0||r.error)fail('QQ_GUARDIAN_TOOL_FAILED');return r.stdout?.trim()??'';}
function fileHash(file){const h=crypto.createHash('sha256'),b=Buffer.alloc(1048576),fd=fs.openSync(file,'r');try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');}
function privateFile(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))fail('QQ_GUARDIAN_PRIVATE_FILE_REQUIRED');}
function save(file,value){const next=file+'.next-'+crypto.randomBytes(8).toString('hex');fs.writeFileSync(next,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});const fd=fs.openSync(next,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(next,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
const processStart=pid=>{try{return fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ').at(-1).trim().split(/\s+/)[19];}catch(e){if(e.code==='ENOENT')return null;throw e;}};
// The CLI's outer OS flock serializes guardian instances. Only a dead lease
// created by THIS guardian can be reclaimed; old updater/unknown locks stay put.
export function acquireGuardianLease(lock){
 const ownerFile=path.join(lock,'qq-guardian-owner.private.json'),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
 try{fs.mkdirSync(lock,{mode:0o700});}catch(e){
  if(e.code!=='EEXIST')throw e;
  try{
   if(fs.lstatSync(lock).isSymbolicLink()||fs.statSync(lock).uid!==0||(fs.statSync(lock).mode&0o077)||JSON.stringify(fs.readdirSync(lock))!==JSON.stringify([path.basename(ownerFile)]))return null;
   privateFile(ownerFile);if(fs.statSync(ownerFile).size>4096)return null;const old=JSON.parse(fs.readFileSync(ownerFile,'utf8'));
   if(old.kind!=='mooyu-qq-guardian-v1'||!Number.isSafeInteger(old.pid)||old.pid<1||typeof old.start!=='string'||typeof old.boot!=='string'||old.boot===boot&&processStart(old.pid)===old.start)return null;
   fs.unlinkSync(ownerFile);fs.rmdirSync(lock);fs.mkdirSync(lock,{mode:0o700});
  }catch{return null;}
 }
 const token=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(ownerFile,JSON.stringify({kind:'mooyu-qq-guardian-v1',pid:process.pid,start:processStart(process.pid),boot,token}),{flag:'wx',mode:0o600});
 return ()=>{if(JSON.parse(fs.readFileSync(ownerFile,'utf8')).token!==token)fail('QQ_GUARDIAN_LEASE_CHANGED');fs.unlinkSync(ownerFile);fs.rmdirSync(lock);};
}
export async function runGuardian({configFile,stateDirectory,apply=false}={}){
 if(process.platform!=='linux'||process.getuid?.()!==0)fail('QQ_GUARDIAN_LINUX_ROOT_REQUIRED');
 // This directory must be provisioned separately; never create or change an
 // existing production configuration, runtime, data directory or old record.
 const root=fs.realpathSync(stateDirectory),stat=fs.statSync(root);if(root!==path.resolve(stateDirectory)||stat.uid!==0||(stat.mode&0o077))fail('QQ_GUARDIAN_PRIVATE_DIRECTORY_REQUIRED');
 privateFile(configFile);const config=validateGuardianConfig(JSON.parse(fs.readFileSync(configFile,'utf8')));
 const docker=args=>run('docker',args),inspect=()=>JSON.parse(docker(['inspect',QQ_GATEWAY_NAME]))[0];
 const probe=()=>assertGuardianSnapshot(JSON.parse(docker(['exec',QQ_WORKER_NAME,'node','--input-type=module','-e',WORKER_SNAPSHOT_PROBE])),config);
 const lock='/var/lock/mooyu-agent-plugin-cutover.lock',stateFile=path.join(root,'recovery-state.private.json');
 // The same mutex directory is honored by existing releases. Unknown owners
 // always require review; the guardian can recover its own interrupted lease.
 const release=acquireGuardianLease(lock);if(!release)return {action:'wait',reason:'maintenance-in-progress'};
 try{
  if(fs.existsSync(stateFile))privateFile(stateFile);
  const prior=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
  const current=inspect();
  if(apply&&config.enabled&&current.State.Running===false&&prior?.manualRequired&&['stop-requested','start-requested','gateway-start-required'].includes(prior.lastOutcome)){
   await resumeQQStart({state:prior,io:{save:s=>save(stateFile,s),guardStopped:()=>assertGuardianIdentity(inspect(),config,{running:false}),
    verifyWarmBackup:()=>{const dir=fs.realpathSync(prior.recoveryDirectory);if(path.dirname(dir)!==root||!path.basename(dir).startsWith('recovery-'))fail('QQ_RECOVERY_DIRECTORY_REQUIRED');const file=path.join(dir,'login-before-stop.tar');privateFile(file);const receipt=JSON.parse(fs.readFileSync(path.join(dir,'backups.private.json'),'utf8')).find(r=>r.name==='login-before-stop.tar');if(!receipt?.fullyDecoded||receipt.sha256!==fileHash(file))fail('QQ_WARM_BACKUP_CHANGED');},
    start:()=>docker(['start',QQ_GATEWAY_NAME]),verify:()=>assertGuardianIdentity(inspect(),config)}});
   return {action:'interrupted-start-completed',awaitingFreshObservation:true};
  }
  assertGuardianIdentity(current,config);const snapshot=probe(),decision=decideQQRecovery(prior,snapshot);
  if(!apply)return {action:decision.action,reason:decision.reason,executionEnabled:false};
  if(config.enabled!==true)fail('QQ_GUARDIAN_NOT_ENABLED');
  save(stateFile,decision.state);
  if(decision.action!=='restart-same-gateway')return {action:decision.action,reason:decision.reason};
  const volume=current.Mounts.find(m=>m.Destination==='/data'),usage=run('du',['-sb','--',volume.Source]),bytes=Number(usage.split(/\s/)[0]),space=fs.statfsSync(root);
  if(!Number.isSafeInteger(bytes)||bytes<1||space.bavail*space.bsize<bytes*3+1073741824)fail('QQ_BACKUP_DISK_SPACE_REQUIRED');
  const directory=fs.mkdtempSync(path.join(root,'recovery-'));fs.chmodSync(directory,0o700);const receipts=[];
  const backup=quiesced=>{
   const file=path.join(directory,quiesced?'login-stopped.tar':'login-before-stop.tar'),fd=fs.openSync(file,'wx',0o600);
   try{run('docker',['cp','-a',QQ_GATEWAY_NAME+':/data/.','-'],{encoding:null,stdio:['ignore',fd,'pipe'],timeout:120000});}finally{fs.closeSync(fd);}
   if(fs.statSync(file).size<1024)fail('QQ_LOGIN_BACKUP_EMPTY');
   for(const args of [['-tf',file],['-xOf',file]])run('tar',args,{stdio:['ignore','ignore','pipe'],timeout:120000});
   const h=crypto.createHash('sha256'),buffer=Buffer.alloc(1048576),input=fs.openSync(file,'r');try{let n;while((n=fs.readSync(input,buffer,0,buffer.length,null)))h.update(buffer.subarray(0,n));}finally{fs.closeSync(input);}
   receipts.push({name:path.basename(file),sha256:h.digest('hex'),bytes:fs.statSync(file).size,fullyDecoded:true,quiesced});save(path.join(directory,'backups.private.json'),receipts);
  };
  const state=await executeQQRecovery({state:{...decision.state,recoveryDirectory:directory},io:{save:s=>save(stateFile,s),guard:()=>assertGuardianIdentity(inspect(),config),backup,probe,
   assertNoSending:()=>{if(JSON.parse(docker(['exec',QQ_WORKER_NAME,'node','--input-type=module','-e',NO_SENDING_PROBE])).count!==0)fail('QQ_DELIVERY_IN_FLIGHT');},
   stop:()=>run('docker',['stop','--timeout','-1',QQ_GATEWAY_NAME],{timeout:90000}),guardStopped:()=>assertGuardianIdentity(inspect(),config,{running:false}),
   start:()=>docker(['start',QQ_GATEWAY_NAME]),verify:()=>assertGuardianIdentity(inspect(),config)}});
  return {action:'gateway-started',awaitingFreshObservation:true,loginDataRetained:true,attempts:state.attempts.length};
 }finally{release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 let [mode,configFile,stateDirectory,locked]=process.argv.slice(2);
 if(!['observe','recover'].includes(mode))fail('QQ_GUARDIAN_USAGE_REQUIRED');
 if(locked!=='--guardian-os-lock'){
  const r=spawnSync('flock',['-n','-E','75','/var/lock/mooyu-qq-guardian.lock',process.execPath,path.resolve(process.argv[1]),mode,configFile,stateDirectory,'--guardian-os-lock'],{stdio:'inherit',timeout:650000});process.exitCode=r.status===75?0:r.status??1;
 }else runGuardian({configFile,stateDirectory,apply:mode==='recover'}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({result:'QQ_GUARDIAN_REVIEW_REQUIRED',code:/^[A-Z0-9_]+$/u.test(e.message??'')?e.message:'QQ_GUARDIAN_FAILED'}));process.exitCode=1;});
}
