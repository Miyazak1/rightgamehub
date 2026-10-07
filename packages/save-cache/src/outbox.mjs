import {cacheScope,cacheError,copy} from './store-contract.mjs';
import {sha256Hex} from '../../web-game-sdk/src/transfer.mjs';
export const encodeBody=bytes=>{let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);};
export function decodeBody(text){if(typeof text!=='string'||text.length>1398104)throw cacheError('SAVE_CACHE_CORRUPT','Invalid local payload.');try{const bytes=Uint8Array.from(atob(text),c=>c.charCodeAt(0));if(bytes.length>1048576||encodeBody(bytes)!==text)throw Error();return bytes;}catch{throw cacheError('SAVE_CACHE_CORRUPT','Invalid local payload.');}}

const uuid=()=>crypto.randomUUID();
const localEtag=id=>'"ghlocal-'+id()+'"';
const isRetryable=error=>error?.retryable===false?false:error?.retryable===true || error instanceof TypeError || ['NETWORK_ERROR','API_UNAVAILABLE'].includes(error?.code) || error?.status>=500;
const authFailure=error=>['AUTH_REQUIRED','GAME_SESSION_INVALID','GAME_SESSION_RELEASE_NOT_ALLOWED','BRIDGE_ACCOUNT_CHANGED'].includes(error?.code);
export async function snapshotPayload({bytes,schemaVersion,contentType,sha256}) {
  if(!(bytes instanceof Uint8Array)||bytes.length>1048576||!Number.isInteger(schemaVersion)||schemaVersion<1
    ||!['application/json','application/octet-stream'].includes(contentType))throw cacheError('SAVE_CONTENT_INVALID','Invalid local save payload.');
  const digest=await sha256Hex(bytes);
  if(sha256&&digest!==sha256)throw cacheError('SAVE_CONTENT_INVALID','Local save digest does not match.');
  if(contentType==='application/json') {
    try{const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();}
    catch{throw cacheError('SAVE_CONTENT_INVALID','Local JSON save must be an object.');}
  }
  return {schemaVersion,contentType,sha256:digest,bytes:bytes.length,body:encodeBody(bytes)};
}
export async function verifyPayload(payload) {
  if(!payload)return null;
  const verified=await snapshotPayload({...payload,bytes:decodeBody(payload.body)});
  if(verified.bytes!==payload.bytes)throw cacheError('SAVE_CACHE_CORRUPT','Local payload length does not match.');return verified;
}
const emptyRecord=(id,now)=>({format:1,localEtag:localEtag(id),nextSequence:1,current:null,
  confirmed:{known:false,meta:null,payload:null,localSequence:0},inFlight:null,pending:null,
  conflict:false,comparison:null,recoveries:[],receipts:[],imports:[],lease:null,lastError:null,updatedAt:now()});
const dirty=record=>Boolean(record.inFlight||record.pending);
const stateOf=(record,anonymous)=>record.conflict?'conflict':record.lastError?.retryable===false?'blocked'
  :anonymous?'local_only':dirty(record)?record.lastError?'error_retryable':record.lease?'syncing':'local_pending':record.confirmed.meta?'cloud':'idle';
const preserve=(record,snapshot,reason,id,now)=>{
  if(!snapshot?.payload||record.recoveries.some(item=>item.payload.sha256===snapshot.payload.sha256&&item.payload.schemaVersion===snapshot.payload.schemaVersion&&item.payload.contentType===snapshot.payload.contentType))return;
  if(record.recoveries.length>=3||record.recoveries.reduce((n,item)=>n+item.payload.bytes,0)+snapshot.payload.bytes>1048576)
    throw cacheError('SAVE_RECOVERY_QUOTA_EXCEEDED','Recovery storage is full. Export both versions and use recovery management before resolving.');
  record.recoveries.push({...copy(snapshot),id:id(),reason,createdAt:new Date(now()).toISOString()});
};

