import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {NATIVE_MANAGEMENT_PROBE,publicNativeReport} from '../../scripts/qq-native-management-readonly.mjs';
const run=async(mode)=>{
 const calls=[],secret='private-diagnostic-token',credential='private-management-credential',qr='https://qq.com/private-qr';let output;
 const fetch=async(url,options)=>{const p=new URL(url).pathname;calls.push(p);assert.equal(options.method,'POST');assert(!/PasswordLogin|Refresh|GetQQLoginQrcode|SetConfig/.test(p));
  if(p.endsWith('/auth/login'))return Response.json(mode==='rate'?{code:-1,message:'login rate limit'}:mode==='token'?{code:-1,message:'token is invalid'}:{code:0,data:{Credential:credential}});
  assert.equal(options.headers.authorization,'Bearer '+credential);
  return Response.json(p.endsWith('CheckLoginStatus')?{code:0,data:{isLogin:true,isOffline:false,coreReady:true,loginPhase:'ready',qrcodeurl:qr,loginError:secret}}:{code:0,data:{uin:'3922489710',online:true}});
 };
 await new (Object.getPrototypeOf(async function(){}).constructor)('crypto','process','fetch','console',NATIVE_MANAGEMENT_PROBE.replace("import crypto from 'node:crypto';",''))(crypto,{env:{QQ_NAPCAT_TOKEN:secret}},fetch,{log:s=>output=JSON.parse(s)});
 return {calls,output,secret,credential,qr};
};
test('native diagnosis authenticates at most once, reads only status/account, and redacts all credential material',async()=>{
 for(const mode of ['ok','rate','token']){
  const {calls,output,secret,credential,qr}=await run(mode);assert.equal(calls.filter(p=>p.endsWith('/auth/login')).length,1);assert.equal(calls.length,mode==='ok'?3:1);
  const publicValue=publicNativeReport(output,{_environmentTokenHash:output._workerTokenHash,_fileTokenHash:output._workerTokenHash,fileTokenPresent:true,twoFactor:false,loginRate:3}),json=JSON.stringify(publicValue);
  assert(!json.includes(secret)&&!json.includes(credential)&&!json.includes(qr)&&!json.includes(output._workerTokenHash));assert.equal(publicValue.tokenComparison.workerVsGatewayFile,true);
  if(mode==='ok'){assert.equal(publicValue.nativeStatus.reportedLogin,true);assert.equal(publicValue.nativeAccount.online,true);}else assert.equal(publicValue.authentication.category,mode==='rate'?'rate-limited':'management-token-mismatch');
 }
});
