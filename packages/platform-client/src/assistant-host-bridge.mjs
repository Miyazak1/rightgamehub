// A host is authoritative for its chat. Never fall back to a second platform chat.
export function syncHostAssistantContext(host,context,{windowImpl=globalThis.window}={}) {
  if(typeof host?.assistant?.syncContext==='function') { Promise.resolve(host.assistant.syncContext(context)).catch(()=>{}); return; }
  if(windowImpl && windowImpl.parent!==windowImpl)windowImpl.parent.postMessage({type:'gamehub/assistant.context',payload:context},'*');
}
export async function requestHostAssistant(host, payload, {windowImpl=globalThis.window,timeoutMs=12000}={}) {
  if(typeof host?.assistant?.send==='function')return host.assistant.send(payload);
  if(!windowImpl || windowImpl.parent===windowImpl)throw new Error('HOST_CHAT_UNAVAILABLE');
  const requestId=globalThis.crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const finish=(error,result)=>{clearTimeout(timer);windowImpl.removeEventListener('message',receive);error?reject(error):resolve(result);};
    const receive=event=>{if(event.source!==windowImpl.parent || event.data?.type!=='gamehub/assistant.status' || event.data.requestId!==requestId)return;
      finish(event.data.status==='sent'?null:new Error('HOST_CHAT_UNAVAILABLE'),event.data);};
    const timer=setTimeout(()=>finish(new Error('HOST_CHAT_UNAVAILABLE')),timeoutMs);
    windowImpl.addEventListener('message',receive);
    windowImpl.parent.postMessage({type:'gamehub/assistant.request',requestId,payload},'*');
  });
}
