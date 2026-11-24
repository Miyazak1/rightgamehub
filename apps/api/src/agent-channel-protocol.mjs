import {createHmac,timingSafeEqual} from 'node:crypto';
import {qqUuid} from './qq-admin-protocol.mjs';
const interactionFail=(code,statusCode)=>{throw Object.assign(new Error(code),{code,statusCode});};
export function channelCanonical(value){
 if(Array.isArray(value))return '['+value.map(channelCanonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+channelCanonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
export function agentChannelSignature(secret,timestamp,requestId,body){return createHmac('sha256',secret).update('mooyu-agent-channel-v1\nPOST\n/v1/internal/agent/qq\n'+timestamp+'\n'+requestId+'\n'+channelCanonical(body)).digest('hex');}
export function verifyAgentChannelSignature(secret,headers,body,now=Date.now()){
 const timestamp=headers['x-agent-channel-time'],requestId=headers['x-agent-channel-request'],signature=headers['x-agent-channel-signature'];
 if(!/^[a-f0-9]{64}$/iu.test(secret??'')||!/^\d{13}$/u.test(timestamp??'')||Math.abs(now-Number(timestamp))>30000||!qqUuid(requestId)||!/^[a-f0-9]{64}$/iu.test(signature??''))interactionFail('AGENT_CHANNEL_UNAUTHORIZED',401);
 const expected=agentChannelSignature(secret,timestamp,requestId,body);
 if(!timingSafeEqual(Buffer.from(signature.toLowerCase()),Buffer.from(expected)))interactionFail('AGENT_CHANNEL_UNAUTHORIZED',401);
 return requestId;
}
