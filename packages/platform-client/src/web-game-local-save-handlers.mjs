import {saveResource,saveUpload,saveTransferInput,saveFailure,saveUuid} from '@gamehub/web-game-sdk/cloud-save-protocol';
import {encodeChunk,GAME_TRANSFER_TTL_MS} from '@gamehub/web-game-sdk/transfer';
import {createSaveOutbox,snapshotPayload,decodeBody,importAnonymousSave} from '../../save-cache/src/outbox.mjs';
import {metadata} from './web-game-cloud-save-handlers.mjs';
import {createSaveManagement} from './save-management.mjs';

/** The iframe supplies only namespace/slot; owner, origin and work come from the trusted host. */
export function createLocalSaveHandlers({apiClient,descriptor,getGameSession,transfer,signal,checkIdentity,
  saveCache,getSaveOwner,saveOrigin,sendEvent=()=>{},onCloudSaveStatus,onLocalSaveController,onAuthorizationRevoked=()=>{},clock=Date.now}){
  const transferScope=Object.freeze({}),boxes=new Map(),statuses=new Map();
  let active=null,closed=false,authError=null,timer=null;
  const assertOpen=async()=>{if(closed||signal?.aborted)saveFailure('BRIDGE_CLOSED','Game launch closed.');if(authError)throw authError;await checkIdentity?.();};
  const ownerPromise=Promise.resolve().then(getSaveOwner);ownerPromise.catch(()=>{});
  const cloudOptions={signal,beforeRequest:assertOpen};
  const call=async(resource,method,...args)=>{
    await assertOpen();const gameSessionId=await getGameSession('cloudSave');
    const result=await apiClient[method]({workId:descriptor.workId,namespace:resource.namespace,slotKey:resource.slot,gameSessionId},...args,cloudOptions);
    await assertOpen();return result;
  };
  const report=value=>{
    if(closed)return;
    sendEvent('cloudSave.local.changed',value);
    statuses.set(value.namespace+'/'+value.slot,value);
    const priority={conflict:5,blocked:4,error_retryable:3,local_pending:2,syncing:1};
    onCloudSaveStatus?.([...statuses.values()].sort((a,b)=>(priority[b.state]??0)-(priority[a.state]??0))[0]??value);
    if(['AUTH_REQUIRED','GAME_SESSION_INVALID','GAME_SESSION_RELEASE_NOT_ALLOWED'].includes(value.code)){
      authError=Object.assign(new Error('Game save authorization was revoked.'),{code:value.code});
      onAuthorizationRevoked();
    }
  };
  const box=async resource=>{
    await assertOpen();if(!saveCache)saveFailure('SAVE_LOCAL_STORAGE_UNAVAILABLE','This host does not provide durable local saves.');
    const owner=await ownerPromise;await assertOpen();
    const scope={origin:saveOrigin,owner,workId:descriptor.workId,channel:descriptor.channel??'production',...resource};
    return createBox(scope);
  };
  const createBox=scope=>{
    const key=scope.owner+'/'+scope.namespace+'/'+scope.slot;
    if(!boxes.has(key)){
      if(boxes.size>=32)saveFailure('SAVE_LOCAL_QUOTA_EXCEEDED','Too many local save slots in one launch.');
      const resource={namespace:scope.namespace,slot:scope.slot};
      boxes.set(key,createSaveOutbox({store:saveCache,scope,checkIdentity:assertOpen,signal,onStatus:report,clock,remote:{
        read:async()=>{
          let meta;try{meta=metadata((await call(resource,'getGameSaveMetadata')).data);}catch(error){if(error.code==='SAVE_SLOT_NOT_FOUND')return null;throw error;}
          if(meta.deleted)return {meta,payload:null};
          const body=await call(resource,'readGameSave',meta.etag);
          if(body.etag!==meta.etag||body.sha256!==meta.sha256||body.schemaVersion!==meta.schemaVersion||body.contentType!==meta.contentType||body.data.length!==meta.bytes)
            saveFailure('SAVE_RESPONSE_INVALID','Cloud save does not match its metadata.');
          return {meta,payload:await snapshotPayload({bytes:body.data,schemaVersion:meta.schemaVersion,contentType:meta.contentType,sha256:meta.sha256})};
        },
        write:async sent=>{
          const payload=sent.payload;
          const input={namespace:scope.namespace,slot:scope.slot,idempotencyKey:sent.operationId,
            expectedEtag:sent.baseCloudEtag,createOnly:sent.baseCloudEtag===null,schemaVersion:payload.schemaVersion,
            contentType:payload.contentType,encoding:'identity',sha256:payload.sha256,totalBytes:payload.bytes,bytes:decodeBody(payload.body)};
          const result=(await call(resource,'writeGameSave',input)).data;
          return {...metadata(result),historyDegraded:result.historyDegraded===true};
        },
      }}));
    }
    return boxes.get(key);
  };
  const wake=()=>{
    if(closed||timer!==null)return;
    timer=setTimeout(async()=>{
      timer=null;
      for(const item of boxes.values()){if(closed)break;try{await item.sync({force:false});}catch{}}
      if(!closed&&boxes.size)wake();
    },3000);timer.unref?.();
  };
  const release=()=>{if(active?.transferId)transfer.abort(transferScope,{transferId:active.transferId});active=null;};
  const entry=(input,phase)=>{
    if(!active||input.transferId!==active.transferId||clock()-active.at>=GAME_TRANSFER_TTL_MS){if(active?.transferId===input.transferId&&active.phase!=='committing')release();saveFailure('SAVE_TRANSFER_EXPIRED','Local transfer expired.',true);}
    if(active.phase!==phase)saveFailure('SAVE_TRANSFER_BUSY','Another local transfer is active.',true);
    active.at=clock();return active;
  };
  const begin=async input=>{
    const command=saveUpload(input);await assertOpen();await box({namespace:command.namespace,slot:command.slot});
    const cursor=transfer.begin(transferScope,command);active={...cursor,command,phase:'upload',at:clock()};return cursor;
  };
  const append=input=>{saveTransferInput(input,true);entry(input,'upload');return transfer.append(transferScope,input);};
  const commit=async input=>{
    saveTransferInput(input);const upload=entry(input,'upload');upload.phase='committing';
    try{
      const {bytes}=await transfer.commit(transferScope,{transferId:input.transferId,retain:true});await assertOpen();
      const {command}=upload,item=await box({namespace:command.namespace,slot:command.slot});
      const result=await item.write({...command,payload:await snapshotPayload({...command,bytes})});
      wake();return result;
    }finally{release();}
  };
  const inline=async input=>{
    const {bytes,...command}=saveUpload(input,true),cursor=await begin(command);
    if(bytes.length)append({transferId:cursor.transferId,index:0,chunk:encodeChunk(bytes)});
    return commit({transferId:cursor.transferId});
  };
  const read=async input=>{
    const resource=saveResource(input,{extra:['view','token','recoveryId']}),item=await box(resource);
    const view=input.view??'current';
    if(!['current','comparison','recovery'].includes(view))saveFailure('SAVE_REQUEST_INVALID','Invalid local view.');
    if(view==='comparison'&&!saveUuid(input.token)||view==='recovery'&&!saveUuid(input.recoveryId))saveFailure('SAVE_REQUEST_INVALID','Invalid local read token.');
    const reservation=transfer.reserve(transferScope);active={...reservation,phase:'reading',at:clock()};
    try{
      let result,payload;
      if(view==='comparison'){
        const row=await saveCache.read({origin:saveOrigin,owner:await ownerPromise,workId:descriptor.workId,channel:descriptor.channel??'production',...resource});
        if(row.value?.comparison?.token!==input.token)saveFailure('SAVE_COMPARE_REQUIRED','Comparison changed; read it again.');
        const cloud=row.value.comparison.cloud;payload=cloud?.payload??null;
        result={...resource,...cloud?.meta,empty:!payload,durability:'cloud'};
      }else if(view==='recovery'){
        const recovered=await item.recovery(input.recoveryId);payload=recovered.payload;
        result={...resource,etag:recovered.etag,localSequence:recovered.sequence,durability:'local',state:'local_only'};
      }else{result=await item.read();payload=result.payload;delete result.payload;wake();}
      await assertOpen();
      if(!payload){release();return {...result,empty:true,transfer:null};}
      const cursor=await transfer.openRead(transferScope,decodeBody(payload.body),payload.contentType,{reservationId:reservation.transferId});
      active={...cursor,phase:'download',at:clock()};
      return {...resource,...result,schemaVersion:payload.schemaVersion,contentType:payload.contentType,sha256:payload.sha256,bytes:payload.bytes,transfer:cursor};
    }catch(error){release();throw error;}
  };
  let managementPromise;
  const management=()=>managementPromise??=(async()=>{
    await assertOpen();const owner=await ownerPromise;await assertOpen();
    return createSaveManagement({store:saveCache,groupScope:{origin:saveOrigin,owner,workId:descriptor.workId,channel:descriptor.channel??'production'},createBox,assertOpen,wake,clock});
  })();
  onLocalSaveController?.({
    list:async()=>(await management()).list(),
    exportSave:async(...args)=>(await management()).exportSave(...args),
    prepareRestore:async(...args)=>(await management()).prepareRestore(...args),
    restore:async(...args)=>(await management()).restore(...args),
    removeRecovery:async(...args)=>(await management()).removeRecovery(...args),
    sync:async(...args)=>(await management()).sync(...args),
    async listAnonymous(){
      await assertOpen();const scope={origin:saveOrigin,owner:'anonymous:'+await saveCache.anonymousId(),workId:descriptor.workId,channel:descriptor.channel??'production'};
      return (await saveCache.list(scope)).filter(row=>row.value.current).map(row=>({namespace:row.scope.namespace,slot:row.scope.slot,bytes:row.value.current.payload.bytes,updatedAt:row.value.updatedAt}));
    },
    async importAnonymous(resource){
      await assertOpen();resource=saveResource(resource);
      const scope={origin:saveOrigin,owner:await ownerPromise,workId:descriptor.workId,channel:descriptor.channel??'production',...resource};
      return importAnonymousSave({store:saveCache,scope,createOutbox:createBox,checkIdentity:assertOpen});
    },
  });
  return {
    handlers:{
      'cloudSave.local.read':read,'cloudSave.local.write':inline,
      'cloudSave.local.sync':async input=>(await box(saveResource(input))).sync(),
      'cloudSave.local.status':async input=>(await box(saveResource(input))).status(),
      'cloudSave.local.compare':async input=>{
        const pair=await (await box(saveResource(input))).compare();
        return {token:pair.token,etag:pair.etag,revision:pair.cloud?.meta?.revision??null};
      },
      'cloudSave.local.resolve':async input=>{
        const resource=saveResource(input,{extra:['choice','token','expectedEtag']});
        if(!saveUuid(input.token))saveFailure('SAVE_REQUEST_INVALID','A comparison token is required.');
        const result=await (await box(resource)).resolve(input);delete result.payload;wake();return result;
      },
      'cloudSave.local.recoveries':async input=>(await box(saveResource(input))).recoveries(),
      'cloudSave.local.transfer.begin':begin,'cloudSave.local.transfer.append':append,'cloudSave.local.transfer.commit':commit,
      'cloudSave.local.transfer.read':input=>{saveTransferInput(input,false,true);entry(input,'download');return transfer.read(transferScope,input);},
      'cloudSave.local.transfer.abort':input=>{
        saveTransferInput(input);if(active?.transferId===input.transferId){if(active.phase==='committing')saveFailure('SAVE_COMMIT_IN_PROGRESS','Local commit is in progress.',true);release();}return {aborted:true};
      },
    },
    close(){closed=true;clearTimeout(timer);release();for(const item of boxes.values())item.close();boxes.clear();onLocalSaveController?.(null);},
  };
}
