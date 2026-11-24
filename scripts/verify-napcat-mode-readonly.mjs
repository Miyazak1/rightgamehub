import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
export const processProbeCode=String.raw`
const fs=require('fs'),rows=[];
for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p))){
 if(pid===String(process.pid))continue;
 try{const status=fs.readFileSync('/proc/'+pid+'/status','utf8'),uid=Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);if(uid!==process.getuid())continue;
 const comm=fs.readFileSync('/proc/'+pid+'/comm','utf8').trim();let node=comm==='node';try{node=node||/\/node(?: \(deleted\))?$/.test(fs.readlinkSync('/proc/'+pid+'/exe'));}catch{}
 if(!node)continue;let worker=null;try{worker=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').includes('NAPCAT_WORKER_PROCESS=1');}catch{}
 rows.push({pid:Number(pid),ppid:Number(status.match(/^PPid:\s+(\d+)/m)?.[1]),worker});
 }catch{}
}
console.log(JSON.stringify({count:rows.length,parentChildPair:rows.some(r=>rows.some(p=>p.pid===r.ppid)),processes:rows}));`;
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v,hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const sha=p=>{const fd=fs.openSync(p,'r'),b=Buffer.alloc(1048576),h=crypto.createHash('sha256');try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');};
export async function readOnlyModeVerification(){
 const root='/www/backup/gamehub',name='mooyu-qq-napcat-1',errors=[];
 const run=args=>{if(!['inspect','exec','compose','ps','image'].includes(args[0])||args[0]==='image'&&args[1]!=='inspect'||args[0]==='compose'&&args.slice(-3).join(' ')!=='config --format json')throw Error('READONLY_REQUIRED');const r=spawnSync('docker',args,{encoding:'utf8',timeout:45000,maxBuffer:32*1024*1024});if(r.status!==0)throw Error('DOCKER_'+args[0].toUpperCase()+'_READ_FAILED');return r.stdout.trim();},inspect=n=>JSON.parse(run(['inspect',n]))[0];
 try{
 const c=inspect(name),files=c.Config.Labels['com.docker.compose.project.config_files'].split(','),last=files.findLast(p=>p.startsWith(root+'/qq-gateway-mode-20261124-')&&p.endsWith('/mode.json'));if(!last)throw Error('MODE_OPERATION_NOT_FOUND');
 const record=path.dirname(last),state=JSON.parse(fs.readFileSync(record+'/state.private.json','utf8')),failure=JSON.parse(fs.readFileSync(record+'/failure.private.json','utf8'));
 const tools=fs.readFileSync(record+'/rollback.sh','utf8').match(/\/www\/backup\/gamehub\/qq-gateway-mode-tools-20261124-[A-Za-z0-9]+\/repair-napcat-process-mode\.mjs/)?.[0];if(!tools)throw Error('ORIGINAL_MODE_TOOL_NOT_FOUND');
 const {gatewayComparable,assertGatewayPorts,assertGatewayUlimits}=await import(pathToFileURL(tools));
 const {Cutover,composeArgs}=await import(pathToFileURL(root+'/github-search-release-20261123-verification-r1/agent-server-cutover.mjs'));
 const env=Object.fromEntries(c.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
 const checks={running:c.State.Running,restarting:c.State.Restarting===false,sameImage:c.Image===state.image,sameHostname:c.Config.Hostname===state.gatewayBefore.Config.Hostname,multiprocess:env.NAPCAT_DISABLE_MULTI_PROCESS==='0',gatewayConfigurationPreserved:hash(gatewayComparable(c,state.originalFlag))===hash(gatewayComparable(state.gatewayBefore,state.originalFlag)),composeChainMatches:hash(composeArgs(c).args)===hash([...state.role.compose.args,'-f',record+'/mode.json']),originalFilesUnchanged:state.files.every(f=>sha(f.path)===f.sha256)};
 const reader=new Cutover(record,{run});reader.state={databases:{}};reader.processEnv={...process.env};
 for(const entry of inspect('gamehub-production-api-1').Config.Env){const i=entry.indexOf('=');reader.processEnv['MOOYU_CUTOVER_API_'+entry.slice(0,i)]=entry.slice(i+1);}
 // Database identities were not written by the gateway mode change. Derive
 // them from the still-running original services; no credentials are printed.
 for(const [which,n,key,db]of [['api','gamehub-production-api-1','DATABASE_URL','gamehub-production-postgres-1'],['qq','mooyu-qq-worker-1','QQ_DATABASE_URL','mooyu-qq-postgres-1']]){const entry=inspect(n).Config.Env.find(v=>v.startsWith(key+'=')),u=new URL(entry.slice(key.length+1));reader.state.databases[which]={container:db,user:decodeURIComponent(u.username),database:decodeURIComponent(u.pathname.slice(1))};}
 const s=reader.model(state.role,'mode.json').services.napcat;reader.captureRole(structuredClone(state.role),'mode.json');assertGatewayPorts(c,s);assertGatewayUlimits(c,s);checks.declaredModelMatches=true;
 const all=JSON.parse(run(['inspect',...run(['ps','-aq']).split(/\s+/).filter(Boolean)]));
 const others=all.filter(c=>c.Name!=='/'+name).map(c=>({id:c.Id,name:c.Name,image:c.Image,running:c.State.Running,started:c.State.StartedAt,restarts:c.RestartCount,config:c.Config,host:c.HostConfig,mounts:c.Mounts,networks:Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort()})).sort((a,b)=>a.id.localeCompare(b.id));
 checks.otherContainersUnchanged=hash(others)===hash(state.othersBefore);
 const locks=['agent-cutover-files-20261122-r1','agent-cutover-files-post-paper-20261122-r1','agent-cutover-files-post-paper-20261123-r2'].map(n=>{const p=root+'/'+n;if(JSON.parse(fs.readFileSync(p+'/state.private.json','utf8')).executionLocked!==true)throw Error('OLD_EXECUTION_LOCK_CHANGED');return fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(f=>{if(!f.isFile()||f.isSymbolicLink())throw Error('OLD_RECORD_LAYOUT_CHANGED');return[f.name,sha(p+'/'+f.name),fs.statSync(p+'/'+f.name).mode&0o777];});});checks.oldRecordsUnchanged=hash(locks)===hash(state.oldLocksBefore);
 const receipts=JSON.parse(fs.readFileSync(record+'/backup-receipt.private.json','utf8'));
 checks.loginBackupsIntact=Array.isArray(receipts)&&receipts.length===2&&receipts.every(r=>['login-before-stop.tar','login-stopped.tar'].includes(r.file)&&r.archiveFullyRead===true&&r.ownerMetadataRetained===true&&fs.statSync(record+'/'+r.file).size===r.bytes&&sha(record+'/'+r.file)===r.sha256)&&receipts.some(r=>r.file==='login-stopped.tar'&&r.quiesced===true);
 const inv=reader.invariants();checks.permissionsSchedulesAndSettingsMatch=hash(inv)===hash(state.domainBefore.invariants);
 checks.bothPapersClosed=['gamehub-production-agent-paper-research-worker-1','mooyu-desktop-business-test-business-paper-worker-1'].every(n=>{const p=all.find(c=>c.Name==='/'+n);return p&&!p.State.Running&&p.HostConfig.RestartPolicy.Name==='no';});
 const processes=JSON.parse(run(['exec',name,'node','-e',processProbeCode]));checks.parentAndChildRunning=processes.count>=2&&processes.parentChildPair===true;
 const loginCode=String.raw`import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';const c=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:'diagnostic-unused'});try{const s=await c.post('/QQLogin/CheckLoginStatus'),i=await c.post('/QQLogin/GetQQLoginInfo');let q;try{q=new URL(s.qrcodeurl);}catch{}console.log(JSON.stringify({readFailed:false,loggedIn:s.isLogin===true,coreReady:s.coreReady===true,coreOnline:i.online===true,expectedAccount:String(i.uin)==='3922489710',phase:['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed','reconnecting'].includes(s.loginPhase)?s.loginPhase:'unknown',qrAvailable:!!q&&q.protocol==='https:'&&(q.hostname==='qq.com'||q.hostname.endsWith('.qq.com'))&&!q.username&&!q.password&&q.href.length<=4096,restartCallbackUninitialized:String(s.loginError??'').includes('重启功能未初始化')}));}catch{console.log(JSON.stringify({readFailed:true}));}`;
 const login=JSON.parse(run(['exec','mooyu-qq-worker-1','node','--input-type=module','-e',loginCode]));
 const after=inspect(name);checks.gatewayStableDuringAudit=after.Id===c.Id&&after.State.StartedAt===c.State.StartedAt&&after.RestartCount===c.RestartCount&&after.State.Running===true;
 const ok=Object.values(checks).every(v=>v===true),ready=!login.readFailed&&login.loggedIn&&login.coreReady&&login.coreOnline&&login.expectedAccount;
 console.log('VERIFICATION '+JSON.stringify({result:!ok?'READONLY_GATEWAY_MODE_HAS_BLOCKERS':ready?'READONLY_GATEWAY_MODE_LOGIN_READY':login.qrAvailable?'READONLY_GATEWAY_MODE_SCAN_REQUIRED':'READONLY_GATEWAY_MODE_LOGIN_PENDING',record,previousFailure:failure.code,checks,processes,login,historyComparison:'NOT_REPEATED_LIVE_DATA_CAN_ADVANCE',operationRecordModified:false}));
 }catch(e){errors.push({code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'READ_FAILED'});}
 console.log('READONLY_END '+JSON.stringify({errors,servicesRestarted:false,configurationWritten:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await readOnlyModeVerification();
