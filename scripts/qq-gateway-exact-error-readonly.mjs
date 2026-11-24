// One bounded management-authentication attempt to identify the actual gateway
// response. No retry, native QQ login, QR, refresh, config write or restart.
import{spawnSync}from'node:child_process';
const run=(container,code)=>{const r=spawnSync('docker',['exec',container,'node','--input-type=module','-e',code],{encoding:'utf8',timeout:45000,maxBuffer:2000000});if(r.status!==0)throw Error('BOUNDED_READ_FAILED');return JSON.parse(r.stdout.trim());};
const gatewayCode=String.raw`
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';
const report={};
try{const c=JSON.parse(fs.readFileSync('/data/napcat/config/webui.json','utf8'));report.configuration={loginRate:c.loginRate,enable2FA:c.enable2FA===true,hasTotpSecret:!!c.totpSecret,tokenMatchesEnvironment:c.token===process.env.QQ_WEBUI_TOKEN,port:c.port};report.tokenHash=crypto.createHash('sha256').update(process.env.QQ_WEBUI_TOKEN??'').digest('hex');}catch{report.configurationReadFailed=true;}
report.logs=[];for(const root of ['/data/napcat/logs','/app/napcat/logs']){if(!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())continue;const files=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()&&!e.isSymbolicLink()&&/\.(log|txt)$/.test(e.name)).map(e=>({path:path.join(root,e.name),stat:fs.statSync(path.join(root,e.name))})).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs).slice(0,2);for(const f of files){const fd=fs.openSync(f.path,'r'),b=Buffer.alloc(Math.min(131072,f.stat.size));try{fs.readSync(fd,b,0,b.length,Math.max(0,f.stat.size-b.length));}finally{fs.closeSync(fd);}const t=b.toString('utf8'),markers={};for(const [key,re]of Object.entries({loginSuccess:/登录成功|Login Success/gi,rateLimited:/login rate limit/gi,invalidToken:/token is invalid/gi,nativeCrash:/SIGSEGV|segmentation fault|core dumped/gi,uninitialized:/未初始化|not initialized/gi,offline:/SelfOffline|KickedOffLine|账号状态变更为离线/gi})){markers[key]=[...t.matchAll(re)].length;}report.logs.push({modifiedAt:f.stat.mtime.toISOString(),tailBytes:b.length,markers});}}
console.log(JSON.stringify(report));`;
const workerCode=String.raw`
import crypto from'node:crypto';
const report={tokenHash:crypto.createHash('sha256').update(process.env.QQ_NAPCAT_TOKEN??'').digest('hex')};
const category=v=>{const t=String(v?.message??'');return /login rate limit/i.test(t)?'rate-limited':/unauthorized/i.test(t)?'unauthorized':/token is invalid/i.test(t)?'invalid-management-token':/not initialized|未初始化/i.test(t)?'uninitialized':v?.code===0?'ok':'other-error';};
const summary=(r,v)=>({httpStatus:r.status,code:typeof v?.code==='number'?v.code:null,category:category(v),dataType:v?.data===null?'null':Array.isArray(v?.data)?'array':typeof v?.data});
async function post(p,body={},credential){const r=await fetch('http://napcat:6099/api'+p,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const bytes=await r.text();if(Buffer.byteLength(bytes)>524288)throw Error('BOUNDED_RESPONSE_EXCEEDED');return{r,v:JSON.parse(bytes)};}
try{
 const auth=await post('/auth/login',{hash:crypto.createHash('sha256').update(process.env.QQ_NAPCAT_TOKEN+'.napcat').digest('hex')});report.managementAuth={...summary(auth.r,auth.v),requires2FA:auth.v?.data?.require2FA===true};
 const credential=auth.v?.data?.Credential;
 if(auth.v?.code===0&&typeof credential==='string'&&credential.length<=8192){
  const status=await post('/QQLogin/CheckLoginStatus',{},credential);report.loginStatus={...summary(status.r,status.v),...(status.v?.data&&typeof status.v.data==='object'?{isLogin:status.v.data.isLogin===true,isOffline:status.v.data.isOffline===true,coreReady:status.v.data.coreReady===true,phase:['ready','offline','reconnecting','waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','failed'].includes(status.v.data.loginPhase)?status.v.data.loginPhase:'unknown'}:{})};
  const info=await post('/QQLogin/GetQQLoginInfo',{},credential);report.nativeCore={...summary(info.r,info.v),online:typeof info.v?.data?.online==='boolean'?info.v.data.online:null,expectedBotMatches:String(info.v?.data?.uin)==='3922489710'};
 }
}catch(e){report.errorCode=/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'TRANSPORT_OR_RESPONSE_FAILED';}
console.log(JSON.stringify(report));`;
try{const gateway=run('mooyu-qq-napcat-1',gatewayCode),worker=run('mooyu-qq-worker-1',workerCode),tokenMatches=!!gateway.tokenHash&&gateway.tokenHash===worker.tokenHash;delete gateway.tokenHash;delete worker.tokenHash;console.log('gatewayConfigurationAndMarkers '+JSON.stringify(gateway));console.log('exactGatewayResponse '+JSON.stringify(worker));console.log('managementTokenMatches '+tokenMatches);console.log('READONLY_ONE_AUTH_MAX_NO_QQ_LOGIN_NO_RESTART_NO_WRITES');}catch{console.error('BOUNDED_READ_FAILED');process.exitCode=1;}
