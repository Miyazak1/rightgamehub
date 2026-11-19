import {createHash} from 'node:crypto';
import {qqAdminError} from '../../api/src/qq-admin-protocol.mjs';
const phases=new Set(['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed']);
export class NapCatControl{
 constructor({token,accessToken,fetchImpl=fetch,origin='http://napcat:6099',workerUrl='ws://worker:6700/onebot/v11'}){
  if(!/^[a-f0-9]{64}$/iu.test(token??'')||!accessToken)throw qqAdminError('QQ_GATEWAY_CONFIG_REQUIRED',503);
  Object.assign(this,{token,accessToken,fetchImpl,origin,workerUrl});this.credential=null;this.authAt=0;this.nextCheck=0;this.readyGroup=null;this.observed={available:false,loggedIn:false,coreReady:false,accountMatches:false,groupReady:false,phase:'offline'};
 }
 async post(path,body={},auth=true){
  if(auth&&(!this.credential||Date.now()-this.authAt>240000)){
   const reply=await this.post('/auth/login',{hash:createHash('sha256').update(this.token+'.napcat').digest('hex')},false);
   if(typeof reply?.Credential!=='string'||reply.Credential.length>8192)throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);this.credential=reply.Credential;this.authAt=Date.now();
  }
  let response;
  try{response=await this.fetchImpl(this.origin+'/api'+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+this.credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
   const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>524288)throw Error();chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!response.ok||value.code!==0)throw Error();return value.data;
  }catch{this.credential=null;throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);}
 }
 unwrap(value){if(value&&Object.hasOwn(value,'retcode')){if(value.status!=='ok'||value.retcode!==0)throw qqAdminError('QQ_GROUP_NOT_READY',409);return value.data;}return value;}
 async inspect(config){
  try{
   const status=await this.post('/QQLogin/CheckLoginStatus');
   const next={available:true,loggedIn:status.isLogin===true,coreReady:status.coreReady===true,accountMatches:false,groupReady:false,phase:phases.has(status.loginPhase)?status.loginPhase:'offline'};
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
  const status=await this.post('/QQLogin/CheckLoginStatus');if(status.isLogin)throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);
  const value=await this.post('/QQLogin/GetQQLoginQrcode');let url;
  try{url=new URL(value.qrcode);}catch{throw qqAdminError('QQ_QR_UNAVAILABLE',503);}
  if(url.protocol!=='https:'||!(url.hostname==='qq.com'||url.hostname.endsWith('.qq.com'))||url.username||url.password||url.href.length>4096)throw qqAdminError('QQ_QR_UNAVAILABLE',503);
  return {qrText:url.href,expiresAt:new Date(Date.now()+60000).toISOString()};
 }
 async refresh(){const status=await this.post('/QQLogin/CheckLoginStatus');if(status.isLogin)throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);await this.post('/QQLogin/RefreshQRcode');}
 async maintain(config,connected){
  if(Date.now()<this.nextCheck)return;this.nextCheck=Date.now()+5000;
  const state=await this.inspect(config);if(!state.accountMatches||!state.groupReady||connected)return;
  try{
   const current=await this.post('/OB11Config/GetConfig'),clients=current.network?.websocketClients??[];
   if(clients.some(item=>item.enable&&!['mooyu-server','mooyu-admin-managed'].includes(item.name)))return;
   const entry={name:'mooyu-admin-managed',enable:true,url:this.workerUrl,messagePostFormat:'array',reportSelfMessage:false,reconnectInterval:5000,heartInterval:30000,token:this.accessToken,debug:false};
   await this.post('/OB11Config/SetConfig',{config:JSON.stringify({...current,network:{...current.network,websocketClients:[...clients.filter(item=>!['mooyu-server','mooyu-admin-managed'].includes(item.name)),entry]}})});
  }catch{this.readyGroup=null;}
 }
}
