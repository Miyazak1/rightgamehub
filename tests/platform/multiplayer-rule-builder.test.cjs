const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { makeZip } = require('../../scripts/zip-fixture.cjs');

const root=path.resolve(__dirname,'../..');
const moduleUrl=name=>pathToFileURL(path.join(root,'apps/api/src',name));
const template=path.join(root,'templates/multiplayer-turn-based');
const names=['platform.json','index.html','creator-submission.json','rules/adapter.cjs','rules/tests.json'];

async function fixture(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-rule-builder-test-'));const entries=await Promise.all(names.map(async name=>({name,data:await fs.readFile(path.join(template,...name.split('/')))})));const bytes=makeZip(entries);const inputPath=path.join(directory,'source.zip');await fs.writeFile(inputPath,bytes);return {directory,inputPath,bytes,entries};}

test('controlled Rule Builder emits the reviewed single-file adapter deterministically', async t=>{
  const item=await fixture();t.after(()=>fs.rm(item.directory,{recursive:true,force:true}));const {buildRuleSourceBundle}=await import(moduleUrl('rule-source-builder.mjs'));const outputPath=path.join(item.directory,'adapter.cjs');const sourceSha256=crypto.createHash('sha256').update(item.bytes).digest('hex');
  const report=await buildRuleSourceBundle({inputPath:item.inputPath,outputPath,plan:{templateKey:'rules-cjs-v1',templateVersion:'1',workId:'sample-work',modeKey:'duel',rulesetVersion:'1.0.0',sourceSha256}});
  const expected=item.entries.find(entry=>entry.name==='rules/adapter.cjs').data;const actual=await fs.readFile(outputPath);assert.deepEqual(actual,expected);assert.equal(report.bundleSha256,crypto.createHash('sha256').update(expected).digest('hex'));assert.equal(report.sourceSha256,sourceSha256);assert.equal(report.doctorSummary.errors,0);
});

test('controlled Rule Builder rejects changed source and approved identity mismatches', async t=>{
  const item=await fixture();t.after(()=>fs.rm(item.directory,{recursive:true,force:true}));const {buildRuleSourceBundle}=await import(moduleUrl('rule-source-builder.mjs'));const sourceSha256=crypto.createHash('sha256').update(item.bytes).digest('hex');
  await assert.rejects(()=>buildRuleSourceBundle({inputPath:item.inputPath,outputPath:path.join(item.directory,'bad.cjs'),plan:{templateKey:'rules-cjs-v1',templateVersion:'1',workId:'other-work',modeKey:'duel',rulesetVersion:'1.0.0',sourceSha256}}),error=>error.code==='RULE_BUILD_IDENTITY_MISMATCH');
  await assert.rejects(()=>buildRuleSourceBundle({inputPath:item.inputPath,outputPath:path.join(item.directory,'changed.cjs'),plan:{templateKey:'rules-cjs-v1',templateVersion:'1',workId:'sample-work',modeKey:'duel',rulesetVersion:'1.0.0',sourceSha256:'a'.repeat(64)}}),error=>error.code==='RULE_BUILD_SOURCE_DIGEST_MISMATCH');
});

test('isolated Rule Builder mailbox returns an integrity-checked bundle',async t=>{
  const item=await fixture();t.after(()=>fs.rm(item.directory,{recursive:true,force:true}));const builderRoot=path.join(item.directory,'builder');const service=spawn(process.execPath,[path.join(root,'apps/api/src/rule-builder-service.mjs')],{env:{...process.env,RULE_BUILDER_ROOT:builderRoot},stdio:['ignore','pipe','pipe']});t.after(()=>service.kill());
  const ready=path.join(builderRoot,'service.ready');for(let index=0;index<100;index+=1){try{await fs.stat(ready);break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
  const sourceSha256=crypto.createHash('sha256').update(item.bytes).digest('hex');const {createRuleBuildRunner}=await import(moduleUrl('rule-build-runner.mjs'));const result=await createRuleBuildRunner({mode:'isolated',builderRoot}).run({inputPath:item.inputPath,plan:{templateKey:'rules-cjs-v1',templateVersion:'1',workId:'sample-work',modeKey:'duel',rulesetVersion:'1.0.0',sourceSha256}});
  assert.equal((await fs.stat(result.outputPath)).size,result.report.bundleBytes);assert.equal(crypto.createHash('sha256').update(await fs.readFile(result.outputPath)).digest('hex'),result.report.bundleSha256);await result.cleanup();
});

test('rule build worker verifies source and stored output around the isolated runner', async t=>{
  const item=await fixture();t.after(()=>fs.rm(item.directory,{recursive:true,force:true}));const sourceSha256=crypto.createHash('sha256').update(item.bytes).digest('hex');const sourceObject='quarantine/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.zip';const sourceFile=path.join(item.directory,'source.zip');let finished;
  const {createMultiplayerRuleBuildWorker}=await import(moduleUrl('multiplayer-rule-build-worker.mjs'));const adapter=item.entries.find(entry=>entry.name==='rules/adapter.cjs').data;const adapterSha=crypto.createHash('sha256').update(adapter).digest('hex');
  const repository={claimNext:async()=>({id:crypto.randomUUID(),jobId:crypto.randomUUID(),leaseToken:crypto.randomUUID(),workId:'sample-work',modeKey:'duel',rulesetVersion:'1.0.0',sourceSha256,sourceObjectKey:sourceObject,builderImageDigest:'development-unpinned'}),renewLease:async()=>true,markBuilding:async()=>{},finish:async input=>{finished=input;return {state:'ready'};},fail:async()=>assert.fail('build must not fail')};
  const quarantineStore={pathFor:key=>key===sourceObject?sourceFile:path.join(item.directory,'artifact.bin'),putStream:async(_key,stream)=>{const chunks=[];for await(const chunk of stream)chunks.push(chunk);const value=Buffer.concat(chunks);return {bytes:value.length,sha256:crypto.createHash('sha256').update(value).digest('hex')};},remove:async()=>{}};
  const worker=createMultiplayerRuleBuildWorker({repository,quarantineStore,workingRoot:path.join(item.directory,'working'),builderImageDigest:'development-unpinned',buildRunner:{run:async()=>({outputPath:await (async()=>{const file=path.join(item.directory,'output.cjs');await fs.writeFile(file,adapter);return file;})(),report:{bundleBytes:adapter.length,bundleSha256:adapterSha},cleanup:async()=>{}})}});
  assert.equal((await worker.runOnce()).state,'ready');assert.equal(finished.report.bundleSha256,adapterSha);assert.match(finished.objectKey,/^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/u);
});
