import {createHash} from 'node:crypto';
import {qqAdminError} from '../../api/src/qq-admin-protocol.mjs';
const phases=new Set(['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed','reconnecting']);
const activeLogin=status=>status.isLogin===true&&status.isOffline!==true&&status.loginPhase!=='offline';
// The bundled gateway validates management credentials for one hour. Renew
// before expiry, rather than consuming a new login every four minutes.
export const NAPCAT_CREDENTIAL_REUSE_MS=50*60*1000;
export const QQ_OBSERVATION_TTL_MS=30000;
const configKey=c=>JSON.stringify([c.botId,c.groupId]);
const emptyObservation=()=>({available:false,loggedIn:false,coreReady:false,accountMatches:false,accountState:'unknown',groupReady:false,phase:'unknown',groupState:'unknown',restartRequired:false,qrAvailable:false,checkedAt:null,verifiedAt:null,observation:'unknown',probeFailure:null});
const qrURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='qq.com'||u.hostname.endsWith('.qq.com'))&&!u.username&&!u.password&&u.href.length<=4096?u.href:null;}catch{return null;}};
async function bounded(promise,signal){
 signal.throwIfAborted();let abort;
 try{return await Promise.race([promise,new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});})]);}
 finally{signal.removeEventListener('abort',abort);}
}
export class NapCatControl{
 constructor({token,accessToken,fetchImpl=fetch,origin='http://napcat:6099',workerUrl='ws://worker:6700/onebot/v11',now=Date.now,sampleTimeoutMs=8000}){
  if(!/^[a-f0-9]{64}$/iu.test(token??'')||!accessToken)throw qqAdminError('QQ_GATEWAY_CONFIG_REQUIRED',503);
  Object.assign(this,{token,accessToken,fetchImpl,origin,workerUrl,now,sampleTimeoutMs});this.credential=null;this.authAt=0;this.authRetryAt=0;this.authRetryCode='QQ_GATEWAY_UNAVAILABLE';this.authPending=null;this.nextCheck=0;this.readyGroup=null;this.observed=emptyObservation();
  this.observedKey=null;this.requestedKey=null;this.generation=0;this.inspection=null;this.maintenance=null;this.disconnectedAt=null;this.configRetryAt=0;this.configFailures=0;this.transport={state:'unknown',checkedAt:null};this.memberRetryAt=0;this.memberRetryKey=null;
 }
 async post(path,body={},auth=true,signal=AbortSignal.timeout(10000)){
  signal.throwIfAborted();
  if(auth&&(!this.credential||this.now()<this.authAt||this.now()-this.authAt>NAPCAT_CREDENTIAL_REUSE_MS)){
   if(this.now()<this.authRetryAt)throw qqAdminError(this.authRetryCode,503);
   if(!this.authPending)this.authPending=(async()=>{
    try{const reply=await this.post('/auth/login',{hash:createHash('sha256').update(this.token+'.napcat').digest('hex')},false,signal);
     if(typeof reply?.Credential!=='string'||!reply.Credential||reply.Credential.length>8192)throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);
     this.credential=reply.Credential;this.authAt=this.now();this.authRetryAt=0;
    }catch(error){this.authRetryCode=error.code??'QQ_GATEWAY_UNAVAILABLE';this.authRetryAt=this.now()+(error.code==='QQ_GATEWAY_RATE_LIMITED'?60000:5000);throw error;}
   })().finally(()=>{this.authPending=null;});
   await bounded(this.authPending,signal);
  }
  let response;const usedCredential=this.credential;
  try{response=await bounded(this.fetchImpl(this.origin+'/api'+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+usedCredential}:{})},body:JSON.stringify(body),signal}),signal);
   const value=await bounded((async()=>{const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>524288)throw Error();chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));})(),signal);
   if(response.ok&&path==='/QQLogin/PasswordLogin'&&typeof value.code==='number'&&value.code!==0)throw qqAdminError('QQ_PASSWORD_LOGIN_FAILED',409);
   if(value?.message==='login rate limit')throw qqAdminError('QQ_GATEWAY_RATE_LIMITED',503);
   if(auth&&(response.status===401||response.status===403||value?.message==='Unauthorized'))throw qqAdminError('QQ_GATEWAY_AUTH_REJECTED',503);
   if(path==='/QQLogin/GetQQLoginQrcode'&&value?.message==='QRCode Get Error')throw qqAdminError('QQ_QR_UNAVAILABLE',503);
   if(!response.ok||value.code!==0)throw Error();return value.data;
  }catch(error){
   if(['QQ_PASSWORD_LOGIN_FAILED','QQ_QR_UNAVAILABLE'].includes(error.code))throw error;
   if(error.code==='QQ_GATEWAY_RATE_LIMITED'){this.authRetryCode=error.code;this.authRetryAt=this.now()+60000;throw error;}
   // A core/status error or timeout does not revoke a management credential.
   // Nor may an old in-flight response invalidate a newer successful login.
   if(error.code==='QQ_GATEWAY_AUTH_REJECTED'&&this.credential===usedCredential){this.credential=null;this.authRetryCode='QQ_GATEWAY_UNAVAILABLE';this.authRetryAt=this.now()+5000;}
   throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);
  }
 }
 unwrap(value){if(value&&Object.hasOwn(value,'retcode')){if(value.status!=='ok'||value.retcode!==0)throw qqAdminError('QQ_GROUP_NOT_READY',409);return value.data;}return value;}
 snapshot(config){
  const value=this.observedKey===configKey(config)?{...this.observed}:emptyObservation();
  const age=value.verifiedAt===null?Infinity:this.now()-Date.parse(value.verifiedAt);
  const fresh=age>=0&&age<=QQ_OBSERVATION_TTL_MS;
  return {...value,snapshotVersion:2,available:value.available&&fresh,observation:fresh?value.observation:value.checkedAt?'stale':'unknown',ready:fresh&&this.readyGroup===config.groupId&&value.accountMatches&&value.groupReady,transport:{...this.transport}};
 }
 isReady(config){return this.snapshot(config).ready;}
 stop(){this.stopped=true;this.generation++;this.readyGroup=null;}
 inspect(config){
  const key=configKey(config);
  if(this.inspection?.key===key)return this.inspection.promise;
  this.requestedKey=key;const generation=++this.generation,signal=AbortSignal.timeout(this.sampleTimeoutMs);
  const promise=(async()=>{let next,progress=null,progressStage='login';
   try{next=await bounded(this.readObservation(config,signal,(value,stage)=>{progress={...value};progressStage=stage;}),signal);}
   catch(error){const probeFailure={stage:progressStage,code:signal.aborted?'QQ_GATEWAY_TIMEOUT':/^QQ_[A-Z0-9_]{1,70}$/u.test(error?.code??'')?error.code:'QQ_GATEWAY_UNAVAILABLE'};
    next=progress?{...progress,observation:'partial',probeFailure}:{...(this.observedKey===key?this.observed:emptyObservation()),available:false,observation:'unavailable',probeFailure};}
   if(!this.stopped&&generation===this.generation){
    next.checkedAt=new Date(this.now()).toISOString();this.observed=next;this.observedKey=key;
    this.readyGroup=next.accountMatches&&next.groupReady?config.groupId:null;
   }
   return this.snapshot(config);
  })().finally(()=>{if(this.inspection?.promise===promise)this.inspection=null;});
  this.inspection={key,promise};return promise;
 }
 async readObservation(config,signal,onProgress=()=>{}){
  // Secondary reads have their own smaller deadlines. A slow member lookup
  // must leave time for group-list fallback and cannot erase a verified login.
  const secondaryMs=Math.max(1,Math.min(2000,Math.floor(this.sampleTimeoutMs/4)));
  const post=async(path,body,secondary=false)=>{signal.throwIfAborted();const requestSignal=secondary?AbortSignal.any([signal,AbortSignal.timeout(secondaryMs)]):signal;
   try{return await bounded(this.post(path,body,true,requestSignal),requestSignal);}catch(error){if(requestSignal.aborted)throw qqAdminError('QQ_GATEWAY_TIMEOUT',503);throw error;}};
  const failure=(stage,error)=>({stage,code:/^QQ_[A-Z0-9_]{1,70}$/u.test(error?.code??'')?error.code:'QQ_GATEWAY_UNAVAILABLE'});
  try{
   const status=await post('/QQLogin/CheckLoginStatus');
   if(!status||typeof status.isLogin!=='boolean')throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);
   const loggedIn=activeLogin(status);
   const next={...emptyObservation(),available:true,loggedIn,coreReady:loggedIn&&status.coreReady===true,phase:phases.has(status.loginPhase)?status.loginPhase:'unknown',verifiedAt:new Date(this.now()).toISOString(),observation:'fresh',qrAvailable:!!qrURL(status.qrcodeurl),restartRequired:!loggedIn&&/重启功能未初始化|登录服务重启失败/u.test(String(status.loginError??''))};
   onProgress(next,'identity');
   if(next.loggedIn&&next.coreReady){
    let info;try{info=await post('/QQLogin/GetQQLoginInfo',undefined,true);}catch(error){return {...next,observation:'partial',probeFailure:failure('identity',error)};}
    if(!['string','number'].includes(typeof info?.uin))return {...next,observation:'partial'};
    next.accountMatches=String(info.uin)===config.botId;next.accountState=next.accountMatches?'match':'mismatch';
    onProgress(next,'group');
    if(next.accountMatches){
     try{
      const group=this.unwrap(await post('/Debug/call',{action:'get_group_info',params:{group_id:Number(config.groupId)}},true));
      if(group?.group_id==null)throw qqAdminError('QQ_GROUP_STATUS_UNAVAILABLE',503);
      next.groupState='not-member';
      if(String(group?.group_id)===config.groupId){
       try{
        if(this.memberRetryKey===configKey(config)&&this.now()<this.memberRetryAt)throw qqAdminError('QQ_GATEWAY_UNAVAILABLE',503);
        const member=this.unwrap(await post('/Debug/call',{action:'get_group_member_info',params:{group_id:Number(config.groupId),user_id:Number(config.botId)}},true));
        if(member?.user_id==null)throw qqAdminError('QQ_GROUP_STATUS_UNAVAILABLE',503);
        this.memberRetryAt=0;this.memberRetryKey=null;
        next.groupReady=String(member.user_id)===config.botId;
       }catch(error){
        // Member-detail lookup may fail while this account is online and its
        // group list is healthy. Confirm membership from that same account's
        // explicit list; never infer it from a live socket or group info alone.
        // An explicit OneBot rejection or wrong member identity remains closed.
        if(!['QQ_GATEWAY_UNAVAILABLE','QQ_GATEWAY_TIMEOUT'].includes(error.code))throw error;
        // Do not accumulate a new stuck native member RPC on every poll.
        // During cooldown the same account's group list is checked afresh.
        if(this.memberRetryKey!==configKey(config)||this.now()>=this.memberRetryAt){this.memberRetryKey=configKey(config);this.memberRetryAt=this.now()+300000;}
        const groups=this.unwrap(await post('/Debug/call',{action:'get_group_list',params:{}},true));
        if(!Array.isArray(groups))throw qqAdminError('QQ_GROUP_STATUS_UNAVAILABLE',503);
        next.groupReady=groups.some(g=>String(g?.group_id)===config.groupId);
       }
      }
      next.groupState=next.groupReady?'member':'not-member';
     }catch(error){next.groupState=error.code==='QQ_GROUP_NOT_READY'?'not-member':'unknown';next.observation='partial';next.probeFailure=failure('group',error);}
    }
   }
   return next;
  }catch(error){throw error;}
 }
 async qr(){
  const signal=AbortSignal.timeout(this.sampleTimeoutMs),status=await this.post('/QQLogin/CheckLoginStatus',{},true,signal);if(activeLogin(status))throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);
  const value=await this.post('/QQLogin/GetQQLoginQrcode',{},true,signal),url=qrURL(value?.qrcode);
  if(!url)throw qqAdminError('QQ_QR_UNAVAILABLE',503);
  return {qrText:url,expiresAt:new Date(this.now()+60000).toISOString()};
 }
 async refresh(){const signal=AbortSignal.timeout(this.sampleTimeoutMs),status=await this.post('/QQLogin/CheckLoginStatus',{},true,signal);if(activeLogin(status))throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);const result=await this.post('/QQLogin/RefreshQRcode',{},true,signal);if(result?.restarting===true)throw qqAdminError('QQ_GATEWAY_RESTART_REQUIRED',503);}
 async passwordLogin(uin,password){
  const signal=AbortSignal.timeout(this.sampleTimeoutMs),status=await this.post('/QQLogin/CheckLoginStatus',{},true,signal);if(activeLogin(status))throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);
  // NapCat's existing endpoint accepts an MD5 digest. Neither value is retained.
  let passwordMd5=createHash('md5').update(password,'utf8').digest('hex');password='';
  try{
   const value=await this.post('/QQLogin/PasswordLogin',{uin,passwordMd5},true,signal);
   if(value===null)return {outcome:'submitted'};
   if(value?.needCaptcha===true)return {outcome:'verification_required',verification:'captcha'};
   if(value?.needNewDevice===true)return {outcome:'verification_required',verification:'new_device'};
   throw qqAdminError('QQ_PASSWORD_LOGIN_FAILED',409);
  }catch(error){if(error.code==='QQ_GATEWAY_UNAVAILABLE')throw qqAdminError('QQ_ACTION_UNCERTAIN',409);throw error;}
  finally{passwordMd5='';}
 }
 maintain(config,connected){
  if(this.maintenance)return this.maintenance;
  const promise=this.maintainOnce(config,connected).finally(()=>{if(this.maintenance===promise)this.maintenance=null;});this.maintenance=promise;return promise;
 }
 async maintainOnce(config,connected){
  if(this.stopped)return;
  const isConnected=()=>typeof connected==='function'?connected():connected;
  if(isConnected()){this.disconnectedAt=null;this.configFailures=0;this.transport={state:'connected',checkedAt:new Date(this.now()).toISOString()};}
  else this.disconnectedAt??=this.now();
  if(this.now()<this.nextCheck)return;this.nextCheck=this.now()+5000;
  const state=await this.inspect(config);if(!state.available||!state.accountMatches||!state.groupReady||isConnected())return;
  if(this.now()<this.configRetryAt)return;
  // Give the native reverse socket time to reconnect after a worker/API update.
  if(this.now()-this.disconnectedAt<15000){this.transport={state:'reconnect-grace',checkedAt:new Date(this.now()).toISOString()};return;}
  const signal=AbortSignal.timeout(this.sampleTimeoutMs),key=configKey(config);
  try{
   const current=await this.post('/OB11Config/GetConfig',{},true,signal),clients=current.network?.websocketClients??[];
   if(!Array.isArray(clients))throw qqAdminError('QQ_GATEWAY_CONFIG_REQUIRED',503);
   if(isConnected())return;
   if(clients.some(item=>item.enable&&!['mooyu-server','mooyu-admin-managed'].includes(item.name))){this.transport={state:'manual-config',checkedAt:new Date(this.now()).toISOString()};return;}
   const entry={name:'mooyu-admin-managed',enable:true,url:this.workerUrl,messagePostFormat:'array',reportSelfMessage:false,reconnectInterval:5000,heartInterval:30000,token:this.accessToken,debug:false};
   const managed=clients.filter(item=>['mooyu-server','mooyu-admin-managed'].includes(item.name));
   if(managed.length===1&&Object.entries(entry).every(([k,v])=>managed[0][k]===v)){
    this.transport={state:'waiting-native-reconnect',checkedAt:new Date(this.now()).toISOString()};this.configRetryAt=this.now()+30000;return;
   }
   if(this.stopped||!this.isReady(config)||key!==this.requestedKey||isConnected())return;
   this.configRetryAt=this.now()+60000; // Persist a retry boundary before an uncertain external write.
   await this.post('/OB11Config/SetConfig',{config:JSON.stringify({...current,network:{...current.network,websocketClients:[...clients.filter(item=>!['mooyu-server','mooyu-admin-managed'].includes(item.name)),{...managed[0],...entry}]}})},true,signal);
   this.configFailures=0;this.transport={state:'config-updated',checkedAt:new Date(this.now()).toISOString()};
  }catch{this.configFailures++;this.configRetryAt=this.now()+Math.min(300000,30000*2**Math.min(this.configFailures,4));this.transport={state:'config-unavailable',checkedAt:new Date(this.now()).toISOString()};}
 }
}
