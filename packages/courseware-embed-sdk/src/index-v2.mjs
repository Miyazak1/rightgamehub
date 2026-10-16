import {createEmbedV2Envelope,parseEmbedV2Envelope,COURSEWARE_EMBED_V2_MAX_MESSAGES_PER_SECOND} from './protocol-v2.mjs';

const nonce=()=>{const bytes=new Uint8Array(24);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');};

export function createCoursewareEmbedHostV2({frame,expectedOrigin,windowImpl=globalThis.window,MessageChannelImpl=globalThis.MessageChannel,timeoutMs=5000}={}){
  if(!frame?.contentWindow||!expectedOrigin||!windowImpl||!MessageChannelImpl)throw new TypeError('A mounted frame, expected origin, window and MessageChannel are required.');
  if(new URL(expectedOrigin).origin!==expectedOrigin)throw new TypeError('expectedOrigin must be an exact origin.');
  let port=null,closed=false,connected=false,timer=null,expectedNonce=null;const listeners=new Map(),pending=new Map();
  const emit=(name,payload)=>{for(const listener of listeners.get(name)??[])listener(payload);for(const listener of listeners.get('*')??[])listener({name,payload});};
  const close=reason=>{if(closed)return;closed=true;clearTimeout(timer);port?.close?.();for(const item of pending.values())item.reject(Object.assign(new Error('Embed connection closed.'),{code:reason??'EMBED_CLOSED'}));pending.clear();emit('connection.closed',{reason:reason??'closed'});};
  const connect=()=>{if(closed||connected)return;if(port){clearTimeout(timer);port.close?.();port=null;}const channel=new MessageChannelImpl();port=channel.port1;const onMessage=event=>{let message;try{message=parseEmbedV2Envelope(event.data,{types:['connected','event','response','error']});}catch{close('EMBED_MESSAGE_INVALID');return;}if(message.type==='connected'){if(message.payload.nonce!==expectedNonce){close('EMBED_MESSAGE_INVALID');return;}connected=true;clearTimeout(timer);emit('connection.ready',message.payload);return;}if(message.type==='response'||message.type==='error'){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.type==='response'?request.resolve(message.payload):request.reject(Object.assign(new Error(message.name),{code:message.name}));return;}emit(message.name,message.payload);};port.addEventListener?.('message',onMessage);if(!port.addEventListener)port.onmessage=onMessage;port.start?.();expectedNonce=nonce();const message=createEmbedV2Envelope('connect','host.connect',{nonce:expectedNonce});frame.contentWindow.postMessage(message,expectedOrigin,[channel.port2]);timer=setTimeout(()=>close('EMBED_CONNECT_TIMEOUT'),timeoutMs);timer.unref?.();};
  const command=(name,payload={})=>{if(!connected||closed)return Promise.reject(Object.assign(new Error('Embed is not connected.'),{code:'EMBED_NOT_CONNECTED'}));const message=createEmbedV2Envelope('command',name,payload);port.postMessage(message);if(!['host.exportProgress','host.exportState'].includes(name))return Promise.resolve();return new Promise((resolve,reject)=>{const requestTimer=setTimeout(()=>{if(pending.delete(message.id))reject(Object.assign(new Error('Embed command timed out.'),{code:'EMBED_COMMAND_TIMEOUT'}));},timeoutMs);requestTimer.unref?.();pending.set(message.id,{resolve,reject,timer:requestTimer});});};
  const on=(name,listener)=>{const values=listeners.get(name)??new Set();values.add(listener);listeners.set(name,values);return()=>values.delete(listener);};
  return Object.freeze({connect,command,on,close,get connected(){return connected&&!closed;},limits:{messagesPerSecond:COURSEWARE_EMBED_V2_MAX_MESSAGES_PER_SECOND}});
}

export * from './protocol-v2.mjs';
export * from './policy.mjs';
