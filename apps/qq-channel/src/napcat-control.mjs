import {createHash} from 'node:crypto';
import {qqAdminError} from '../../api/src/qq-admin-protocol.mjs';
const phases=new Set(['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed','reconnecting']);
const activeLogin=status=>status.isLogin===true&&status.isOffline!==true&&status.loginPhase!=='offline';
export class NapCatControl{
 constructor({token,accessToken,fetchImpl=fetch,origin='http://napcat:6099',workerUrl='ws://worker:6700/onebot/v11',now=Date.now}){
  if(!/^[a-f0-9]{64}$/iu.test(token??'')||!accessToken)throw qqAdminError('QQ_GATEWAY_CONFIG_REQUIRED',503);
  Object.assign(this,{token,accessToken,fetchImpl,origin,workerUrl,now});this.credential=null;this.authAt=0;this.authRetryAt=0;this.authRetryCode='QQ_GATEWAY_UNAVAILABLE';this.authPending=null;this.nextCheck=0;this.readyGroup=null;this.observed={available:false,loggedIn:false,coreReady:false,accountMatches:false,groupReady:false,phase:'offline'};
 }
 async post(path,body={},auth=true){
  if(auth&&(!this.credential||this.now()-this.authAt>240000)){
   if(this.now()<this.authRetryAt)throw qqAdminError(this.authRetryCode,503);
   if(!this.authPending)this.authPending=(async()=>{
    try{const reply=await this.post('/auth/login',{hash:createHash('sha256').update(this.token+'.napcat').digest('hex')},false);
     if(typeof reply?.Credential!=='string'||!reply.Credential||reply.Credential.length>8192)throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);
     this.credential=reply.Credential;this.authAt=this.now();this.authRetryAt=0;
    }catch(error){this.authRetryCode=error.code??'QQ_GATEWAY_UNAVAILABLE';this.authRetryAt=this.now()+(error.code==='QQ_GATEWAY_RATE_LIMITED'?60000:5000);throw error;}
   })().finally(()=>{this.authPending=null;});
   await this.authPending;
  }
  let response;
  try{response=await this.fetchImpl(this.origin+'/api'+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+this.credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
   const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>524288)throw Error();chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(response.ok&&path==='/QQLogin/PasswordLogin'&&typeof value.code==='number'&&value.code!==0)throw qqAdminError('QQ_PASSWORD_LOGIN_FAILED',409);
   if(value?.message==='login rate limit')throw qqAdminError('QQ_GATEWAY_RATE_LIMITED',503);
   if(path==='/QQLogin/GetQQLoginQrcode'&&value?.message==='QRCode Get Error')throw qqAdminError('QQ_QR_UNAVAILABLE',503);
   if(!response.ok||value.code!==0)throw Error();return value.data;
  }catch(error){if(['QQ_PASSWORD_LOGIN_FAILED','QQ_QR_UNAVAILABLE'].includes(error.code))throw error;this.credential=null;if(error.code==='QQ_GATEWAY_RATE_LIMITED'){this.authRetryCode=error.code;this.authRetryAt=this.now()+60000;throw error;}throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);}
 }
 unwrap(value){if(value&&Object.hasOwn(value,'retcode')){if(value.status!=='ok'||value.retcode!==0)throw qqAdminError('QQ_GROUP_NOT_READY',409);return value.data;}return value;}
 async inspect(config){
  try{
   const status=await this.post('/QQLogin/CheckLoginStatus');
   const loggedIn=activeLogin(status);
   const next={available:true,loggedIn,coreReady:loggedIn&&status.coreReady===true,accountMatches:false,groupReady:false,phase:phases.has(status.loginPhase)?status.loginPhase:'offline'};
   if(next.loggedIn&&next.coreReady){
    const info=await this.post('/QQLogin/GetQQLoginInfo');next.accountMatches=String(info.uin)===config.botId;
    if(next.accountMatches){
     try{const group=this.unwrap(await this.post('/Debug/call',{action:'get_group_info',params:{group_id:Number(config.groupId)}}));const member=this.unwrap(await this.post('/Debug/call',{action:'get_group_member_info',params:{group_id:Number(config.groupId),user_id:Number(config.botId)}}));next.groupReady=String(group.group_id)===config.groupId&&String(member.user_id)===config.botId;}catch{}
    }
   }
   this.observed=next;this.readyGroup=next.accountMatches&&next.groupReady?config.groupId:null;return {...next};
  }catch{this.readyGroup=null;return this.observed={available:false,loggedIn:false,coreReady:false,accountMatches:false,groupReady:false,phase:'offline'};}
 }
 async qr(){
  const status=await this.post('/QQLogin/CheckLoginStatus');if(activeLogin(status))throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);
  const value=await this.post('/QQLogin/GetQQLoginQrcode');let url;
  try{url=new URL(value.qrcode);}catch{throw qqAdminError('QQ_QR_UNAVAILABLE',503);}
  if(url.protocol!=='https:'||!(url.hostname==='qq.com'||url.hostname.endsWith('.qq.com'))||url.username||url.password||url.href.length>4096)throw qqAdminError('QQ_QR_UNAVAILABLE',503);
  return {qrText:url.href,expiresAt:new Date(Date.now()+60000).toISOString()};
 }
 async refresh(){const status=await this.post('/QQLogin/CheckLoginStatus');if(activeLogin(status))throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);const result=await this.post('/QQLogin/RefreshQRcode');if(result?.restarting===true)throw qqAdminError('QQ_GATEWAY_RESTART_REQUIRED',503);}
 async passwordLogin(uin,password){
  const status=await this.post('/QQLogin/CheckLoginStatus');if(status.isLogin)throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);
  // NapCat's existing endpoint accepts an MD5 digest. Neither value is retained.
  let passwordMd5=createHash('md5').update(password,'utf8').digest('hex');password='';
  try{
   const value=await this.post('/QQLogin/PasswordLogin',{uin,passwordMd5});
   if(value===null)return {outcome:'submitted'};
   if(value?.needCaptcha===true)return {outcome:'verification_required',verification:'captcha'};
   if(value?.needNewDevice===true)return {outcome:'verification_required',verification:'new_device'};
   throw qqAdminError('QQ_PASSWORD_LOGIN_FAILED',409);
  }catch(error){if(error.code==='QQ_GATEWAY_UNAVAILABLE')throw qqAdminError('QQ_ACTION_UNCERTAIN',409);throw error;}
  finally{passwordMd5='';}
 }
 async maintain(config,connected){
  const isConnected=()=>typeof connected==='function'?connected():connected;
  if(Date.now()<this.nextCheck)return;this.nextCheck=Date.now()+5000;
  const state=await this.inspect(config);if(!state.accountMatches||!state.groupReady||isConnected())return;
  try{
   const current=await this.post('/OB11Config/GetConfig'),clients=current.network?.websocketClients??[];
   if(isConnected())return;
   if(clients.some(item=>item.enable&&!['mooyu-server','mooyu-admin-managed'].includes(item.name)))return;
   const entry={name:'mooyu-admin-managed',enable:true,url:this.workerUrl,messagePostFormat:'array',reportSelfMessage:false,reconnectInterval:5000,heartInterval:30000,token:this.accessToken,debug:false};
   await this.post('/OB11Config/SetConfig',{config:JSON.stringify({...current,network:{...current.network,websocketClients:[...clients.filter(item=>!['mooyu-server','mooyu-admin-managed'].includes(item.name)),entry]}})});
  }catch{this.readyGroup=null;}
 }
}
