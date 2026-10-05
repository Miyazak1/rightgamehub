import { encodeChunk,GAME_TRANSFER_TTL_MS } from '@gamehub/web-game-sdk/transfer';
import { saveResource,saveMutation,saveUpload,saveTransferInput,saveFailure,saveName,saveEtag,SAVE_MAX_DOCUMENT_BYTES } from '@gamehub/web-game-sdk/cloud-save-protocol';

const metadataKeys=['slot','namespace','revisionId','revision','etag','schemaVersion','contentType','contentEncoding','sha256','bytes','updatedAt','deleted','restoredFromRevisionId'];
const metadata=value=>{
  if(!value||!saveName(value.slot)||!saveName(value.namespace)||!saveEtag(value.etag)
    ||typeof value.revision!=='string'||!/^[1-9][0-9]{0,18}$/u.test(value.revision)
    ||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>SAVE_MAX_DOCUMENT_BYTES)
    saveFailure('SAVE_RESPONSE_INVALID','Invalid save metadata from the server.');
  return Object.fromEntries(metadataKeys.map(key=>[key,value[key]]));
};
const writeResult=value=>({...metadata(value),historyDegraded:value.historyDegraded===true,durability:'cloud'});
const slotKey=resource=>resource.namespace+'/'+resource.slot;

