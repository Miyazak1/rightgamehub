import {saveResource,saveFailure,saveUuid} from '@gamehub/web-game-sdk/cloud-save-protocol';
import {verifyPayload} from '../../save-cache/src/outbox.mjs';

// Only the trusted player shell receives this controller, never the game iframe.
export function createSaveManagement({store,groupScope,createBox,assertOpen,wake=()=>{},clock=Date.now}) {
  let prepared=null;
  const resourceOf=input=>saveResource(input);
  const scoped=resource=>({...groupScope,...resourceOf(resource)});
  const checked=async task=>{await assertOpen();const result=await task();await assertOpen();return result;};
  return {
    list:()=>checked(async()=>{
      const rows=await store.list(groupScope),result=[];
      for(const row of rows){
        const resource={namespace:row.scope.namespace,slot:row.scope.slot},box=createBox(scoped(resource));
        const current=await box.read({refresh:false});
        result.push({...resource,etag:current.etag,state:current.state,revision:current.revision,bytes:current.payload?.bytes??0,
          updatedAt:row.value.updatedAt,empty:current.empty,recoveries:await box.recoveries()});
      }
      return result;
    }),
    exportSave:(resource,recoveryId)=>checked(async()=>{
      const scope=scoped(resource),box=createBox(scope);
      if(recoveryId!==undefined&&!saveUuid(recoveryId))saveFailure('SAVE_REQUEST_INVALID','Invalid recovery ID.');
      const value=recoveryId?await box.recovery(recoveryId):await box.read({refresh:false});
      if(!value.payload)saveFailure('SAVE_SLOT_NOT_FOUND','This slot has no progress to export.');
      const payload=await verifyPayload(value.payload);
      return JSON.stringify({format:'gamehub-save',version:1,workId:scope.workId,channel:scope.channel,
        namespace:scope.namespace,slot:scope.slot,exportedAt:new Date(clock()).toISOString(),payload},null,2);
    }),
    prepareRestore:(text,target)=>checked(async()=>{
      prepared=null;
      if(typeof text!=='string'||text.length>1500000)saveFailure('SAVE_CONTENT_INVALID','Save export is too large.');
      let document;try{document=JSON.parse(text);}catch{saveFailure('SAVE_CONTENT_INVALID','Save export is not valid JSON.');}
      const scope=scoped(target);
      if(document?.format!=='gamehub-save'||document.version!==1||document.workId!==scope.workId
        ||document.channel!==scope.channel||document.namespace!==scope.namespace)
        saveFailure('SAVE_CONTENT_INVALID','This export belongs to a different game, channel or namespace.');
      if(!/^[a-f0-9]{64}$/.test(document.payload?.sha256??''))saveFailure('SAVE_CONTENT_INVALID','Save export digest is missing.');
      const payload=await verifyPayload(document.payload);
      if(!payload)saveFailure('SAVE_CONTENT_INVALID','Save export has no payload.');
      const box=createBox(scope),current=await box.read({refresh:false});
      if(current.state==='conflict')saveFailure('SAVE_COMPARE_REQUIRED','Resolve the cloud conflict before restoring.');
      prepared={token:crypto.randomUUID(),scope,payload,expectedEtag:current.etag,idempotencyKey:crypto.randomUUID(),at:clock()};
      return {token:prepared.token,namespace:scope.namespace,slot:scope.slot,bytes:payload.bytes,sha256:payload.sha256,
        replacesCurrent:!current.empty,currentBytes:current.payload?.bytes??0};
    }),
    restore:token=>checked(async()=>{
      const plan=prepared;
      if(!plan||plan.token!==token||clock()-plan.at>300000)saveFailure('SAVE_COMPARE_REQUIRED','Inspect the restore target again.');
      const result=await createBox(plan.scope).restore(plan);wake();return result;
    }),
    removeRecovery:(resource,copy)=>checked(async()=>{
      if(!saveUuid(copy?.id)||typeof copy.sha256!=='string')saveFailure('SAVE_REQUEST_INVALID','Inspect and export the recovery first.');
      return createBox(scoped(resource)).removeRecovery({recoveryId:copy.id,sha256:copy.sha256});
    }),
    sync:resource=>checked(async()=>createBox(scoped(resource)).sync()),
  };
}
