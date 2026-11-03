import { createClient } from 'redis';
import { paperStudyError } from './paper-study-persistent-repository.mjs';
export function createPaperStudyRedis({ url, namespace = 'gamehub:paper-study' }) {
  let client,connecting;
  const connect=async()=>{
    if(client?.isReady)return client;
    connecting??=(async()=>{
      if(client?.isOpen)client.destroy();
      client=createClient({url,disableOfflineQueue:true,socket:{connectTimeout:2000,reconnectStrategy:false}});
      client.on('error',()=>{});
      try{await client.connect();return client;}catch(e){if(client?.isOpen)client.destroy();client=null;throw e;}
    })().finally(()=>{connecting=null;});
    return connecting;
  };
  const timed=async task=>{let timer;try{return await Promise.race([task(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(paperStudyError('PAPER_STUDY_REDIS_UNAVAILABLE',503)),2500);})]);}finally{clearTimeout(timer);}};
  return {
    async ready(){try{await timed(async()=>{const c=await connect();await c.ping();});return true;}catch{return false;}},
    async check(owner){try{await timed(async()=>{const c=await connect();const n=await c.eval(`local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n`,{keys:[namespace+':rate:'+owner],arguments:[]});if(Number(n)>60)throw paperStudyError('PAPER_STUDY_RATE_LIMIT',429);});}catch(e){if(e.code==='PAPER_STUDY_RATE_LIMIT')throw e;throw paperStudyError('PAPER_STUDY_REDIS_UNAVAILABLE',503);}},
    // Notification failure cannot undo an already committed PostgreSQL task.
    async notify(id){try{await timed(async()=>{const c=await connect();await c.publish(namespace+':available',id);});}catch{}},
    async close(){if(client?.isOpen)client.destroy();client=null;},
  };
}
