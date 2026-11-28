// One bounded management authentication for diagnosis. It does not request a
// QQ login/QR, update config, revoke credentials, or restart any service.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const NATIVE_MANAGEMENT_PROBE=String.raw`
import crypto from 'node:crypto';
const report={managementAuthRequests:0,qqLoginRequested:false,qrRequested:false,configurationWritten:false,servicesRestarted:false};
const token=process.env.QQ_NAPCAT_TOKEN??'';report._workerTokenHash=crypto.createHash('sha256').update(token).digest('hex');
const signal=AbortSignal.timeout(12000);
function category(message){return new Map([['login rate limit','rate-limited'],['token is invalid','management-token-mismatch'],['Server token not initialized','management-token-not-initialized'],['Unauthorized','credential-rejected'],['Authorization Failed','credential-rejected'],['Token has been revoked','credential-revoked']]).get(message)??'other-error';}
async function post(endpoint,body,credential){
 const r=await fetch('http://napcat:6099/api'+endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(credential?{authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal});
 const chunks=[];let n=0;for await(const c of r.body){n+=c.length;if(n>524288)throw Error('RESPONSE_TOO_LARGE');chunks.push(c);}
 const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 return {value:v,summary:{httpStatus:r.status,apiCode:typeof v?.code==='number'?v.code:null,category:r.ok&&v?.code===0?'ok':category(v?.message)}};
}
try{
 report.managementAuthRequests++;const auth=await post('/auth/login',{hash:crypto.createHash('sha256').update(token+'.napcat').digest('hex')});
 report.authentication={...auth.summary,requires2FA:auth.value?.data?.require2FA===true};
 const credential=auth.value?.data?.Credential;
 if(auth.summary.category==='ok'&&typeof credential==='string'&&credential.length>0&&credential.length<=8192){
  const status=await post('/QQLogin/CheckLoginStatus',{},credential),s=status.value?.data;
  report.nativeStatus={...status.summary,isLoginType:typeof s?.isLogin,isOfflineType:typeof s?.isOffline,coreReadyType:typeof s?.coreReady,reportedLogin:typeof s?.isLogin==='boolean'?s.isLogin:null,reportedOffline:typeof s?.isOffline==='boolean'?s.isOffline:null,coreReady:typeof s?.coreReady==='boolean'?s.coreReady:null,phase:['ready','offline','reconnecting','waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','failed'].includes(s?.loginPhase)?s.loginPhase:'unknown',cachedQrPresent:typeof s?.qrcodeurl==='string'&&s.qrcodeurl.length>0,loginErrorPresent:typeof s?.loginError==='string'&&s.loginError.length>0,restartUninitialized:/重启功能未初始化/u.test(String(s?.loginError??'')),duplicateLogin:/无法重复登录|already.*log/iu.test(String(s?.loginError??''))};
  const info=await post('/QQLogin/GetQQLoginInfo',{},credential),i=info.value?.data;
  report.nativeAccount={...info.summary,online:typeof i?.online==='boolean'?i.online:null,expectedAccount:['string','number'].includes(typeof i?.uin)?String(i.uin)==='3922489710':null};
 }
}catch(e){report.readError=signal.aborted?'DEADLINE_EXCEEDED':e?.message==='RESPONSE_TOO_LARGE'?'RESPONSE_TOO_LARGE':e?.name==='SyntaxError'?'INVALID_JSON':'TRANSPORT_OR_RESPONSE_FAILED';}
console.log(JSON.stringify(report));`;

export const GATEWAY_TOKEN_PROBE=String.raw`
import f from 'node:fs';import c from 'node:crypto';
const hash=s=>typeof s==='string'&&s.length?c.createHash('sha256').update(s).digest('hex'):null;
const out={_environmentTokenHash:hash(process.env.QQ_WEBUI_TOKEN)};
for(const file of ['/data/napcat/config/webui.json','/app/napcat/config/webui.json']){
 try{const s=f.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)continue;const v=JSON.parse(f.readFileSync(file,'utf8'));out.fileTokenPresent=typeof v.token==='string'&&v.token.length>0;out._fileTokenHash=hash(v.token);out.twoFactor=v.enable2FA===true;out.loginRate=Number.isSafeInteger(v.loginRate)?v.loginRate:null;break;}catch{}
}console.log(JSON.stringify(out));`;

export function publicNativeReport(worker,gateway){
 const value=structuredClone(worker),key=value._workerTokenHash;delete value._workerTokenHash;
 return {...value,tokenComparison:{workerVsGatewayEnvironment:gateway._environmentTokenHash?key===gateway._environmentTokenHash:null,workerVsGatewayFile:gateway._fileTokenHash?key===gateway._fileTokenHash:null,gatewayFileTokenPresent:gateway.fileTokenPresent??null,twoFactor:gateway.twoFactor??null,loginRate:gateway.loginRate??null},rawErrorsTokensAndQrPrinted:false};
}
export function diagnoseNativeManagement(){
 const read=(container,code)=>{
  const r=spawnSync('docker',['exec',container,'node','--input-type=module','-e',code],{encoding:'utf8',timeout:18000,maxBuffer:1048576});
  if(r.status!==0||r.error)throw Error('BOUNDED_DIAGNOSTIC_EXEC_FAILED');return JSON.parse(r.stdout);
 };
 let gateway={};try{gateway=read('mooyu-qq-napcat-1',GATEWAY_TOKEN_PROBE);}catch{}
 const worker=read('mooyu-qq-worker-1',NATIVE_MANAGEMENT_PROBE);console.log(JSON.stringify(publicNativeReport(worker,gateway),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{diagnoseNativeManagement();}catch{console.log(JSON.stringify({result:'NATIVE_MANAGEMENT_READ_FAILED',qqLoginRequested:false,qrRequested:false,configurationWritten:false,servicesRestarted:false}));process.exitCode=1;}
}
