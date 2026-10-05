const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const transfer=()=>import('../../packages/web-game-sdk/src/transfer.mjs');

test('16 KiB chunks fit the 32 KiB JSON envelope and full transfers preserve bytes and digest',async()=>{
  const {createGameTransfer,encodeChunk,sha256Hex,GAME_TRANSFER_CHUNK_BYTES}=await transfer();
  const {parseBridgeRequest,bridgeEnvelope}=await import('../../packages/web-game-sdk/src/protocol.mjs');
  const bytes=new Uint8Array(256*1024);crypto.randomFillSync(bytes);
  const store=createGameTransfer();const begin=store.begin('save',{totalBytes:bytes.length,sha256:await sha256Hex(bytes)});
  for(let index=0;index<16;index++){
    const chunk=encodeChunk(bytes.subarray(index*GAME_TRANSFER_CHUNK_BYTES,(index+1)*GAME_TRANSFER_CHUNK_BYTES));
    const params={transferId:begin.transferId,index,chunk};
    parseBridgeRequest(bridgeEnvelope({type:'request',id:crypto.randomUUID(),method:'cloudSave.transfer.append',params}));
    store.append('save',params);store.append('save',params);
  }
  const result=await store.commit('save',begin);assert.deepEqual(result.bytes,bytes);
  const read=await store.openRead('save',bytes);
  const decoded=[];
  for(let index=0;index<16;index++){const chunk=store.read('save',{transferId:read.transferId,index});decoded.push(Buffer.from(chunk.chunk,'base64'));}
  assert.deepEqual(Buffer.concat(decoded),Buffer.from(bytes));
  store.abort('save',read);store.close();
});
test('transfer rejects cross-domain, parallel, reordered, changed duplicate and digest mismatch inputs',async()=>{
  const {createGameTransfer,encodeChunk,sha256Hex}=await transfer();
  const store=createGameTransfer(); const bytes=new Uint8Array([1,2,3]);
  const meta={totalBytes:3,sha256:await sha256Hex(bytes)};const b=store.begin('save',meta);
  assert.throws(()=>store.begin('competition',meta),{code:'TRANSFER_BUSY'});
  assert.throws(()=>store.append('competition',{...b,index:0,chunk:encodeChunk(bytes)}),{code:'TRANSFER_EXPIRED'});
  assert.throws(()=>store.append('save',{...b,index:1,chunk:encodeChunk(bytes)}),{code:'TRANSFER_ORDER_INVALID'});
  await assert.rejects(store.commit('save',b),{code:'TRANSFER_INCOMPLETE'});
  store.append('save',{...b,index:0,chunk:encodeChunk(bytes)});
  assert.throws(()=>store.append('save',{...b,index:0,chunk:encodeChunk(new Uint8Array([3,2,1]))}),{code:'TRANSFER_REPLAY_MISMATCH'});
  store.abort('competition',b);await store.commit('save',b);
  const bad=store.begin('save',{...meta,sha256:'0'.repeat(64)});store.append('save',{...bad,index:0,chunk:encodeChunk(bytes)});
  await assert.rejects(store.commit('save',bad),{code:'TRANSFER_DIGEST_MISMATCH'});store.close();
});
test('transfer expiry and abort during async commit never resurrect payloads',async()=>{
  const {createGameTransfer,encodeChunk,GAME_TRANSFER_TTL_MS}=await transfer();
  let now=0,finish;const store=createGameTransfer({clock:()=>now,digest:()=>new Promise(resolve=>finish=resolve)});
  const b=store.begin('save',{totalBytes:1,sha256:'a'.repeat(64)});
  store.append('save',{...b,index:0,chunk:encodeChunk(new Uint8Array([1]))});
  const committing=store.commit('save',b);store.abort('save',b);finish('a'.repeat(64));
  await assert.rejects(committing,{code:'TRANSFER_EXPIRED'});
  const next=store.begin('competition',{totalBytes:1,sha256:'a'.repeat(64)});now+=GAME_TRANSFER_TTL_MS;
  assert.throws(()=>store.append('competition',{...next,index:0,chunk:'AQ=='}),{code:'TRANSFER_EXPIRED'});store.close();
});
test('malformed Base64, padding bits, oversized chunks and unsupported compression fail before allocation',async()=>{
  const {decodeChunk,createGameTransfer}=await transfer();
  for(const value of ['!','A===','AR==','AA==\n','A'.repeat(23000)])assert.throws(()=>decodeChunk(value),{code:'TRANSFER_CHUNK_INVALID'});
  const store=createGameTransfer();
  assert.throws(()=>store.begin('save',{totalBytes:262145,sha256:'a'.repeat(64)}),{code:'TRANSFER_INVALID'});
  assert.throws(()=>store.begin('save',{totalBytes:1,sha256:'a'.repeat(64),encoding:'gzip'}),{code:'TRANSFER_INVALID'});
});

test('reservations and retained commits keep a single transfer across service domains',async()=>{
  const {createGameTransfer,sha256Hex}=await transfer();
  const store=createGameTransfer(),empty=new Uint8Array(0),digest=await sha256Hex(empty);
  const reserved=store.reserve('save');
  assert.throws(()=>store.begin('competition',{totalBytes:0,sha256:digest}),{code:'TRANSFER_BUSY'});
  await assert.rejects(store.openRead('competition',empty,'application/octet-stream',{reservationId:reserved.transferId}),{code:'TRANSFER_EXPIRED'});
  const read=await store.openRead('save',empty,'application/octet-stream',{reservationId:reserved.transferId});
  assert.equal(read.totalBytes,0);assert.equal(read.sha256,digest);store.abort('save',read);
  const upload=store.begin('save',{totalBytes:0,sha256:digest});
  assert.deepEqual((await store.commit('save',{transferId:upload.transferId,retain:true})).bytes,empty);
  assert.throws(()=>store.begin('competition',{totalBytes:0,sha256:digest}),{code:'TRANSFER_BUSY'});
  store.abort('save',upload);
  store.begin('competition',{totalBytes:0,sha256:digest});store.close();
});
