const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const { pathToFileURL }=require('node:url');
const root=path.resolve(__dirname,'../..');
const moduleUrl=file=>pathToFileURL(path.join(root,'apps/api/src',file));

test('source build service normalizes and idempotently queues a pinned static build',async()=>{
  const { createSourceBuildService }=await import(moduleUrl('source-build-service.mjs'));
  const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
  let received;
  const service=createSourceBuildService({ enabled:true,builderImageDigest:'sha256:'+'a'.repeat(64),ids:()=>ids.shift(),repository:{ create:async input=>(received=input,{ id:input.buildId,state:'queued' }) } });
  const actor={ userId:crypto.randomUUID(),scopes:['works:write'],profile:{ canPublish:true } };
  const workId=crypto.randomUUID();
  const result=await service.create(actor,workId,{ templateKey:'static-v1',releaseLabel:'1.0.0',subdirectory:'game' },'i'.repeat(16));
  assert.equal(result.state,'queued');
  assert.equal(received.plan.subdirectory,'game');
  assert.equal(received.plan.buildCommand,null);
  assert.match(received.plan.configSha256,/^[a-f0-9]{64}$/);
  assert.match(received.requestHash,/^[a-f0-9]{64}$/);
  assert.equal(received.releaseLabel,'1.0.0');
});

test('source build worker moves an immutable GitHub archive into validation quarantine',async t=>{
  const { createSourceBuildWorker }=await import(moduleUrl('source-build-worker.mjs'));
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-source-flow-'));
  t.after(()=>fs.rm(directory,{ recursive:true,force:true }));
  const artifact=Buffer.from('web-zip-artifact');
  const digest=crypto.createHash('sha256').update(artifact).digest('hex');
  const calls=[];
  const claim={ id:crypto.randomUUID(),jobId:crypto.randomUUID(),leaseToken:crypto.randomUUID(),installationId:'12',owner:'owner',name:'repo',commitSha:'a'.repeat(40),builderImageDigest:'sha256:'+'a'.repeat(64),config:{ templateKey:'static-v1',templateVersion:'1' } };
  let counter=0;
  const worker=createSourceBuildWorker({
    repository:{ claimNext:async()=>claim,markBuilding:async()=>calls.push('building'),renewLease:async()=>true,beginArtifact:async input=>calls.push(['begin',input.uploadId]),finishArtifact:async input=>calls.push(['finish',input.uploadId]),fail:async()=>calls.push('failed') },
    githubClient:{ downloadRepositoryArchive:async(...args)=>(calls.push(['download',...args.slice(0,4)]),Buffer.from('source')) },
    buildRunner:{ run:async({ inputPath,onHeartbeat })=>{ assert.equal((await fs.readFile(inputPath)).toString(),'source'); assert.equal(await onHeartbeat(),true); const outputPath=path.join(directory,'artifact.zip'); await fs.writeFile(outputPath,artifact); return { outputPath,report:{ artifactBytes:artifact.length,artifactSha256:digest },cleanup:async()=>{} }; } },
    quarantineStore:{ putStream:async(_key,stream)=>{ const chunks=[]; for await(const chunk of stream)chunks.push(chunk); const bytes=Buffer.concat(chunks); return { bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex') }; },remove:async()=>{} },
    storageCapacityService:{ assertCanAccept:async input=>calls.push(['capacity',input.declaredBytes]) },uploadRepository:{ globalCapacityReservations:async()=>({ quarantine:0,validator:0,runtime:0 }) },
    workingRoot:path.join(directory,'working'),builderImageDigest:'sha256:'+'a'.repeat(64),ids:()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`,
  });
  const result=await worker.runOnce();
  assert.equal(result.state,'validating');
  assert.equal(result.artifactSha256,digest);
  assert.deepEqual(calls.filter(item=>Array.isArray(item)).map(item=>item[0]),['download','capacity','begin','finish']);
  assert.ok(calls.includes('building'));
  assert.ok(!calls.includes('failed'));
});

test('source build API requires creator auth and returns an accepted job',async t=>{
  const { createApp }=await import(moduleUrl('app.mjs'));
  const actor={ userId:crypto.randomUUID(),scopes:['works:write'],profile:{ canPublish:true } };
  let received;
  const app=createApp({ config:{ requestBodyLimit:65536,corsOrigins:[] },database:{ ping:async()=>true },migrations:{ status:async()=>({ ready:true }) },authService:{ authenticateBearer:async()=>actor },sourceBuildService:{
    create:async(...args)=>(received=args,{ id:crypto.randomUUID(),state:'queued' }),list:async()=>[],get:async()=>({ id:crypto.randomUUID(),state:'ready' }),publish:async()=>({ id:crypto.randomUUID(),state:'ready' }),
  } });
  t.after(()=>app.close());
  const workId=crypto.randomUUID();
  const response=await app.inject({ method:'POST',url:`/v1/creator/works/${workId}/builds`,headers:{ authorization:'Bearer token','idempotency-key':'i'.repeat(16) },payload:{ templateKey:'static-v1',releaseLabel:'1.0.0' } });
  assert.equal(response.statusCode,202);
  assert.equal(received[0],actor);
  assert.equal(received[1],workId);
  assert.equal(received[3],'i'.repeat(16));
  assert.equal(response.headers['cache-control'],'no-store');
});

test('source build worker rejects a queue item recorded for another builder image',async t=>{
  const { createSourceBuildWorker }=await import(moduleUrl('source-build-worker.mjs'));
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-source-image-'));
  t.after(()=>fs.rm(directory,{ recursive:true,force:true }));
  let failure; let downloaded=false;
  const claim={ id:crypto.randomUUID(),jobId:crypto.randomUUID(),leaseToken:crypto.randomUUID(),builderImageDigest:'sha256:'+'b'.repeat(64) };
  const worker=createSourceBuildWorker({ enabled:true,builderImageDigest:'sha256:'+'a'.repeat(64),workingRoot:directory,ids:()=>crypto.randomUUID(),repository:{ claimNext:async()=>claim,fail:async input=>{ failure=input.errorCode; } },githubClient:{ downloadRepositoryArchive:async()=>{ downloaded=true; } },buildRunner:{},quarantineStore:{},storageCapacityService:{},uploadRepository:{} });
  await assert.rejects(worker.runOnce(),error=>error.code==='BUILDER_IMAGE_CHANGED');
  assert.equal(failure,'BUILDER_IMAGE_CHANGED');
  assert.equal(downloaded,false);
});
