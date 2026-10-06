import {cacheScope,cacheError,CACHE_MAX_RECORD_BYTES} from './store-contract.mjs';

/** Only trusted host UI can call this boundary; it never accepts arbitrary paths. */
export async function runSaveStoreRequest({store,operation,payload={},origin,getTokens}) {
  if(!store)throw cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE','This host cannot persist game saves. Node.js 22.13 or newer with SQLite is required.');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>CACHE_MAX_RECORD_BYTES+8192)
    throw cacheError('SAVE_REQUEST_INVALID','Invalid local storage request.');
  if(operation==='anonymousId')return store.anonymousId();
  if(!['read','compareAndSwap','list'].includes(operation))throw cacheError('SAVE_REQUEST_INVALID','Unknown local storage operation.');
  const scope=cacheScope(operation==='list'?{...payload.scope,namespace:payload.scope?.namespace??'default',slot:'autosave'}:payload.scope);
  const tokens=await getTokens(),anonymous='anonymous:'+await store.anonymousId();
  const owner=tokens?.profile?.id?'user:'+tokens.profile.id:null;
  if(scope.origin!==origin||scope.owner!==anonymous&&scope.owner!==owner)
    throw cacheError('BRIDGE_ACCOUNT_CHANGED','Local save account does not match the current host account.');
  if(operation==='compareAndSwap'){
    if(!Number.isSafeInteger(payload.version)||payload.version<0)throw cacheError('SAVE_REQUEST_INVALID','Invalid local storage version.');
    return store.compareAndSwap(scope,payload.version,payload.value);
  }
  return store[operation](scope);
}
export function createSaveStoreProxy(call) {
  return {kind:'host',anonymousId:()=>call('anonymousId',{}),read:scope=>call('read',{scope}),
    compareAndSwap:(scope,version,value)=>call('compareAndSwap',{scope,version,value}),list:scope=>call('list',{scope})};
}
