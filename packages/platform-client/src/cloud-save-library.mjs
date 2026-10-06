import {snapshotPayload} from '../../save-cache/src/outbox.mjs';

// Retain the same CAS and idempotency key after an uncertain response.
export function createCloudSaveLibrary({api,id=()=>crypto.randomUUID()}) {
  let prepared=null;
  return {
    async exportRevision(slot,revision) {
      const result=await api.readSaveLibraryRevision(slot.slotId,revision.revisionId,revision.etag);
      if(result.etag!==revision.etag||result.sha256!==revision.sha256||result.schemaVersion!==revision.schemaVersion||result.contentType!==revision.contentType)
        throw Object.assign(new Error('下载的版本信息不一致，请刷新重试。'),{code:'SAVE_CONTENT_INVALID'});
      const payload=await snapshotPayload({bytes:result.data,schemaVersion:result.schemaVersion,contentType:result.contentType,sha256:result.sha256});
      if(payload.bytes!==revision.bytes)throw Object.assign(new Error('备份长度校验失败。'),{code:'SAVE_CONTENT_INVALID'});
      return JSON.stringify({format:'gamehub-save',version:1,workId:slot.workId,channel:slot.channel,namespace:slot.namespace,slot:slot.slot,exportedAt:new Date().toISOString(),payload},null,2);
    },
    async prepareRestore(slotId,revisionId) {
      prepared=null;
      const {data}=await api.getSaveLibraryHistory(slotId);
      // Older pages may not include the source; its continued availability is checked again at commit.
      const request=Object.freeze({revisionId,expectedEtag:data.slot.etag,idempotencyKey:id()});
      prepared={slotId,request};return {current:data.slot};
    },
    async restore() {
      if(!prepared)throw new Error('请重新预览恢复。');
      const plan=prepared;
      const result=await api.restoreSaveLibraryRevision(plan.slotId,plan.request);
      if(prepared===plan)prepared=null;
      return result.data;
    },
    cancel(){prepared=null;},
  };
}
