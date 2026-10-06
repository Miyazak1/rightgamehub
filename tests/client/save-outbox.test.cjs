const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID:id}=require('node:crypto');
async function fixture(t){
  const {createSqliteSaveStore}=await import('../../packages/save-cache/src/sqlite-store.mjs');
  const {createSaveOutbox,snapshotPayload,importAnonymousSave}=await import('../../packages/save-cache/src/outbox.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-s2-'));
  const store=await createSqliteSaveStore({root}),stores=[store];
  t.after(async()=>{for(const store of stores)await store.close();await fs.rm(root,{recursive:true,force:true});});
  const scope={origin:'http://127.0.0.1:3086',owner:'user:'+id(),workId:id(),channel:'production',namespace:'default',slot:'autosave'};
  let time=100000,cloud=null,offline=false,loseAck=false,calls=[],gate=null;
  const receipts=new Map();
  const remote={
    async read(){if(offline)throw Object.assign(Error('offline'),{code:'NETWORK_ERROR',retryable:true});return structuredClone(cloud);},
    async write(op){
      calls.push(structuredClone(op));if(offline)throw Object.assign(Error('offline'),{code:'NETWORK_ERROR',retryable:true});
      if(gate)await gate;
      if(receipts.has(op.operationId))return receipts.get(op.operationId);
      if((cloud?.meta.etag??null)!==op.baseCloudEtag)throw Object.assign(Error('conflict'),{code:'SAVE_CONFLICT'});
      const meta={etag:'"cloud-'+(Number(cloud?.meta.revision??0)+1)+'"',revision:String(Number(cloud?.meta.revision??0)+1),bytes:op.payload.bytes,sha256:op.payload.sha256,
        schemaVersion:op.payload.schemaVersion,contentType:op.payload.contentType,slot:scope.slot,namespace:scope.namespace};
      cloud={meta,payload:structuredClone(op.payload)};receipts.set(op.operationId,meta);
      if(loseAck){loseAck=false;throw Object.assign(Error('lost ack'),{retryable:true});}return meta;
    },
  };
  const open=(extra={})=>createSaveOutbox({store,scope,remote,clock:()=>time,...extra});
  const payload=data=>snapshotPayload({bytes:new TextEncoder().encode(JSON.stringify(data)),schemaVersion:1,contentType:'application/json'});
  return {scope,store,root,open,payload,remote,calls,importAnonymousSave,
    cloud:()=>cloud,setCloud:value=>{cloud=value;},offline:value=>{offline=value;},loseAck:()=>{loseAck=true;},tick:()=>{time+=70000;},gate:value=>{gate=value;},
    reopen:async()=>{const next=await createSqliteSaveStore({root});stores.push(next);return next;}};
}
test('durable pending survives reopening SQLite, then replays without creating a new logical save',async t=>{
  const f=await fixture(t),box=f.open();const empty=await box.read();f.offline(true);
  const saved=await box.write({payload:await f.payload({wood:10}),expectedEtag:empty.etag,idempotencyKey:id()});
  assert.equal(saved.durability,'local');await box.sync();box.close();
  const restored=f.open({store:await f.reopen()}),read=await restored.read();
  assert.equal(JSON.parse(Buffer.from(read.payload.body,'base64')).wood,10);assert.equal(read.state,'error_retryable');
  f.offline(false);await restored.sync();assert.equal(f.cloud().meta.revision,'1');
  assert.equal((await restored.status()).state,'cloud');assert.equal(f.calls[0].operationId,f.calls[1].operationId);
});
test('lost ACK freezes the original payload/key/base while newer snapshots fold into pending',async t=>{
  const f=await fixture(t),box=f.open();let view=await box.read();
  view=await box.write({payload:await f.payload({step:1}),expectedEtag:view.etag,idempotencyKey:id()});f.loseAck();await box.sync();
  view=await box.write({payload:await f.payload({step:2}),expectedEtag:view.etag,idempotencyKey:id()});
  await box.write({payload:await f.payload({step:3}),expectedEtag:view.etag,idempotencyKey:id()});
  box.close();const restored=f.open({store:await f.reopen()});await restored.sync();
  assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.calls.length,3);
  assert.equal(JSON.parse(Buffer.from(f.calls[2].payload.body,'base64')).step,3);
  assert.equal(f.calls[2].baseCloudEtag,'"cloud-1"');assert.equal(f.cloud().meta.revision,'2');
});
test('process death after send leaves a recoverable lease; old ACK cannot discard newer pending',async t=>{
  const f=await fixture(t),box=f.open();let view=await box.read();
  view=await box.write({payload:await f.payload({step:1}),expectedEtag:view.etag,idempotencyKey:id()});
  let finish;f.gate(new Promise(resolve=>{finish=resolve;}));const syncing=box.sync();
  while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
  await box.write({payload:await f.payload({step:2}),expectedEtag:view.etag,idempotencyKey:id()});
  box.close();finish();await assert.rejects(syncing,{code:'BRIDGE_CLOSED'});f.gate(null);f.tick();
  const restored=f.open({store:await f.reopen()});await restored.sync();
  assert.equal(f.cloud().meta.revision,'2');assert.equal(JSON.parse(Buffer.from(f.cloud().payload.body,'base64')).step,2);
});
test('independent windows cannot silently replace local progress or send different simultaneous operations',async t=>{
  const f=await fixture(t),a=f.open(),b=f.open({store:await f.reopen()});
  const av=await a.read(),bv=await b.read();
  await a.write({payload:await f.payload({x:1}),expectedEtag:av.etag,idempotencyKey:id()});
  await assert.rejects(b.write({payload:await f.payload({x:2}),expectedEtag:bv.etag,idempotencyKey:id()}),{code:'SAVE_LOCAL_CONFLICT'});
  let finish;f.gate(new Promise(resolve=>{finish=resolve;}));const send=a.sync();
  while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
  await b.sync();assert.equal(f.calls.length,1);finish();await send;
});
test('cloud conflict freezes sending, retains the latest snapshot and requires an explicit fresh comparison',async t=>{
  const f=await fixture(t),box=f.open();let view=await box.read();
  view=await box.write({payload:await f.payload({step:1}),expectedEtag:view.etag,idempotencyKey:id()});f.offline(true);await box.sync();
  await box.write({payload:await f.payload({step:3}),expectedEtag:view.etag,idempotencyKey:id()});
  f.setCloud({meta:{etag:'"other-device"',revision:'5'},payload:await f.payload({step:2})});f.offline(false);
  assert.equal((await box.sync()).state,'conflict');const count=f.calls.length;await box.sync();assert.equal(f.calls.length,count);
  assert.equal((await box.recoveries()).length,1);const pair=await box.compare();
  await assert.rejects(box.resolve({choice:'local',token:'wrong',expectedEtag:pair.etag}),{code:'SAVE_COMPARE_REQUIRED'});
  await box.resolve({choice:'local',token:pair.token,expectedEtag:pair.etag});await box.sync();
  assert.equal(JSON.parse(Buffer.from(f.cloud().payload.body,'base64')).step,3);assert.equal(f.cloud().meta.revision,'6');
});
test('switching accounts blocks late replies; another account/channel/origin/work cannot read the cache',async t=>{
  const f=await fixture(t);let active=true;const box=f.open({checkIdentity:async()=>{if(!active)throw Object.assign(Error('changed'),{code:'BRIDGE_ACCOUNT_CHANGED'});}});
  const view=await box.read();await box.write({payload:await f.payload({private:1}),expectedEtag:view.etag,idempotencyKey:id()});
  active=false;await assert.rejects(box.read(),{code:'BRIDGE_ACCOUNT_CHANGED'});assert.equal(f.calls.length,0);
  for(const extra of [{owner:'user:'+id()},{channel:'preview'},{origin:'http://localhost:3086'},{workId:id()}]){
    assert.equal((await f.store.read({...f.scope,...extra})).value,null);
  }
});
test('quota or corrupt body failures never claim a local save or replace the previous snapshot',async t=>{
  const f=await fixture(t),box=f.open();const view=await box.read(),payload=await f.payload({ok:true});
  const bad={...payload,body:'invalid'};await assert.rejects(box.write({payload:bad,expectedEtag:view.etag,idempotencyKey:id()}));
  const broken=f.open({store:{read:scope=>f.store.read(scope),compareAndSwap:async()=>{throw Object.assign(Error('full'),{code:'SAVE_LOCAL_QUOTA_EXCEEDED'});}}});
  await assert.rejects(broken.write({payload,expectedEtag:view.etag,idempotencyKey:id()}),{code:'SAVE_LOCAL_QUOTA_EXCEEDED'});
  assert.equal((await box.read()).empty,true);
});
test('anonymous import keeps the original and uses a separate recovery slot when cloud already exists',async t=>{
  const f=await fixture(t),anonScope={...f.scope,owner:'anonymous:'+await f.store.anonymousId()},anon=f.open({scope:anonScope});
  let v=await anon.read();await anon.write({payload:await f.payload({guest:1}),expectedEtag:v.etag,idempotencyKey:id()});await anon.sync();
  assert.equal(f.calls.length,0);
  const cloudBefore={meta:{etag:'"real"',revision:'4'},payload:await f.payload({signedIn:1})};f.setCloud(cloudBefore);
  const bySlot=new Map();const createOutbox=scope=>{
    if(scope.slot===f.scope.slot)return f.open({scope});
    if(!bySlot.has(scope.slot))bySlot.set(scope.slot,{value:null});
    const target=bySlot.get(scope.slot);
    return f.open({scope,remote:{read:async()=>target.value,write:async op=>{const meta={etag:'"import"',revision:'1'};target.value={meta,payload:op.payload};return meta;}}});
  };
  const imported=await f.importAnonymousSave({store:f.store,scope:f.scope,createOutbox});
  assert.match(imported.slot,/^recovery-anon-/);assert.deepEqual(f.cloud(),cloudBefore);
  assert.equal((await anon.read()).payload.sha256,(await f.payload({guest:1})).sha256);
});
test('large snapshots retain their full bytes and the local idempotency contract rejects changed replays',async t=>{
  const f=await fixture(t),box=f.open();const view=await box.read(),payload=await f.payload({text:'中'.repeat(50000)}),operation=id();
  const result=await box.write({payload,expectedEtag:view.etag,idempotencyKey:operation});
  assert.deepEqual(await box.write({payload,expectedEtag:view.etag,idempotencyKey:operation}),result);
  await assert.rejects(box.write({payload:await f.payload({text:'different'}),expectedEtag:view.etag,idempotencyKey:operation}),{code:'SAVE_IDEMPOTENCY_CONFLICT'});
  box.close();const restored=await f.open({store:await f.reopen()}).read();assert.equal(restored.payload.body,payload.body);
});

