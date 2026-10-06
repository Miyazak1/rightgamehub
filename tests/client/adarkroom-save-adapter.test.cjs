const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
let createAdrSaveAdapter, stateApi;
test.before(async () => {
  require('node:child_process').execFileSync(process.execPath,['scripts/build-adarkroom.mjs'],{cwd:require('node:path').resolve(__dirname,'../..')});
  ({createAdrSaveAdapter} = await import('../../samples/adarkroom/save-adapter.mjs'));
  stateApi = await import('../../samples/adarkroom/state.mjs');
});
const state = wood => ({version:1.3,stores:{wood}});
const error = (code, retryable = false) => Object.assign(new Error(code),{code,retryable});
function harness(initial = null) {
  let now = 100000, sequence = 0, current = initial, writeImpl;
  const writes = [], statuses = [], replacements = [], timers = new Map();
  const cloudSave = {
    read:async()=>current,
    write:input=>{
      writes.push(JSON.parse(JSON.stringify(input)));
      if (writeImpl) return writeImpl(input);
      current = {etag:'"'+writes.length+'"',revision:String(writes.length),data:input.data};
      return Promise.resolve(current);
    }
  };
  const adapter = createAdrSaveAdapter({cloudSave,clock:()=>now,id:()=>String(++sequence),
    schedule:(fn,delay)=>{const key={};timers.set(key,{fn,delay});return key;},cancel:key=>timers.delete(key),
    onStatus:s=>statuses.push(s),onReplace:(...args)=>replacements.push(args)});
  return {adapter,writes,statuses,replacements,timers,cloudSave,
    setCurrent:v=>{current=v;},setWrite:fn=>{writeImpl=fn;},advance:ms=>{now+=ms;}};
}
const doc = value => ({etag:'"old"',revision:'9',data:{schemaVersion:1,upstreamVersion:'1.4',upstreamCommit:stateApi.UPSTREAM_COMMIT,state:value}});
test('first load creates no write; repeated ticks coalesce without moving the deadline',async()=>{
  const h=harness();assert.deepEqual(await h.adapter.load(),{version:1.3});
  assert.equal(h.writes.length,0);h.adapter.queue(state(1));
  const timer=[...h.timers.keys()][0];
  for(let n=2;n<50;n++)h.adapter.queue(state(n));
  assert.equal(h.timers.size,1);assert.equal([...h.timers.keys()][0],timer);
  await h.adapter.saveNow();assert.equal(h.writes.length,1);assert.equal(h.writes[0].data.state.stores.wood,49);
  assert.equal(h.writes[0].createOnly,true);assert.equal(h.statuses.at(-1).state,'cloud');
  h.advance(1000);h.adapter.queue(state(50));
  assert.equal([...h.timers.values()][0].delay,59000);
  await h.adapter.saveNow();assert.equal(h.writes[1].expectedEtag,'"1"');
});
test('lost acknowledgement retries identical bytes, CAS and key before newer progress',async()=>{
  const h=harness(doc(state(1)));await h.adapter.load();
  h.setWrite(()=>Promise.reject(error('REQUEST_TIMEOUT',true)));
  h.adapter.queue(state(2));await assert.rejects(h.adapter.saveNow(),{code:'REQUEST_TIMEOUT'});
  h.adapter.queue(state(3));assert.equal(h.statuses.at(-1).state,'unconfirmed');assert.equal(h.timers.size,0);
  await assert.rejects(h.adapter.saveNow(),{code:'REQUEST_TIMEOUT'});assert.equal(h.writes.length,1);
  h.setWrite(input=>Promise.resolve({etag:'"2"',revision:'10',data:input.data}));
  await h.adapter.retry();assert.deepEqual(h.writes[0],h.writes[1]);assert.equal(h.statuses.at(-1).state,'pending');
  await h.adapter.saveNow();assert.equal(h.writes[2].expectedEtag,'"2"');assert.notEqual(h.writes[2].idempotencyKey,h.writes[0].idempotencyKey);
  assert.equal(h.writes[2].data.state.stores.wood,3);
});
test('synchronous transport failure is retryable without leaving a stuck busy promise',async()=>{
  const h=harness();await h.adapter.load();h.adapter.queue(state(2));
  h.setWrite(()=>{throw error('REQUEST_TIMEOUT',true);});
  await assert.rejects(h.adapter.saveNow());
  h.setWrite(input=>({etag:'"ok"',revision:'1',data:input.data}));
  await h.adapter.retry();assert.equal(h.writes.length,2);assert.equal(h.statuses.at(-1).state,'cloud');
});
test('concurrent clicks share one write and acknowledgement does not discard newer game ticks',async()=>{
  const h=harness();await h.adapter.load();h.adapter.queue(state(1));
  let finish;h.setWrite(()=>new Promise(resolve=>{finish=resolve;}));
  const p=h.adapter.saveNow(),q=h.adapter.saveNow();await Promise.resolve();
  h.adapter.queue(state(2));finish({etag:'"ack"',revision:'1'});await Promise.all([p,q]);
  assert.equal(h.writes.length,1);assert.equal(h.adapter.getStatus().pending,true);
});
test('conflict blocks automatic overwrite and requires explicit comparison before CAS retry',async()=>{
  const h=harness(doc(state(1)));await h.adapter.load();h.adapter.queue(state(2));
  h.setWrite(()=>Promise.reject(error('SAVE_CONFLICT')));
  await assert.rejects(h.adapter.saveNow(),{code:'SAVE_CONFLICT'});
  await assert.rejects(h.adapter.retry(),{code:'SAVE_CONFLICT'});
  assert.throws(()=>h.adapter.keepLocal(),{code:'ADR_COMPARE_REQUIRED'});assert.equal(h.timers.size,0);
  const newer={...doc(state(3)),etag:'"inspected"',revision:'11'};h.setCurrent(newer);
  assert.deepEqual(await h.adapter.compare(),{local:state(2),cloud:state(3),revision:'11',deleted:false});
  // Cloud moves again after comparison: even explicit choice must fail stale CAS.
  h.setWrite(input=>{assert.equal(input.expectedEtag,'"inspected"');throw error('SAVE_CONFLICT');});
  await assert.rejects(h.adapter.keepLocal(),{code:'SAVE_CONFLICT'});
  assert.equal(h.statuses.at(-1).state,'conflict');assert.equal(h.writes.length,2);
});
test('accepting cloud never writes the old page and closes its adapter',async()=>{
  const h=harness(doc(state(1)));await h.adapter.load();h.adapter.queue(state(2));
  h.setWrite(()=>{throw error('SAVE_CONFLICT');});await assert.rejects(h.adapter.saveNow());
  h.setCurrent(doc(state(3)));await h.adapter.compare();h.adapter.useCloud();
  assert.deepEqual(h.replacements,[[state(3),true]]);assert.equal(h.writes.length,1);
  assert.throws(()=>h.adapter.queue(state(4)),{code:'BRIDGE_CLOSED'});
});
test('keeping local when cloud already equals it clears the conflict without another revision',async()=>{
  const h=harness(doc(state(1)));await h.adapter.load();h.adapter.queue(state(2));
  h.setWrite(()=>{throw error('SAVE_CONFLICT');});await assert.rejects(h.adapter.saveNow());
  h.setCurrent(doc(state(2)));await h.adapter.compare();await h.adapter.keepLocal();
  assert.equal(h.writes.length,1);assert.equal(h.statuses.at(-1).state,'cloud');
});
test('failed and incompatible reads never fall back to a new game or write',async()=>{
  for(const bad of [{...doc(state(2)),data:{schemaVersion:999}},doc({version:99}),doc({version:1.3,stores:{wood:Infinity}})]) {
    const h=harness(bad);await assert.rejects(h.adapter.load());assert.equal(h.adapter.getStatus().loaded,false);
    h.adapter.queue(state(0));assert.equal(h.writes.length,0);
  }
  const h=harness();h.cloudSave.read=async()=>{throw error('REQUEST_TIMEOUT',true);};
  await assert.rejects(h.adapter.load());assert.equal(h.writes.length,0);
});
test('tombstone resumes empty state but writes using its existing ETag',async()=>{
  const h=harness({etag:'"deleted"',revision:'10',deleted:true,data:null});await h.adapter.load();h.adapter.queue(state(1));await h.adapter.saveNow();
  assert.equal(h.writes[0].expectedEtag,'"deleted"');assert.equal(h.writes[0].createOnly,undefined);
});
test('imports and restart replace the active state only after acknowledgement',async()=>{
  const h=harness(doc(state(8)));await h.adapter.load();
  assert.throws(()=>h.adapter.replace({version:9}),{code:'ADR_VERSION_UNSUPPORTED'});assert.equal(h.writes.length,0);
  let finish;h.setWrite(()=>new Promise(resolve=>{finish=resolve;}));
  const p=h.adapter.replace(state(0),{reload:false});await Promise.resolve();
  assert.equal(h.replacements.length,0);h.adapter.queue(state(99)); // old game ticks cannot overwrite replacement
  finish({etag:'"imported"',revision:'10'});await p;
  assert.deepEqual(h.replacements,[[state(0),false]]);assert.deepEqual(h.adapter.exportState(),state(0));
});
test('unconfirmed progress blocks import; closing account discards late ACK and prohibits retries',async()=>{
  const h=harness(doc(state(1)));await h.adapter.load();h.adapter.queue(state(2));
  assert.throws(()=>h.adapter.replace(state(3)),{code:'ADR_PENDING_OPERATION'});
  let finish;h.setWrite(()=>new Promise(resolve=>{finish=resolve;}));
  const p=h.adapter.saveNow();await Promise.resolve();h.adapter.close();finish({etag:'"late"',revision:'10'});
  await assert.rejects(p,{code:'BRIDGE_CLOSED'});await assert.rejects(h.adapter.retry(),{code:'BRIDGE_CLOSED'});
  assert.equal(h.statuses.some(s=>s.state==='cloud'),false);
});
test('state parser preserves original dotted/bracket paths while blocking code and prototype traversal',()=>{
  const s={};stateApi.setStatePath(s,'stores["cured meat"]',20);stateApi.setStatePath(s,"game.workers['coal miner']",2);
  assert.equal(stateApi.getStatePath(s,'stores["cured meat"]'),20);
  stateApi.removeStatePath(s,"game.workers['coal miner']");assert.equal(stateApi.getStatePath(s,"game.workers['coal miner']"),undefined);
  for(const p of ['__proto__.polluted','game.constructor.prototype.x','stores.x;process.exit()','stores["x\\\\y"]'])assert.throws(()=>stateApi.setStatePath(s,p,1),{code:'ADR_PATH_INVALID'});
  const shared={wood:1};assert.doesNotThrow(()=>stateApi.stateSnapshot({stores:shared,copy:shared}));
  const cycle={};cycle.self=cycle;assert.throws(()=>stateApi.stateSnapshot(cycle),{code:'ADR_SAVE_INVALID'});
  assert.throws(()=>stateApi.stateSnapshot(JSON.parse('{"__proto__":{"polluted":true}}')),{code:'ADR_SAVE_INVALID'});
  assert.throws(()=>stateApi.stateSnapshot({text:'x'.repeat(256*1024)}),{code:'ADR_SAVE_TOO_LARGE'});
});
test('patched real StateManager works without string code generation and round-trips all stage fixtures',async()=>{
  const source=await fs.readFile(new URL('../../.runtime/adarkroom-web/script/state_manager.js',require('node:url').pathToFileURL(__filename)),'utf8');
  for(const name of ['new','mid','pre-ending','observed/new','observed/mid','observed/pre-ending']){
    const input=JSON.parse(await fs.readFile(new URL('../../samples/adarkroom/fixtures/'+name+'.json',require('node:url').pathToFileURL(__filename)),'utf8'));
    let updates=0;
    const context={State:input,Engine:{saveGame:()=>{updates++;}},window:{GameHubADR:{get:stateApi.getStatePath,set:stateApi.setStatePath,remove:stateApi.removeStatePath}},console};
    vm.createContext(context,{codeGeneration:{strings:false,wasm:false}});vm.runInContext(source,context);context.$SM.fireUpdate=()=>{};
    context.$SM.set('stores["cured meat"]',41);assert.equal(context.$SM.get('stores["cured meat"]'),41);
    context.$SM.set('stores.wood',-1);assert.equal(context.$SM.get('stores.wood'),0);assert.equal(updates,2);
    const h=harness();await h.adapter.load();h.adapter.queue(input);await h.adapter.saveNow();
    const restored=harness({etag:'"saved"',revision:'1',data:h.writes[0].data});
    assert.deepEqual(await restored.adapter.load(),input);
  }
});
