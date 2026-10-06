const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
test('cloud restore keeps one immutable request across lost responses and rejects reuse after success',async()=>{
  const {createCloudSaveLibrary}=await import('../../packages/platform-client/src/cloud-save-library.mjs');let calls=[];
  const api={getSaveLibraryHistory:async()=>({data:{slot:{etag:'"current"',revision:'7'}}}),restoreSaveLibraryRevision:async(slot,input)=>{calls.push({slot,input});if(calls.length===1)throw new TypeError('lost response');return {data:{revision:'8'}};}};
  const manager=createCloudSaveLibrary({api,id:()=>crypto.randomUUID()});await manager.prepareRestore('slot','old');await assert.rejects(manager.restore(),/lost/);assert.equal((await manager.restore()).revision,'8');assert.deepEqual(calls[0],calls[1]);assert.ok(Object.isFrozen(calls[0].input));await assert.rejects(manager.restore(),/预览/);
});
test('cloud export verifies pinned revision, digest, size and interoperable local format',async()=>{
  const {createCloudSaveLibrary}=await import('../../packages/platform-client/src/cloud-save-library.mjs');const bytes=Buffer.from('{"level":7}'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const slot={slotId:'s',workId:crypto.randomUUID(),channel:'production',namespace:'default',slot:'autosave'},revision={revisionId:'r',etag:'"r"',schemaVersion:1,contentType:'application/json',sha256,bytes:bytes.length};let response={data:new Uint8Array(bytes),etag:revision.etag,sha256,schemaVersion:1,contentType:'application/json'};
  const manager=createCloudSaveLibrary({api:{readSaveLibraryRevision:async(...args)=>{assert.deepEqual(args,['s','r','"r"']);return response;}}});const doc=JSON.parse(await manager.exportRevision(slot,revision));assert.equal(doc.format,'gamehub-save');assert.equal(doc.workId,slot.workId);assert.deepEqual(Buffer.from(doc.payload.body,'base64'),bytes);
  response={...response,data:new Uint8Array(Buffer.from('{"level":8}'))};await assert.rejects(manager.exportRevision(slot,revision),{code:'SAVE_CONTENT_INVALID'});
  response={...response,etag:'"wrong"'};await assert.rejects(manager.exportRevision(slot,revision),{code:'SAVE_CONTENT_INVALID'});
});
