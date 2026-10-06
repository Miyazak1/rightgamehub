import {UPSTREAM_COMMIT,stateSnapshot,readDocument,adrError} from './state.mjs';

/** A receipt from local.write means the host committed a durable local transaction. */
export function createAdrLocalSaveAdapter({cloudSave,onStatus=()=>{},onReplace=()=>{},clock=Date.now,id=()=>crypto.randomUUID(),
  schedule=setTimeout,cancel=clearTimeout,debounceMs=750}={}){
  const api=cloudSave.local,resource={namespace:'default',slot:'autosave'};
  let loaded=false,closed=false,current=null,latest=null,durable=null,operation=null,busy=null,timer=null,failure=null,candidate=null,cloudConflict=false;
  const assertOpen=()=>{if(closed)throw adrError('BRIDGE_CLOSED','账号或连接已改变，请重新打开游戏。');};
  const stop=()=>{if(timer!==null)cancel(timer);timer=null;};
  const report=value=>{if(!closed)onStatus(value);};
  const status=value=>{
    cloudConflict=value.state==='conflict';
    if(latest!==durable&&!failure)return report({state:'pending'});
    report({...value,state:value.state==='error_retryable'?'offline':value.state});
  };
  const plan=()=>{if(timer===null&&!closed&&loaded&&!failure&&!busy&&latest!==durable)timer=schedule(()=>{timer=null;persist().catch(()=>{});},debounceMs);};
  const queue=state=>{assertOpen();if(!loaded)return;latest=stateSnapshot(state);if(latest!==durable&&!failure)report({state:'pending'});plan();};
  const persist=async({retry=false}={})=>{
    assertOpen();stop();if(!loaded)throw adrError('ADR_NOT_LOADED','请先读取存档。');
    if(busy){await busy;if(latest!==durable)return persist({retry});return current;}
    if(failure&&!retry)throw failure;
    if(failure?.code==='SAVE_LOCAL_CONFLICT')throw failure;
    if(latest===durable)return current;
    operation??={snapshot:latest,input:{...resource,expectedEtag:current.etag,idempotencyKey:id(),schemaVersion:1,
      data:{schemaVersion:1,upstreamVersion:'1.4',upstreamCommit:UPSTREAM_COMMIT,savedAt:new Date(clock()).toISOString(),state:JSON.parse(latest)}}};
    const sent=operation;
    busy=(async()=>{
      try{
        const result=await api.write(sent.input);assertOpen();
        current=result;durable=sent.snapshot;operation=null;failure=null;
        status(result);return result;
      }catch(error){
        failure=error;report({state:error.code==='SAVE_LOCAL_CONFLICT'?'conflict':'blocked',code:error.code,
          message:error.code==='SAVE_LOCAL_CONFLICT'?'本机另一个窗口有新进度。请比较双方进度；当前进度仍可导出。':error.message});throw error;
      }finally{busy=null;plan();}
    })();
    return busy;
  };
  const saveNow=async({retry=false}={})=>{
    await persist({retry});assertOpen();
    const result=await api.sync(resource);assertOpen();status(result??{state:'local_pending'});return result;
  };
  return Object.freeze({
    async load(){
      assertOpen();if(loaded)throw adrError('ADR_ALREADY_LOADED','Game already loaded.');
      report({state:'loading'});
      current=await api.read(resource);assertOpen();
      latest=durable=current?.data&&!current.deleted?readDocument(current.data):stateSnapshot({version:1.3});
      loaded=true;status(current);return JSON.parse(latest);
    },
    queue,saveNow,retry:()=>saveNow({retry:true}),
    onSyncStatus(value){if(value.namespace===resource.namespace&&value.slot===resource.slot&&loaded&&!failure)status(value);},
    async compare(){
      assertOpen();if(busy)await busy;
      if(failure?.code==='SAVE_LOCAL_CONFLICT'){
        const read=await api.read(resource);assertOpen();
        candidate={local:true,read,text:read?.data?readDocument(read.data):stateSnapshot({version:1.3})};
      }else{
        await persist();const pair=await api.compare(resource);assertOpen();
        const read=pair.cloud;candidate={...pair,read,text:read?.data&&!read.deleted?readDocument(read.data):stateSnapshot({version:1.3})};
      }
      return {local:JSON.parse(latest),cloud:JSON.parse(candidate.text),revision:candidate.read?.revision??null,localConflict:!!candidate.local,deleted:!!candidate.read?.deleted};
    },
    async keepLocal(){
      assertOpen();if(!candidate)throw adrError('ADR_COMPARE_REQUIRED','请先比较双方进度。');
      const compared=candidate;candidate=null;
      if(compared.local){current=compared.read;operation=null;failure=null;return saveNow();}
      // No newer page snapshot may silently replace the version the player inspected.
      if(latest!==durable)throw adrError('SAVE_COMPARE_REQUIRED','比较后进度又发生变化，请再次比较。');
      current=await api.resolve({...resource,choice:'local',token:compared.token,expectedEtag:compared.etag});assertOpen();
      cloudConflict=false;return saveNow();
    },
    async useCloud(){
      assertOpen();if(!candidate)throw adrError('ADR_COMPARE_REQUIRED','请先比较双方进度。');
      const compared=candidate;
      if(!compared.local)await api.resolve({...resource,choice:'cloud',token:compared.token,expectedEtag:compared.etag});
      assertOpen();stop();closed=true;onReplace(JSON.parse(compared.text),true);
    },
    async replace(state,{reload=true}={}){
      assertOpen();if(busy||operation||failure||latest!==durable||cloudConflict)throw adrError('ADR_PENDING_OPERATION','请先保存或处理当前冲突，再导入或重开。');
      latest=stateSnapshot(state);await persist();assertOpen();onReplace(JSON.parse(durable),reload);return current;
    },
    exportState:()=>latest===null?null:JSON.parse(latest),
    getStatus:()=>({loaded,closed,pending:latest!==durable,inFlight:Boolean(operation),code:failure?.code??null}),
    close(){closed=true;stop();},
  });
}
