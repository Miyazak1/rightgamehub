const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID:id}=require('node:crypto');
test('ADR local receipt clears close warning offline; restart restores and later cloud sync is separate',async t=>{
 const {createAdrLocalSaveAdapter}=await import('../../samples/adarkroom/local-save-adapter.mjs');
 const {createSaveOutbox,snapshotPayload}=await import('../../packages/save-cache/src/outbox.mjs');
 const {createSqliteSaveStore}=await import('../../packages/save-cache/src/sqlite-store.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adr-local-')),store=await createSqliteSaveStore({root});
 t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
 let offline=false,cloud=null;
 const box=createSaveOutbox({store,scope:{origin:'http://localhost:3000',owner:'user:'+id(),workId:id(),channel:'production',namespace:'default',slot:'autosave'},
 remote:{read:async()=>{if(offline)throw Object.assign(Error('offline'),{retryable:true});return cloud;},
 write:async sent=>{if(offline)throw Object.assign(Error('offline'),{retryable:true});const meta={etag:'"ok"',revision:'1'};cloud={meta,payload:sent.payload};return meta;}}});
 const local={read:async()=>{const r=await box.read();return {...r,data:r.payload?JSON.parse(Buffer.from(r.payload.body,'base64')):null};},
 write:async input=>box.write({...input,payload:await snapshotPayload({bytes:Buffer.from(JSON.stringify(input.data)),schemaVersion:1,contentType:'application/json'})}),
 sync:()=>box.sync()};
 const statuses=[],create=()=>createAdrLocalSaveAdapter({cloudSave:{local},onStatus:v=>statuses.push(v)});
 const a=create();t.after(()=>a.close());await a.load();offline=true;a.queue({version:1.3,stores:{wood:42}});await a.saveNow();
 assert.equal(a.getStatus().pending,false);assert.equal(a.getStatus().inFlight,false);assert.equal(statuses.at(-1).state,'offline');assert.equal(cloud,null);a.close();
 const b=create();t.after(()=>b.close());assert.equal((await b.load()).stores.wood,42);
 offline=false;await b.retry();assert.equal(statuses.at(-1).state,'cloud');assert.equal(JSON.parse(Buffer.from(cloud.payload.body,'base64')).state.stores.wood,42);
});