/** A durable, account-scoped slot. CAS is required both locally and remotely. */
export function createSaveOutbox({store,scope,remote,localOnly=false,checkIdentity=async()=>{},signal,onStatus=()=>{},clock=Date.now,id=uuid,leaseMs=60000}={}) {
  scope=cacheScope(scope);
  const anonymous=scope.owner.startsWith('anonymous:'),owner=id();
  let closed=false,running=null,authorizationError=null;
  const assertOpen=async()=>{
    if(closed||signal?.aborted)throw cacheError('BRIDGE_CLOSED','Local save session closed.');
    if(authorizationError)throw authorizationError;
    await checkIdentity();
    if(closed||signal?.aborted)throw cacheError('BRIDGE_CLOSED','Local save session closed.');
  };
  const inspect=async()=>{
    await assertOpen();const row=await store.read(scope);await assertOpen();
    if(row.value&&(row.value.format!==1||!Number.isSafeInteger(row.value.nextSequence)||!Array.isArray(row.value.recoveries)))
      throw cacheError('SAVE_CACHE_CORRUPT','Local save metadata is damaged. Preserve the original data.');
    if(row.value?.localOnly && !localOnly)throw cacheError('CLOUD_SAVE_DISABLED','This save is local only. Automatic cloud upload is disabled.');
    if(authFailure(row.value?.lastError)){
      if(localOnly)throw cacheError(row.value.lastError.code,'This save has a revoked authorization.');
      // A restart must not turn a known revocation into an offline-cache bypass.
      // A new valid grant may reclaim this same user's cache only after a server check.
      try{await cloudRead();}catch(error){if(authFailure(error))authorizationError=error;throw error;}
      const value=copy(row.value);value.lastError=null;await assertOpen();
      if(!await store.compareAndSwap(scope,row.version,value))throw cacheError('SAVE_LOCAL_BUSY','Local authorization state changed; retry.',true);
      await assertOpen();return {version:row.version+1,value};
    }
    return row;
  };
  const update=async edit=>{
    for(let attempt=0;attempt<30;attempt++){
      const row=await inspect(),record=copy(row.value??emptyRecord(id,clock));
      const result=edit(record);
      if(result?.unchanged)return {record:row.value,result:result.value};
      record.updatedAt=clock();await assertOpen();
      if(await store.compareAndSwap(scope,row.version,record)){await assertOpen();return {record,result};}
    }
    throw cacheError('SAVE_LOCAL_BUSY','Another window is updating this save. Retry with the same operation.',true);
  };
  const status=record=>({namespace:scope.namespace,slot:scope.slot,state:localOnly?'local_only':stateOf(record,anonymous),
    durability:!localOnly&&!anonymous&&!dirty(record)&&!record.conflict&&record.confirmed.known&&record.confirmed.meta?'cloud':'local',
    localSequence:record.current?.sequence??0,confirmedLocalSequence:record.confirmed.localSequence,
    revision:record.confirmed.meta?.revision??null,code:localOnly?null:record.lastError?.code??null,recoveryCount:record.recoveries.length});
  const report=record=>{if(!closed&&!signal?.aborted)onStatus(status(record));};
  const cloudRead=async()=>{
    if(localOnly)throw cacheError('CLOUD_SAVE_DISABLED','Cloud saves are disabled.');
    await assertOpen();const result=await remote.read();await assertOpen();
    if(result?.payload)await verifyPayload(result.payload);
    return result;
  };
  const read=async({refresh=true}={})=>{
    let row=await inspect();
    if(localOnly && !row.value){
      const {record}=await update(record=>{if(record.confirmed.known)return {unchanged:true};record.confirmed.known=true;record.localOnly=true;});
      row={value:record};
    }
    if(!localOnly && (!row.value || refresh&&!dirty(row.value)&&!row.value.conflict)) {
      let cloud;
      try{cloud=anonymous?null:await cloudRead();}
      catch(error){
        if(authFailure(error)){authorizationError=error;throw error;}
        if(!row.value||!isRetryable(error))throw error;
        cloud=undefined; // Only a transient failure may fall back to this account's cache.
      }
      if(cloud!==undefined){
        const {record}=await update(record=>{
          if(dirty(record)||record.conflict||record.confirmed.known&&(!row.value||record.localEtag!==row.value.localEtag||record.confirmed.meta?.etag!==row.value.confirmed.meta?.etag))return {unchanged:true};
          const changed=!record.confirmed.known||record.confirmed.meta?.etag!==(cloud?.meta?.etag);
          record.confirmed={known:true,meta:cloud?.meta??null,payload:cloud?.payload??null,localSequence:record.current?.sequence??0};
          if(changed){record.localEtag=localEtag(id);record.current=cloud?.payload?{payload:cloud.payload,sequence:record.nextSequence++,etag:record.localEtag}:null;}
          record.confirmed.localSequence=record.current?.sequence??0;record.lastError=null;
        });row={value:record};
      }
    }
    const record=row.value;
    if(!record)throw cacheError('SAVE_CACHE_NOT_READY','Read the cloud save before starting a new local game.');
    if(record.current?.payload)await verifyPayload(record.current.payload);
    report(record);
    return {etag:record.localEtag,payload:copy(record.current?.payload??null),empty:!record.current,
      deleted:record.confirmed.meta?.deleted===true&&!record.current,...status(record)};
  };
  const commitLocal=async({payload,expectedEtag,createOnly=false,idempotencyKey},restoring=false)=>{
    await verifyPayload(payload);
    if(typeof idempotencyKey!=='string'||!/^[0-9a-f-]{36}$/i.test(idempotencyKey))throw cacheError('SAVE_REQUEST_INVALID','A local operation UUID is required.');
    const fingerprint=JSON.stringify([expectedEtag??null,createOnly,payload.sha256,payload.schemaVersion,payload.contentType,payload.bytes,...(restoring?['restore']:[])]);
    const {record,result}=await update(record=>{
      if(!localOnly&&!record.confirmed.known)throw cacheError('SAVE_CACHE_NOT_READY','Read the save before writing.');
      const prior=record.receipts.find(item=>item.id===idempotencyKey);
      if(prior){
        if(prior.fingerprint!==fingerprint)throw cacheError('SAVE_IDEMPOTENCY_CONFLICT','Local operation key was reused with different content.');
        return {unchanged:true,value:prior.result};
      }
      if(createOnly?record.current!==null:record.localEtag!==expectedEtag){
        if(!restoring)preserve(record,{payload,sequence:0,etag:expectedEtag??null},'local-conflict',id,clock);
        return {rejected:'SAVE_LOCAL_CONFLICT'};
      }
      if(restoring){
        if(!localOnly&&record.conflict)throw cacheError('SAVE_COMPARE_REQUIRED','Resolve the cloud conflict before restoring a copy.');
        preserve(record,record.current,'before-restore',id,clock);
      }
      record.localEtag=localEtag(id);
      record.current={payload:copy(payload),sequence:record.nextSequence++,etag:record.localEtag};
      if(localOnly)record.localOnly=true;
      else record.pending=copy(record.current);
      if(!record.conflict)record.lastError=null;
      const receipt={etag:record.localEtag,localSequence:record.current.sequence,durability:'local',state:localOnly||anonymous?'local_only':record.conflict?'conflict':'local_pending'};
      record.receipts.push({id:idempotencyKey,fingerprint,result:receipt});record.receipts=record.receipts.slice(-32);
      return receipt;
    });
    report(record);if(result?.rejected)throw cacheError(result.rejected,restoring?'Current progress changed; inspect it again before restoring.':'Another local window has newer progress. This snapshot was retained as a recovery copy.');return {...result,namespace:scope.namespace,slot:scope.slot};
  };
  const sync=({force=true}={})=>{
    if(localOnly)return inspect().then(row=>row.value?status(row.value):{state:'local_only',durability:'local'});
    if(running)return running;
    running=(async()=>{
      for(let step=0;step<8;step++){
        await assertOpen();
        const {record}=await update(record=>{
          if(!record.confirmed.known||anonymous||record.conflict||!dirty(record)||!force&&(record.nextSyncAt>clock()||record.lastError?.retryable===false))return {unchanged:true};
          if(record.lease&&record.lease.owner!==owner&&record.lease.until>clock())return {unchanged:true};
          if(!record.inFlight){
            const pending=record.pending;
            record.inFlight={...copy(pending),operationId:id(),baseCloudEtag:record.confirmed.meta?.etag??null};
            record.pending=null;
          }
          record.lease={owner,until:clock()+leaseMs};record.lastError=null;
        });
        if(!record)return null;
        report(record);
        if(anonymous||record.conflict||!record.inFlight||record.lease?.owner!==owner||!force&&record.nextSyncAt>clock())return status(record);
        const sent=copy(record.inFlight);
        try{
          await verifyPayload(sent.payload);await assertOpen();
          const result=await remote.write(sent);await assertOpen();
          const {record:confirmed}=await update(current=>{
            if(current.inFlight?.operationId!==sent.operationId)return {unchanged:true};
            current.confirmed={known:true,meta:copy(result),payload:copy(sent.payload),localSequence:sent.sequence};
            current.inFlight=null;current.lease=null;current.lastError=null;current.nextSyncAt=clock()+60000;
          });
          report(confirmed);
        }catch(error){
          if(closed||signal?.aborted||error.code==='BRIDGE_ACCOUNT_CHANGED')throw error;
          const {record:failed}=await update(current=>{
            if(current.inFlight?.operationId!==sent.operationId)return {unchanged:true};
            current.lease=null;current.nextSyncAt=clock()+15000;current.lastError={code:error.code??'SAVE_SYNC_OFFLINE',retryable:isRetryable(error)};
            if(error.code==='SAVE_CONFLICT'){
              current.conflict=true;current.comparison=null;
              // Current is already durable even when the reserved recovery budget is full.
              try{preserve(current,current.current,'cloud-conflict',id,clock);}catch(recoveryError){current.lastError={code:recoveryError.code,retryable:false};}
            }
          });
          report(failed);
          if(authFailure(error))authorizationError=error;
          return status(failed);
        }
      }
      const row=await inspect();return row.value?status(row.value):null;
    })().finally(()=>{running=null;});
    return running;
  };
  const compare=async()=>{
    const cloud=await cloudRead(),token=id();
    const {record}=await update(record=>{record.comparison={token,cloud:copy(cloud)};});
    return {token,local:await read({refresh:false}),cloud:copy(cloud),etag:record.localEtag};
  };
  const resolve=async({choice,token,expectedEtag})=>{
    if(localOnly)throw cacheError('CLOUD_SAVE_DISABLED','Cloud saves are disabled.');
    if(!['local','cloud'].includes(choice))throw cacheError('SAVE_REQUEST_INVALID','Choose local or cloud progress.');
    const {record}=await update(record=>{
      if(!record.conflict||record.comparison?.token!==token||record.localEtag!==expectedEtag)
        throw cacheError('SAVE_COMPARE_REQUIRED','Read both versions again before resolving.');
      preserve(record,record.current,'before-resolution',id,clock);
      const cloud=record.comparison.cloud;
      record.confirmed={known:true,meta:cloud?.meta??null,payload:cloud?.payload??null,localSequence:choice==='cloud'?(record.current?.sequence??0):0};
      // A late reply can no longer acknowledge the resolved operation.
      record.inFlight=null;record.lease=null;record.nextSyncAt=0;record.conflict=false;record.lastError=null;record.comparison=null;
      record.localEtag=localEtag(id);
      if(choice==='cloud'){
        record.current=cloud?.payload?{payload:copy(cloud.payload),sequence:record.nextSequence++,etag:record.localEtag}:null;
        record.pending=null;record.confirmed.localSequence=record.current?.sequence??0;
      }else{
        record.current.etag=record.localEtag;record.pending=copy(record.current);
      }
    });
    report(record);return read({refresh:false});
  };
  return {
    read,write:input=>commitLocal(input),sync,compare,resolve,
    // Trusted management UI only; the game bridge does not expose these mutations.
    restore:input=>commitLocal(input,true),
    async removeRecovery({recoveryId,sha256}){
      const {record}=await update(record=>{
        const index=record.recoveries.findIndex(item=>item.id===recoveryId);
        if(index<0)throw cacheError('SAVE_RECOVERY_NOT_FOUND','Recovery copy not found.');
        if(record.recoveries[index].payload.sha256!==sha256)throw cacheError('SAVE_LOCAL_CONFLICT','Recovery copy changed; export it again.');
        record.recoveries.splice(index,1);
      });report(record);return {removed:true};
    },
    async status(){const row=await inspect();return row.value?status(row.value):{state:localOnly?'local_only':'idle',durability:'local'};},
    async recoveries(){const row=await inspect();return (row.value?.recoveries??[]).map(({payload,...item})=>({...item,bytes:payload.bytes,sha256:payload.sha256}));},
    async recovery(id){const row=await inspect();const item=row.value?.recoveries.find(item=>item.id===id);if(!item)throw cacheError('SAVE_RECOVERY_NOT_FOUND','Recovery copy not found.');await verifyPayload(item.payload);return copy(item);},
    async releaseLease(){if(localOnly||closed||signal?.aborted)return;await update(record=>{if(record.lease?.owner===owner)record.lease=null;else return {unchanged:true};});},
    close(){closed=true;},
  };
}

