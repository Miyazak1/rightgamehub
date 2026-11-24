// One recurrence snapshot. No QR/refresh/password, configuration writes,
// task retries, container stop/start or raw log/credential output.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root='/www/backup/gamehub',gateway='mooyu-qq-napcat-1',worker='mooyu-qq-worker-1';
function run(args){
 if(!['inspect','logs','top','exec'].includes(args[0]))throw Error('READONLY_COMMAND_REQUIRED');
 const r=spawnSync('docker',args,{encoding:'utf8',timeout:40000,maxBuffer:4*1024*1024});
 if(r.status!==0)throw Error('READ_FAILED');return r.stdout;
}
const inspect=n=>JSON.parse(run(['inspect',n]))[0];
const errors=[];
const safe=e=>/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'READ_FAILED';
let baseline=[];
try{
 const api=inspect('gamehub-production-api-1');
 const files=api.Config.Labels['com.docker.compose.project.config_files'].split(',');
 const last=files.findLast(p=>p.startsWith(root+'/github-search-verification-operation-')&&p.endsWith('/api.json'));
 if(!last)throw Error('CURRENT_OPERATION_NOT_FOUND');
 const record=path.dirname(last),state=JSON.parse(fs.readFileSync(record+'/state.private.json','utf8'));
 const result=JSON.parse(fs.readFileSync(record+'/result.private.json','utf8'));
 baseline=state.protectedBefore??[];
 console.log('deployment '+JSON.stringify({record,result:result.result,completedAt:fs.statSync(record+'/result.private.json').mtime.toISOString()}));
}catch(e){errors.push({section:'deployment',code:safe(e)});}
for(const name of [gateway,worker,'gamehub-production-api-1','gamehub-production-agent-interactions-1']){
 try{const c=inspect(name),old=baseline.find(b=>b.name==='/'+name);
 console.log('container '+JSON.stringify({name,image:c.Image,running:c.State.Running,startedAt:c.State.StartedAt,restarts:c.RestartCount,health:c.State.Health?.Status??null,comparedToUpdate:old?{sameContainer:c.Id===old.id,sameImage:c.Image===old.image,sameStart:c.State.StartedAt===old.started,sameRestartCount:c.RestartCount===old.restarts}:null}));
 }catch(e){errors.push({section:name,code:safe(e)});}
}
const nativeCode=String.raw`
import crypto from 'node:crypto';import fs from 'node:fs';
import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';
const c=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:'diagnostic-unused'}),out={};
out.clientSourceSha256=crypto.createHash('sha256').update(fs.readFileSync('/app/apps/qq-channel/src/napcat-control.mjs')).digest('hex');
try{
 const s=await c.post('/QQLogin/CheckLoginStatus'),i=await c.post('/QQLogin/GetQQLoginInfo');
 const text=String(s.loginError??'');let url;try{url=new URL(s.qrcodeurl);}catch{}
 out.native={loggedIn:s.isLogin===true,coreReady:s.coreReady===true,coreOnline:i.online===true,expectedAccount:String(i.uin)==='3922489710',phase:['offline','reconnecting','waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','failed'].includes(s.loginPhase)?s.loginPhase:'unknown',cachedQrPresent:typeof s.qrcodeurl==='string'&&s.qrcodeurl.length>0,cachedQrValid:!!url&&url.protocol==='https:'&&(url.hostname==='qq.com'||url.hostname.endsWith('.qq.com'))&&!url.username&&!url.password&&url.href.length<=4096};
 out.errorMarkers={present:!!text,alreadyLoggedIn:/已登录|重复登录|already.*log/i.test(text),expired:/过期|expired/i.test(text),network:/网络|network|timeout|超时/i.test(text),verification:/验证|captcha|verify|风控/i.test(text),kicked:/被踢|强制下线|KickedOffLine/i.test(text),anotherDevice:/其他设备|其它设备|异地|elsewhere/i.test(text),initialization:/初始化|initializ|主进程/i.test(text)};
 out.errorCodes=[...text.matchAll(/["']?(errCode|errorCode|code|result|errType)["']?\s*[:=]\s*["']?(-?\d{1,12})/gi)].slice(0,10).map(m=>({field:m[1],value:m[2]}));
}catch(e){out.readError=/^QQ_[A-Z0-9_]+$/.test(e.code??'')?e.code:'READ_FAILED';}
console.log(JSON.stringify(out));`;
try{console.log('native '+JSON.stringify(JSON.parse(run(['exec',worker,'node','--input-type=module','-e',nativeCode]))));}catch(e){errors.push({section:'native',code:safe(e)});}
const controlCode=String.raw`
import{createRequire}from'node:module';import{createAgentQQAdminService}from'/app/apps/api/src/agent-qq-admin-service.mjs';
const{Pool}=createRequire('/app/apps/api/package.json')('pg'),pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:4000,options:'-c default_transaction_read_only=on -c statement_timeout=5000'});
try{const d=await createAgentQQAdminService({pool,env:process.env}).readBoundChannelPolicy(),s=d.runtime??{};console.log(JSON.stringify({available:s.available===true,loggedIn:s.loggedIn===true,coreReady:s.coreReady===true,accountMatches:s.accountMatches===true,groupReady:s.groupReady===true,connected:s.connected===true,phase:['offline','reconnecting','waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','failed'].includes(s.phase)?s.phase:'unknown'}));}catch(e){console.log(JSON.stringify({code:/^QQ_[A-Z0-9_]+$/.test(e.code??'')?e.code:'READ_FAILED'}));}finally{await pool.end();}`;
try{console.log('existingWorkerControl '+JSON.stringify(JSON.parse(run(['exec','gamehub-production-api-1','node','--input-type=module','-e',controlCode]))));}catch(e){errors.push({section:'control',code:safe(e)});}
const patterns={loginSuccess:/登录成功|Login Success|onQRCodeLoginSucceed/i,duplicateLogin:/当前账号.*已登录|无法重复登录/i,loginFailure:/Login Error|登录失败/i,disconnected:/登录服务已断开|SelfOffline|KickedOffLine|账号状态变更为离线/i,reconnected:/登录服务重连完成/i,qrGenerated:/二维码已保存到|onQRCodeGetPicture/i,qrScanned:/二维码已被扫描|onQRCodeSessionUserScaned/i,restartProblem:/重启失败|未初始化|无法与主进程通信|restart.*fail/i,authRateLimit:/login rate limit/i};
for(const name of [gateway,worker]){
 try{
  // Docker sends ordinary logs to both streams. Never forward either stream.
  const r=spawnSync('docker',['logs','--timestamps','--since','2h','--tail','800',name],{encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});
  if(r.status!==0)throw Error('LOG_READ_FAILED');
  const markers=Object.fromEntries(Object.keys(patterns).map(k=>[k,{count:0,lastAt:null}]));
  for(const line of (r.stdout+'\n'+r.stderr).split(/\r?\n/))for(const [k,re]of Object.entries(patterns))if(re.test(line)){markers[k].count++;const at=line.match(/^\d{4}-\d\d-\d\dT[0-9:.]+Z/)?.[0];if(at&&(!markers[k].lastAt||at>markers[k].lastAt))markers[k].lastAt=at;}
  console.log('recentLogMarkers '+JSON.stringify({name,window:'last 2h, at most 800 lines',markers}));
 }catch(e){errors.push({section:'logs:'+name,code:safe(e)});}
}
console.log('READONLY_END '+JSON.stringify({errors,oneIndependentManagementClient:true,qqLoginRequested:false,qrRequested:false,configurationWritten:false,servicesRestarted:false,rawLogsOrCredentialsPrinted:false}));
