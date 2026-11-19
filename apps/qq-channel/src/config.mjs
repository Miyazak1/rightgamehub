import {createHash} from 'node:crypto';
import {defaultAgentBehaviorProfile} from '../../api/src/agent-behavior-profile.mjs';
export const reject=code=>{throw Object.assign(new Error(code),{code});};
const id=value=>{if(typeof value!=='string'||!/^[1-9][0-9]{4,15}$/u.test(value))reject('QQ_ID_INVALID');return value;};
const integer=(value,fallback,min,max)=>{const n=value??fallback;if(!Number.isSafeInteger(n)||n<min||n>max)reject('QQ_LIMIT_INVALID');return n;};
export function parseConfig(input,env={}){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype)reject('QQ_CONFIG_INVALID');
  const keys=['enabled','botId','groupId','allowedUsers','port','dailyCalls','dailyTokens','userDailyCalls','userMinuteMessages','groupMinuteMessages','maxInputBytes','maxReplyTokens','maxAttempts','model','persona','deployment'];
  if(Object.keys(input).some(key=>!keys.includes(key)))reject('QQ_CONFIG_UNKNOWN_FIELD');
  if(typeof input.enabled!=='boolean')reject('QQ_ENABLE_FLAG_REQUIRED');
  const botId=id(input.botId),groupId=id(input.groupId);
  if(!Array.isArray(input.allowedUsers)||input.allowedUsers.length<1||input.allowedUsers.length>20)reject('QQ_ALLOWLIST_REQUIRED');
  const allowedUsers=[...new Set(input.allowedUsers.map(id))].sort();
  if(allowedUsers.includes(botId))reject('QQ_SELF_ALLOWLIST_DENIED');
  const model=input.model??env.DEEPSEEK_MODEL??'deepseek-chat';
  if(typeof model!=='string'||!/^deepseek-[a-z0-9-]{1,64}$/u.test(model))reject('QQ_MODEL_INVALID');
  const persona=input.persona??defaultAgentBehaviorProfile().core;
  if(!persona||Object.keys(persona).sort().join(',')!=='audience,mission,personality,voice'
    ||Object.values(persona).some(text=>typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>2000))reject('QQ_PERSONA_INVALID');
  if(input.deployment!==undefined&&!['local','server'].includes(input.deployment))reject('QQ_DEPLOYMENT_INVALID');
  const server=input.deployment==='server';
  const config={...(server?{deployment:'server'}:{}),enabled:input.enabled,botId,groupId,allowedUsers,port:integer(input.port,6700,1024,65535),model,persona,
    dailyCalls:integer(input.dailyCalls,20,1,200),dailyTokens:integer(input.dailyTokens,100000,1024,2000000),
    userDailyCalls:integer(input.userDailyCalls,10,1,100),userMinuteMessages:integer(input.userMinuteMessages,3,1,10),
    groupMinuteMessages:integer(input.groupMinuteMessages,10,1,30),maxInputBytes:integer(input.maxInputBytes,2000,1,4000),
    maxReplyTokens:integer(input.maxReplyTokens,512,64,1200),maxAttempts:integer(input.maxAttempts,2,1,3)};
  const token=env.QQ_ACCESS_TOKEN;
  if(typeof token!=='string'||token.length<32||token.length>256||!/^[-_a-zA-Z0-9]+$/u.test(token))reject('QQ_ACCESS_TOKEN_REQUIRED');
  // Server mode accepts only the dedicated Compose DB alias, never a website DB.
  let database;try{database=new URL(env.QQ_DATABASE_URL);}catch{reject('QQ_LOCAL_DATABASE_REQUIRED');}
  const allowedHosts=server?['qq-postgres']:['127.0.0.1','localhost','[::1]'];
  if(!['postgres:','postgresql:'].includes(database.protocol)||!allowedHosts.includes(database.hostname)
    ||!/^\/mooyu_qq_local_[a-z0-9_]{1,60}$/u.test(database.pathname))reject('QQ_LOCAL_DATABASE_REQUIRED');
  for(const [key,value]of Object.entries(env))if(/^PAPER_STUDY_(ENABLED|WORKER_ENABLED|MODELS_ENABLED|PUBLISH_ENABLED)$/u.test(key)&&value!=='false')reject('QQ_PAPER_MUST_REMAIN_DISABLED');
  return {...config,listenHost:server?'0.0.0.0':'127.0.0.1',channelId:botId+':'+groupId,accessToken:token,databaseUrl:database.href,
    policyHash:createHash('sha256').update(JSON.stringify(config)).digest('hex')};
}

export function parseInbound(config,event){
  if(!config.enabled||!event||event.post_type!=='message'||event.message_type!=='group'
    ||String(event.self_id)!==config.botId||String(event.group_id)!==config.groupId
    ||String(event.user_id)===config.botId||!config.allowedUsers.includes(String(event.user_id)))return null;
  if(!Number.isSafeInteger(event.message_id)||!Array.isArray(event.message)||event.message.length>32)return null;
  if(!event.message.some(part=>part?.type==='at'&&String(part.data?.qq)===config.botId))return null;
  if(event.message.some(part=>!['text','at'].includes(part?.type)))return null;
  const text=event.message.filter(part=>part.type==='text').map(part=>typeof part.data?.text==='string'?part.data.text:'').join('').trim();
  if(!text||Buffer.byteLength(text)>config.maxInputBytes||/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text))return null;
  return {messageId:String(event.message_id),userId:String(event.user_id),text};
}