/** Trusted UI only: explicit import never overwrites an existing cloud slot. */
export async function importAnonymousSave({store,scope,createOutbox,checkIdentity=async()=>{},id=uuid}) {
  cacheScope(scope);if(!scope.owner.startsWith('user:'))throw cacheError('AUTH_REQUIRED','Sign in before importing.');
  const anonymousScope={...scope,owner:'anonymous:'+await store.anonymousId()};
  const source=await store.read(anonymousScope);
  if(!source.value?.current?.payload)throw cacheError('SAVE_ANONYMOUS_NOT_FOUND','No anonymous local progress was found.');
  await verifyPayload(source.value.current.payload);await checkIdentity();
  const importKey=scope.owner+'/'+source.value.localEtag;
  let plan=source.value.imports?.find(item=>item.key===importKey);
  if(!plan){
    const target=createOutbox(scope);const current=await target.read();
    const slot=current.empty?scope.slot:'recovery-anon-'+id().replaceAll('-','').slice(0,20);
    plan={key:importKey,slot,operationId:id(),sourceEtag:source.value.localEtag};
    const record=copy(source.value);record.imports??=[];record.imports.push(plan);
    if(record.imports.length>32)throw cacheError('SAVE_LOCAL_QUOTA_EXCEEDED','Export or manage earlier imports before creating more.');
    await checkIdentity();
    if(!await store.compareAndSwap(anonymousScope,source.version,record))
      throw cacheError('SAVE_LOCAL_CONFLICT','Anonymous progress changed; compare it again.');
  }
  const target=createOutbox({...scope,slot:plan.slot}),current=await target.read();
  // The same immutable operation survives a crash between local import and upload.
  await target.write({payload:source.value.current.payload,createOnly:true,idempotencyKey:plan.operationId});
  const result=await target.sync();await checkIdentity();
  return {slot:plan.slot,...result,anonymousRetained:true};
}