/** Runs only in the trusted parent. No session identifiers reach the game. */
export function createCloudSaveHandlers({apiClient,workId,getGameSession,transfer,signal,checkIdentity,sendEvent=()=>{},onCloudSaveStatus,clock=Date.now}) {
  const transferScope=Object.freeze({});
  const states=new Map();let active=null,closed=false;
  const assertOpen=()=>{if(closed||signal?.aborted)saveFailure('BRIDGE_CLOSED','Game launch closed.');};
  const report=(resource,state,extra={})=>{
    if(closed||signal?.aborted)return;
    const value={namespace:resource.namespace,slot:resource.slot,state,...extra};
    const key=slotKey(resource);states.delete(key);states.set(key,value);
    if(states.size>32)states.delete(states.keys().next().value);
    sendEvent('cloudSave.sync.changed',value);
    // A successful write in one slot must not hide an unresolved failure in another.
    const priority={conflict:4,error_retryable:3,blocked:2,syncing:1};
    const attention=[...states.values()].filter(item=>priority[item.state]).sort((a,b)=>priority[b.state]-priority[a.state]);
    onCloudSaveStatus?.(attention[0]??value);
  };
  const reportError=(resource,error,operation)=>report(resource,error.code==='SAVE_CONFLICT'?'conflict':error.retryable?'error_retryable':'blocked',
    {code:error.code??'SAVE_REQUEST_FAILED',operation});
  const release=entry=>{
    if(entry?.transferId)transfer.abort(transferScope,{transferId:entry.transferId});
    if(active===entry)active=null;
  };
  const acquire=(resource,phase)=>{
    assertOpen();
    if(active&&active.phase!=='committing'&&clock()-active.touchedAt>=GAME_TRANSFER_TTL_MS) {
      const expired=active;release(expired);
      if(expired.kind!=='read')reportError(expired.resource,{code:'SAVE_TRANSFER_EXPIRED',retryable:true},'write');
    }
    if(active)saveFailure('SAVE_TRANSFER_BUSY','Another save transfer is active.',true);
    const entry={resource,phase,touchedAt:clock(),transferId:null};
    active=entry;return entry;
  };
  const requireEntry=(input,phase)=>{
    assertOpen();
    const entry=active;
    if(!entry||entry.transferId!==input.transferId||clock()-entry.touchedAt>=GAME_TRANSFER_TTL_MS) {
      if(entry&&entry.transferId===input.transferId&&entry.phase!=='committing')release(entry);
      saveFailure('SAVE_TRANSFER_EXPIRED','Save transfer is unavailable or expired.',true);
    }
    if(entry.phase!==phase)saveFailure('SAVE_TRANSFER_BUSY','Save transfer is in another operation.',true);
    entry.touchedAt=clock();return entry;
  };
  const apiScope=async resource=>{
    assertOpen();await checkIdentity?.();assertOpen();
    const gameSessionId=await getGameSession('cloudSave');
    assertOpen();return {workId,namespace:resource.namespace,...(resource.slot?{slotKey:resource.slot}:{}),gameSessionId};
  };
  const options={signal,beforeRequest:async()=>{assertOpen();await checkIdentity?.();assertOpen();}};
  const call=async(method,resource,...args)=>{
    const scope=await apiScope(resource);
    const result=await apiClient[method](scope,...args,options);
    await checkIdentity?.();assertOpen();
    return result;
  };
  const policy=async resource=>{
    const {data}=await call('getGameSavePolicy',{namespace:resource.namespace});
    if(!data||data.namespace!==resource.namespace||!['active','retired'].includes(data.status)
      ||!Number.isSafeInteger(data.maxDocumentBytes)||data.maxDocumentBytes<1||data.maxDocumentBytes>SAVE_MAX_DOCUMENT_BYTES
      ||!Array.isArray(data.contentTypes))saveFailure('SAVE_RESPONSE_INVALID','Invalid save policy from the server.');
    return Object.fromEntries(['namespace','status','maxSlots','maxDocumentBytes','maxLiveBytes','maxHistoryBytes','historyVersions','historyDays','schemaMin','schemaMax','contentTypes'].map(key=>[key,data[key]]));
  };
  const begin=async input=>{
    const command=saveUpload(input),entry=acquire(command,'preparing');entry.kind='write';
    try {
      const approved=await policy(command);
      const rejection=approved.status!=='active'?['SAVE_POLICY_NOT_ACTIVE','Save policy is retired.']
        :command.totalBytes>approved.maxDocumentBytes?['SAVE_DOCUMENT_TOO_LARGE','Save document exceeds the approved limit.']
        :!approved.contentTypes.includes(command.contentType)?['SAVE_CONTENT_INVALID','This save type is not approved.']
        :command.schemaVersion<approved.schemaMin||command.schemaVersion>approved.schemaMax?['SAVE_SCHEMA_UNSUPPORTED','This save schema is not approved.']:null;
      if(rejection) {
        // A policy change must not hide an already committed write. This lookup
        // allocates no body and can only return an existing, digest-bound receipt.
        const receipt=(await call('getGameSaveWriteReceipt',command,command)).data?.result;
        if(receipt) {
          const result=writeResult(receipt);release(entry);
          report(command,'cloud',{operation:'write',revision:result.revision,historyDegraded:result.historyDegraded});
          return {completed:true,result};
        }
        saveFailure(...rejection);
      }
      assertOpen();
      const cursor=transfer.begin(transferScope,command);
      Object.assign(entry,{...cursor,command,phase:'upload',touchedAt:clock()});
      report(command,'syncing',{operation:'write'});return cursor;
    } catch(error){release(entry);reportError(command,error,'write');throw error;}
  };
  const append=input=>{
    saveTransferInput(input,true);const entry=requireEntry(input,'upload');
    try{return transfer.append(transferScope,input);}catch(error){release(entry);reportError(entry.resource,error,'write');throw error;}
  };
  const commit=async input=>{
    saveTransferInput(input);const entry=requireEntry(input,'upload');entry.phase='committing';
    try {
      const payload=await transfer.commit(transferScope,{transferId:input.transferId,retain:true});
      assertOpen();
      const {data}=await call('writeGameSave',entry.resource,{...entry.command,bytes:payload.bytes});
      const result=writeResult(data);
      report(entry.resource,'cloud',{operation:'write',revision:result.revision,historyDegraded:result.historyDegraded});
      return result;
    } catch(error){reportError(entry.resource,error,'write');throw error;}
    finally{release(entry);}
  };
  const inlineWrite=async input=>{
    const parsed=saveUpload(input,true);
    const {bytes,...command}=parsed;
    const cursor=await begin(command);
    if(cursor.completed)return cursor.result;
    if(bytes.length)append({transferId:cursor.transferId,index:0,chunk:encodeChunk(bytes)});
    return commit({transferId:cursor.transferId});
  };
  const read=async input=>{
    const resource=saveResource(input),entry=acquire(resource,'preparing');entry.kind='read';
    try {
      Object.assign(entry,transfer.reserve(transferScope));
      const meta=metadata((await call('getGameSaveMetadata',resource)).data);
      if(meta.deleted){release(entry);return {...meta,transfer:null};}
      const body=await call('readGameSave',resource,meta.etag);
      if(body.etag!==meta.etag||body.sha256!==meta.sha256||body.schemaVersion!==meta.schemaVersion||body.contentType!==meta.contentType
        ||!(body.data instanceof Uint8Array)||body.data.length!==meta.bytes)
        saveFailure('SAVE_RESPONSE_INVALID','Save content does not match its metadata.');
      const cursor=await transfer.openRead(transferScope,body.data,meta.contentType,{reservationId:entry.transferId});
      assertOpen();
      if(cursor.sha256!==meta.sha256)saveFailure('SAVE_CONTENT_INVALID','Downloaded save digest does not match.');
      entry.phase='download';entry.touchedAt=clock();
      return {...meta,transfer:cursor};
    } catch(error){release(entry);if(error.code!=='SAVE_SLOT_NOT_FOUND')reportError(resource,error,'read');throw error;}
  };
  const mutate=async(input,kind)=>{
    const command=saveMutation(input,kind),entry=acquire(command,'committing');entry.kind=kind;
    try {
      report(command,'syncing',{operation:kind});
      const {data}=await call(kind==='delete'?'deleteGameSave':'restoreGameSave',command,command);
      const result=writeResult(data);
      report(command,'cloud',{operation:kind,revision:result.revision,historyDegraded:result.historyDegraded});
      return result;
    } catch(error){reportError(command,error,kind);throw error;}
    finally{release(entry);}
  };
  const close=()=>{
    if(closed)return;closed=true;release(active);states.clear();signal?.removeEventListener('abort',close);
  };
  signal?.addEventListener('abort',close,{once:true});
  if(signal?.aborted)close();
  else onCloudSaveStatus?.({state:'idle'});
  return {
    handlers:{
      'cloudSave.policy.get':input=>policy(saveResource(input,{slot:false})),
      'cloudSave.slots.list':async input=>{
        const resource=saveResource(input,{slot:false}),{data}=await call('listGameSaves',resource);
        if(!Array.isArray(data)||data.length>10)saveFailure('SAVE_RESPONSE_INVALID','Invalid slot list.');
        return data.map(metadata);
      },
      'cloudSave.slots.metadata':async input=>metadata((await call('getGameSaveMetadata',saveResource(input))).data),
      'cloudSave.slots.read':read,
      'cloudSave.slots.write':inlineWrite,
      'cloudSave.slots.delete':input=>mutate(input,'delete'),
      'cloudSave.slots.restore':input=>mutate(input,'restore'),
      'cloudSave.slots.history':async input=>{
        const resource=saveResource(input,{extra:['beforeRevision']});
        if(input.beforeRevision!==undefined&&(typeof input.beforeRevision!=='string'||!/^[1-9][0-9]{0,18}$/u.test(input.beforeRevision)))
          saveFailure('SAVE_REQUEST_INVALID','Invalid history cursor.');
        const {data}=await call('listGameSaveHistory',resource,input.beforeRevision);
        if(!Array.isArray(data?.items)||data.items.length>50)saveFailure('SAVE_RESPONSE_INVALID','Invalid history page.');
        // Twenty records fit the bridge envelope even at maximum name lengths.
        const items=data.items.slice(0,20).map(row=>({...metadata(row),payloadAvailable:row.payloadAvailable===true}));
        return {items,nextBeforeRevision:data.items.length>20?items.at(-1).revision:data.nextBeforeRevision};
      },
      'cloudSave.sync.status':input=>{
        const resource=saveResource(input);assertOpen();
        return states.get(slotKey(resource))??{...resource,state:'idle'};
      },
      'cloudSave.transfer.begin':begin,
      'cloudSave.transfer.append':append,
      'cloudSave.transfer.commit':commit,
      'cloudSave.transfer.read':input=>{
        saveTransferInput(input,false,true);requireEntry(input,'download');
        return transfer.read(transferScope,input);
      },
      'cloudSave.transfer.abort':input=>{
        saveTransferInput(input);assertOpen();
        if(active?.transferId===input.transferId) {
          if(active.phase==='committing')saveFailure('SAVE_COMMIT_IN_PROGRESS','Save commit is awaiting confirmation; retry with the same idempotency key.',true);
          const entry=active;release(entry);
          if(entry.kind!=='read')report(entry.resource,'idle',{operation:'write',code:'SAVE_TRANSFER_ABORTED'});
        }
        return {aborted:true};
      },
    },close,
  };
}
