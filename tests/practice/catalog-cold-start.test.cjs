const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const {runtimeDirectory,verifyRuntime}=require('../../question-engine/math-v143/install.cjs');

test('compact catalog exactly matches all verified frozen cells, scopes and stock capacities',()=>{
 verifyRuntime();
 const {catalog}=require(path.join(runtimeDirectory,'src/lab-catalog-v2.cjs'));
 const stock=require(path.join(runtimeDirectory,'src/capacity-v9.cjs'));
 const expected=catalog.map(({id,topicCode,title,difficulty,scopes})=>({id,topicCode,title,difficulty,
  scopes:scopes.map(scope=>{const row=stock.row(id,scope.id);return {...scope,capacity:row?.entries.length??0,
   samplingMode:row?'finite-stock-index':'parameter-seed'};})}));
 assert.deepEqual(require('../../question-engine/math-v143/runtime.cjs').catalog().cells,expected);
});

test('cold HTTP catalog works with a small heap without importing question inventories',()=>{
 const result=spawnSync(process.execPath,['--max-old-space-size=48','--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {createRequire} from 'node:module';
  import {createVerifiedMathEngine} from './apps/api/src/practice/engine.mjs';
  import {createPracticeService} from './apps/api/src/practice/service.mjs';
  import {registerPracticeRoutes} from './apps/api/src/practice/routes.mjs';
  const require=createRequire(new URL('./apps/api/package.json',import.meta.url));
  const app=require('fastify')({logger:false});
  registerPracticeRoutes(app,{service:createPracticeService({engine:createVerifiedMathEngine()}),requireAuth:async()=>{}});
  await app.listen({host:'127.0.0.1',port:0});
  try{
   const url='http://127.0.0.1:'+app.server.address().port+'/v1/learning/practice/catalog';
   const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
   assert.equal(response.status,200);const {data}=await response.json();
   assert.equal(data.ready,true);assert.equal(data.topics.length,12);
   assert.ok(data.topics.every(topic=>topic.difficultyIds.length>0));
   assert.ok(!Object.keys(require.cache).some(file=>file.includes('capacity-v9.cjs')));
   console.log(JSON.stringify({topics:data.topics.length,ready:data.ready,memory:process.memoryUsage()}));
  }finally{await app.close();}
 `],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/"topics":12/);
});

test('tampered summary and runtime manifest remain rejected without changing installed files',()=>{
 for(const target of ['catalog-summary.json','RELEASE-FILES.sha256']){
  const result=spawnSync(process.execPath,['-e',`
   const fs=require('node:fs'),assert=require('node:assert/strict'),original=fs.readFileSync;
   fs.readFileSync=function(file,...args){
    const bytes=original.call(this,file,...args);
    return String(file).endsWith(${JSON.stringify(target)})?Buffer.from('tampered'):bytes;
   };
   assert.throws(()=>require('./question-engine/math-v143/runtime.cjs').catalog(),/digest_mismatch/);
  `],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stdout+result.stderr);
 }
});