test('a killed writer leaves the last committed SQLite snapshot recoverable',async t=>{
  const f=await fixture(t),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
  const storeUrl=pathToFileURL(path.resolve(__dirname,'../../packages/save-cache/src/sqlite-store.mjs')).href;
  const outboxUrl=pathToFileURL(path.resolve(__dirname,'../../packages/save-cache/src/outbox.mjs')).href;
  const code="const {createSqliteSaveStore}=await import("+JSON.stringify(storeUrl)+");const {createSaveOutbox,snapshotPayload}=await import("+JSON.stringify(outboxUrl)+");"+
    "const store=await createSqliteSaveStore({root:"+JSON.stringify(f.root)+"});const b=createSaveOutbox({store,scope:"+JSON.stringify(f.scope)+",remote:{read:async()=>null}});"+
    "const v=await b.read();await b.write({payload:await snapshotPayload({bytes:new TextEncoder().encode('{\"crash\":true}'),schemaVersion:1,contentType:'application/json'}),expectedEtag:v.etag,idempotencyKey:crypto.randomUUID()});process.stdout.write('committed');setInterval(()=>{},1000);";
  const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  t.after(()=>child.kill());
  const exited=new Promise(resolve=>child.once('exit',resolve));
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('writer timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});child.once('error',reject);});
  child.kill();await exited;
  const restored=await f.open({store:await f.reopen()}).read();assert.equal(JSON.parse(Buffer.from(restored.payload.body,'base64')).crash,true);
});
test('a delayed cloud read cannot roll back a newer acknowledged local revision',async t=>{
  const f=await fixture(t),a=f.open();let view=await a.read();
  await a.write({payload:await f.payload({step:1}),expectedEtag:view.etag,idempotencyKey:id()});await a.sync();
  let finish,started;const ready=new Promise(r=>started=r),old=structuredClone(f.cloud());
  const b=f.open({remote:{...f.remote,read:async()=>{started();await new Promise(r=>finish=r);return old;}}});
  const reading=b.read();await ready;view=await a.read({refresh:false});
  await a.write({payload:await f.payload({step:2}),expectedEtag:view.etag,idempotencyKey:id()});await a.sync();finish();
  assert.equal(JSON.parse(Buffer.from((await reading).payload.body,'base64')).step,2);
});
test('automatic sync coalesces frequent writes for a minute while explicit sync may flush immediately',async t=>{
  const f=await fixture(t),a=f.open();let view=await a.read();
  view=await a.write({payload:await f.payload({step:1}),expectedEtag:view.etag,idempotencyKey:id()});await a.sync({force:false});
  await a.write({payload:await f.payload({step:2}),expectedEtag:view.etag,idempotencyKey:id()});await a.sync({force:false});
  assert.equal(f.calls.length,1);f.tick();await a.sync({force:false});assert.equal(f.calls.length,2);
});

test('a persisted authorization failure requires online revalidation before a reopened cache is readable',async t=>{
  const f=await fixture(t),box=f.open();let v=await box.read();
  await box.write({payload:await f.payload({secret:1}),expectedEtag:v.etag,idempotencyKey:id()});
  const revoked=f.open({remote:{...f.remote,write:async()=>{throw Object.assign(Error('revoked'),{code:'AUTH_REQUIRED'});}}});
  assert.equal((await revoked.sync()).state,'blocked');revoked.close();f.offline(true);
  const restarted=f.open();await assert.rejects(restarted.read(),{code:'NETWORK_ERROR'});
  f.offline(false);assert.equal((await restarted.read()).payload.sha256,(await f.payload({secret:1})).sha256);
  assert.equal((await restarted.sync()).state,'cloud');
});

test('management restore preserves old progress and the immutable lost-ACK operation across restart',async t=>{
  const f=await fixture(t),box=f.open();let v=await box.read();
  v=await box.write({payload:await f.payload({step:1}),expectedEtag:v.etag,idempotencyKey:id()});f.loseAck();await box.sync();
  const first=structuredClone((await f.store.read(f.scope)).value.inFlight);
  const input={payload:await f.payload({step:9}),expectedEtag:v.etag,idempotencyKey:id()};
  const restored=await box.restore(input);assert.equal(restored.durability,'local');
  assert.deepEqual((await f.store.read(f.scope)).value.inFlight,first);
  assert.equal(JSON.parse(Buffer.from((await box.recovery((await box.recoveries())[0].id)).payload.body,'base64')).step,1);
  assert.deepEqual(await box.restore(input),restored);
  box.close();const reopened=f.open({store:await f.reopen()});await reopened.sync();
  assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.cloud().meta.revision,'2');
  assert.equal(JSON.parse(Buffer.from(f.cloud().payload.body,'base64')).step,9);
});
test('management export/preview rejects tampering, cross-game imports, stale snapshots and changed identity',async t=>{
  const f=await fixture(t),box=f.open(),{createSaveManagement}=await import('../../packages/platform-client/src/save-management.mjs');
  let active=true;const manager=createSaveManagement({store:f.store,groupScope:f.scope,createBox:()=>box,assertOpen:async()=>{if(!active)throw Object.assign(Error('changed'),{code:'BRIDGE_ACCOUNT_CHANGED'});}});
  const resource={namespace:f.scope.namespace,slot:f.scope.slot};let v=await box.read();
  v=await box.write({payload:await f.payload({wood:4}),expectedEtag:v.etag,idempotencyKey:id()});
  const text=await manager.exportSave(resource),doc=JSON.parse(text);
  assert.equal(doc.workId,f.scope.workId);assert.equal(text.includes(f.scope.owner),false);assert.equal(text.includes(f.scope.origin),false);
  assert.equal((await manager.list())[0].bytes,doc.payload.bytes);
  for(const change of [{workId:id()},{channel:'preview'},{namespace:'other'},{payload:{...doc.payload,sha256:'0'.repeat(64)}},{payload:{...doc.payload,sha256:undefined}}])
    await assert.rejects(manager.prepareRestore(JSON.stringify({...doc,...change}),resource),{code:'SAVE_CONTENT_INVALID'});
  await assert.rejects(manager.prepareRestore(text,{...resource,owner:'user:'+id()}));
  const plan=await manager.prepareRestore(text,resource);
  await box.write({payload:await f.payload({wood:5}),expectedEtag:v.etag,idempotencyKey:id()});
  await assert.rejects(manager.restore(plan.token),{code:'SAVE_LOCAL_CONFLICT'});assert.equal((await box.recoveries()).length,0);
  active=false;await assert.rejects(manager.exportSave(resource),{code:'BRIDGE_ACCOUNT_CHANGED'});
});
test('full recovery budget blocks restore atomically until one exact exported copy is removed',async t=>{
  const f=await fixture(t),box=f.open();let v=await box.read();
  v=await box.write({payload:await f.payload({step:0}),expectedEtag:v.etag,idempotencyKey:id()});
  for(let step=1;step<=3;step++)v=await box.restore({payload:await f.payload({step}),expectedEtag:v.etag,idempotencyKey:id()});
  const before=structuredClone((await f.store.read(f.scope)).value);
  const input={payload:await f.payload({step:4}),expectedEtag:v.etag,idempotencyKey:id()};
  await assert.rejects(box.restore(input),{code:'SAVE_RECOVERY_QUOTA_EXCEEDED'});
  assert.deepEqual((await f.store.read(f.scope)).value,before);
  const copy=(await box.recoveries())[0];await assert.rejects(box.removeRecovery({recoveryId:copy.id,sha256:'wrong'}),{code:'SAVE_LOCAL_CONFLICT'});
  await box.removeRecovery({recoveryId:copy.id,sha256:copy.sha256});await box.restore(input);
  assert.equal((await box.recoveries()).length,3);assert.equal(JSON.parse(Buffer.from((await box.read()).payload.body,'base64')).step,4);
});
test('a recovery-slot export can be explicitly restored into autosave while retaining the source',async t=>{
  const f=await fixture(t),{createSaveManagement}=await import('../../packages/platform-client/src/save-management.mjs');
  const owner='anonymous:'+await f.store.anonymousId(),group={...f.scope,owner};
  const boxes=new Map();const createBox=scope=>{if(!boxes.has(scope.slot))boxes.set(scope.slot,f.open({scope}));return boxes.get(scope.slot);};
  const source=createBox({...group,slot:'recovery-anon-example'}),sv=await source.read();
  await source.write({payload:await f.payload({guest:8}),expectedEtag:sv.etag,idempotencyKey:id()});
  const manager=createSaveManagement({store:f.store,groupScope:group,createBox,assertOpen:async()=>{}});
  const text=await manager.exportSave({namespace:'default',slot:'recovery-anon-example'});
  const plan=await manager.prepareRestore(text,{namespace:'default',slot:'autosave'});await manager.restore(plan.token);
  const current=await createBox(group).read();assert.equal(JSON.parse(Buffer.from(current.payload.body,'base64')).guest,8);
  assert.equal((await source.read()).payload.sha256,current.payload.sha256);assert.equal(f.calls.length,0);
});
test('management restore cannot silently clear an existing cloud conflict',async t=>{
  const f=await fixture(t),box=f.open(),v=await box.read();
  const saved=await box.write({payload:await f.payload({step:1}),expectedEtag:v.etag,idempotencyKey:id()});
  f.setCloud({meta:{etag:'"newer-cloud"',revision:'3'},payload:await f.payload({step:2})});await box.sync();
  const before=structuredClone((await f.store.read(f.scope)).value);
  await assert.rejects(box.restore({payload:await f.payload({step:9}),expectedEtag:saved.etag,idempotencyKey:id()}),{code:'SAVE_COMPARE_REQUIRED'});
  assert.deepEqual((await f.store.read(f.scope)).value,before);
});
