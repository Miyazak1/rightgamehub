const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const url=process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
test('sharing uses real PostgreSQL sessions, quotas, immutable version identity, audit and expiry',{skip:!url,timeout:300000},async t=>{
 const f=await require('../game-share-fixture.cjs').createGameShareFixture(url);t.after(()=>f.close());const {pool,actors,shares}=f;
 const input={title:'Bingo 测试包',payload:{kind:'bingo-pack',schemaVersion:1,pack:{title:'游戏',cells:['A','B']}}};
 let session=await f.session(),headers={authorization:'Bearer '+actors.owner.userId,'x-gamehub-session':session.gameSessionId};
 const create=()=>shares.create(actors.owner,session.gameSessionId,input);
 await t.test('anonymous creation and missing session are rejected',async()=>{
   for(const h of [{},{authorization:headers.authorization}]){const r=await f.app.inject({method:'POST',url:'/v1/game-shares',headers:h,payload:input});assert.ok([400,401].includes(r.statusCode));}
   await assert.rejects(shares.create(null,session.gameSessionId,input),{code:'AUTH_REQUIRED'});
   await assert.rejects(shares.create(actors.other,session.gameSessionId,input),{code:'GAME_SESSION_INVALID'});
   const preview=await f.session(actors.owner,{channel:'preview'});await assert.rejects(shares.create(actors.owner,preview.gameSessionId,input),{code:'GAME_SESSION_INVALID'});await f.sessions.revoke(actors.owner,preview.gameSessionId);
 });
 let first;
 await t.test('only server-derived context is accepted; public responses contain no identity credentials',async()=>{
   const bad=await f.app.inject({method:'POST',url:'/v1/game-shares',headers,payload:{...input,workId:f.draftId}});assert.equal(bad.statusCode,400);
   const r=await f.app.inject({method:'POST',url:'/v1/game-shares',headers,payload:input});assert.equal(r.statusCode,201,r.body);first=r.json().data;assert.match(first.code,/^[A-Za-z0-9_-]{32}$/);assert.equal(first.url,'https://mooyu.fun/#/s/'+first.code);
   const read=await f.app.inject('/v1/game-shares/'+first.code);assert.equal(read.statusCode,200,read.body);assert.equal(read.headers['cache-control'],'no-store');assert.deepEqual(read.json().data.payload,input.payload);assert.equal(read.json().data.releaseId,f.releaseId);assert.doesNotMatch(read.body,/grantId|gameSessionId|userId|token_hash/);
   await assert.rejects(shares.get('bad'),{code:'SHARE_UNAVAILABLE'});await assert.rejects(shares.get('A'.repeat(32)),{code:'SHARE_UNAVAILABLE'});
   await assert.rejects(shares.create(actors.owner,session.gameSessionId,{...input,payload:{text:'x'.repeat(17000)}}),{code:'SHARE_PAYLOAD_INVALID'});
   const digest=crypto.createHash('sha256').update(first.code).digest();await assert.rejects(pool.query("UPDATE game_share_links SET title='changed' WHERE code_hash=$1",[digest]),/immutable/);
   await assert.rejects(pool.query("UPDATE game_share_events SET action='revoked' WHERE code_hash=$1",[digest]),/immutable/);
 });
 await t.test('concurrent creations enforce the per-minute quota even after revocation',async()=>{
   const results=await Promise.allSettled(Array.from({length:8},create));assert.equal(results.filter(r=>r.status==='fulfilled').length,4);for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'SHARE_QUOTA_EXCEEDED');
   await assert.rejects(shares.revoke(actors.other,first.code),{code:'SHARE_UNAVAILABLE'});await shares.revoke(actors.owner,first.code);await shares.revoke(actors.owner,first.code);await assert.rejects(shares.get(first.code),{code:'SHARE_UNAVAILABLE'});await assert.rejects(create(),{code:'SHARE_QUOTA_EXCEEDED'});
   const counts=(await pool.query('SELECT action,count(*)::int n FROM game_share_events GROUP BY action')).rows;assert.equal(counts.find(r=>r.action==='created').n,5);assert.equal(counts.find(r=>r.action==='revoked').n,1);
 });
 await t.test('withdrawal, target withdrawal and release disable permanently invalidate existing links',async()=>{
   // Use separate authenticated accounts so each independent lifecycle case stays within real quotas.
   for(const [off,on] of [["UPDATE works SET state='withdrawn' WHERE id=$1","UPDATE works SET state='published' WHERE id=$1"],["UPDATE work_targets SET state='withdrawn' WHERE work_id=$1","UPDATE work_targets SET state='published' WHERE work_id=$1"],["UPDATE releases SET serving_state='disabled' WHERE work_id=$1","UPDATE releases SET serving_state='enabled' WHERE work_id=$1"]]){
     const next=await f.session(actors.other);const link=await shares.create(actors.other,next.gameSessionId,input);await pool.query(off,[f.workId]);await assert.rejects(shares.get(link.code),{code:'SHARE_UNAVAILABLE'});await assert.rejects(shares.create(actors.other,next.gameSessionId,input),{code:'GAME_SESSION_INVALID'});await assert.rejects(f.catalog.launch(f.workId,f.releaseId),{code:'NOT_FOUND'});await pool.query(on,[f.workId]);await assert.rejects(shares.get(link.code),{code:'SHARE_UNAVAILABLE'});await f.sessions.revoke(actors.other,next.gameSessionId);
   }
 });
 await t.test('undeclared capability, account ban and retired releases are denied',async()=>{
   await pool.query("UPDATE releases SET approved_capabilities='[]' WHERE id=$1",[f.releaseId]);const noCap=await f.session();await assert.rejects(shares.create(actors.owner,noCap.gameSessionId,input),{code:'GAME_SESSION_INVALID'});await f.sessions.revoke(actors.owner,noCap.gameSessionId);
   await pool.query('UPDATE releases SET approved_capabilities=$2 WHERE id=$1',[f.releaseId,JSON.stringify(['shareLinks','fileExport'])]);const next=await f.session(actors.other),link=await shares.create(actors.other,next.gameSessionId,input);
   await pool.query("UPDATE users SET status='suspended' WHERE id=$1",[actors.other.userId]);await assert.rejects(shares.get(link.code),{code:'SHARE_UNAVAILABLE'});await pool.query("UPDATE users SET status='active' WHERE id=$1",[actors.other.userId]);
   await pool.query("UPDATE releases SET retire_after=now()-interval '1 second' WHERE id=$1",[f.releaseId]);await assert.rejects(shares.get(link.code),{code:'SHARE_UNAVAILABLE'});await assert.rejects(f.catalog.launch(f.workId,f.releaseId),{code:'NOT_FOUND'});
 });
 await t.test('expiry is enforced and maintenance removes expired payload without removing audit',async()=>{
   const hash=crypto.randomBytes(32);await pool.query("INSERT INTO game_share_links(code_hash,user_id,work_id,release_id,title,payload,work_generation,target_generation,release_generation,created_at,expires_at) VALUES($1,$2,$3,$4,'expired','{}',0,0,0,now()-interval '31 days',now()-interval '1 day')",[hash,actors.owner.userId,f.workId,f.releaseId]);
   await shares.cleanup();assert.equal((await pool.query('SELECT count(*)::int n FROM game_share_links WHERE code_hash=$1',[hash])).rows[0].n,0);assert.ok((await pool.query('SELECT count(*)::int n FROM game_share_events')).rows[0].n>0);
 });
 await t.test('Bingo ZIP upload validates and auto-publishes both capabilities',async()=>{
   const path=require('node:path'),fs=require('node:fs/promises'),{Readable}=require('node:stream'),{makeZip}=require('../../scripts/zip-fixture.cjs');
   const {createUploadService}=await import('../../apps/api/src/upload-service.mjs'),{PostgresUploadRepository}=await import('../../apps/api/src/upload-repository.mjs');
   const {LocalQuarantineStore}=await import('../../apps/api/src/local-object-store.mjs'),{LocalRuntimeStore}=await import('../../apps/api/src/local-runtime-store.mjs');
   const {createValidationWorker}=await import('../../apps/api/src/validation-worker.mjs'),{PostgresValidationRepository}=await import('../../apps/api/src/validation-repository.mjs');
   const root=path.resolve(__dirname,'../../.runtime/game-share-upload',crypto.randomUUID());await fs.mkdir(root,{recursive:true});
   try {
     const quarantineStore=new LocalQuarantineStore(path.join(root,'quarantine'));const service=createUploadService({repository:new PostgresUploadRepository(pool),objectStore:quarantineStore});
     const worker=createValidationWorker({repository:new PostgresValidationRepository(pool),quarantineStore,runtimeStore:new LocalRuntimeStore(path.join(root,'runtime')),validatorRoot:path.join(root,'validator')});
     const archive=makeZip([{name:'index.html',data:'<!doctype html><title>Bingo</title>'},{name:'platform.json',data:JSON.stringify({version:1,entry:'index.html',capabilities:['fileExport','shareLinks']})}]);
     const actor={...actors.owner,scopes:[...actors.owner.scopes,'upload','publish']};
     const job=await service.create(actor,f.draftId,{targetKey:'web',packageType:'web_zip',fileName:'Bingo.zip',declaredBytes:String(archive.length),sha256:crypto.createHash('sha256').update(archive).digest('hex'),releaseLabel:'Bingo capabilities',autoPublish:true},crypto.randomUUID());
     const grant=await service.grant(actor,job.id);await service.receive(job.id,'Upload '+grant.token,Readable.from([archive]));await service.complete(actor,job.id,crypto.randomUUID());await worker.runOnce({targetUploadId:job.id});
     const result=await service.get(actor,job.id);assert.equal(result.state,'succeeded');assert.equal(result.publicationOutcome,'published');
     const descriptor=await f.catalog.launch(f.draftId);assert.equal(descriptor.capabilities.fileExport,true);assert.equal(descriptor.capabilities.shareLinks,true);
   } finally {assert.equal(path.dirname(root),path.resolve(__dirname,'../../.runtime/game-share-upload'));await fs.rm(root,{recursive:true,force:true});}
 });
});
