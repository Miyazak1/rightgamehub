import {cacheKey,cacheGroup,cacheScope,serializeRecord,cacheError,CACHE_MAX_BYTES,CACHE_MAX_SLOTS} from './store-contract.mjs';

/** One read/write transaction includes version, body and global quota accounting. */
export function createIndexedDbSaveStore({indexedDB=globalThis.indexedDB,name='gamehub.saves.v1',randomUUID=()=>crypto.randomUUID()}={}) {
  let database;
  const open=()=>database??=(new Promise((resolve,reject)=>{
    if(!indexedDB) {reject(cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE','IndexedDB is unavailable; progress has not been saved locally.'));return;}
    const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('records',{keyPath:'key'});request.result.createObjectStore('meta');};
    request.onerror=()=>reject(cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE','Could not open local save storage.'));
    request.onblocked=()=>reject(cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE','Another tab is blocking the save database upgrade.'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=null;};resolve(db);};
  })).catch(error=>{database=null;throw error;});
  const transact=async(mode,run)=>{
    const db=await open();
    return new Promise((resolve,reject)=>{
      let result,error;let tx;
      try {tx=db.transaction(['records','meta'],mode,{durability:'strict'});}catch(e){reject(cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE',e.message));return;}
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(error??cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE','Local save transaction failed. No local confirmation was issued.'));
      tx.onerror=()=>{};
      try {run(tx,value=>{result=value;},value=>{error=value;tx.abort();});}catch(e){error=e;tx.abort();}
    });
  };
  return {
    kind:'indexeddb',
    anonymousId:()=>transact('readwrite',(tx,done)=>{
      const meta=tx.objectStore('meta'),request=meta.get('anonymousId');
      request.onsuccess=()=>{const id=request.result??randomUUID();if(!request.result)meta.put(id,'anonymousId');done(id);};
    }),
    read:scope=>transact('readonly',(tx,done,fail)=>{
      const request=tx.objectStore('records').get(cacheKey(scope));
      request.onsuccess=()=>{try{const row=request.result;done(row?{version:row.version,value:JSON.parse(row.text)}:{version:0,value:null});}catch{fail(cacheError('SAVE_CACHE_CORRUPT','Local save data is unreadable.'));}};
    }),
    compareAndSwap:(scope,version,value)=>transact('readwrite',(tx,done,fail)=>{
      const key=cacheKey(scope),group=cacheGroup(scope),text=serializeRecord(value),bytes=new TextEncoder().encode(text).length;
      const records=tx.objectStore('records'),request=records.getAll();
      request.onsuccess=()=>{
        const rows=request.result,old=rows.find(row=>row.key===key);
        if((old?.version??0)!==version){done(false);return;}
        if(rows.reduce((n,row)=>n+row.bytes,0)-(old?.bytes??0)+bytes>CACHE_MAX_BYTES
          || !old&&rows.filter(row=>row.group===group).length>=CACHE_MAX_SLOTS){fail(cacheError('SAVE_LOCAL_QUOTA_EXCEEDED','Local save storage is full. Existing progress was retained.'));return;}
        records.put({key,group,scope:cacheScope(scope),version:version+1,text,bytes});done(true);
      };
    }),
    list:scope=>transact('readonly',(tx,done,fail)=>{
      const group=cacheGroup({...scope,namespace:scope.namespace??'default',slot:'autosave'}),request=tx.objectStore('records').getAll();
      request.onsuccess=()=>{try{done(request.result.filter(row=>row.group===group).map(row=>({scope:row.scope,version:row.version,value:JSON.parse(row.text)})));}catch{fail(cacheError('SAVE_CACHE_CORRUPT','Local save metadata is unreadable.'));}};
    }),
    async close(){if(database)(await database).close();database=null;},
  };
}
