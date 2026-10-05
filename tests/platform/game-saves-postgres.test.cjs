const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const url=process.env.GAMEHUB_GAME_SAVE_DATABASE_URL;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const uuid=()=>crypto.randomUUID();

test('PostgreSQL save transactions, durability receipts, retention and authorization',{skip:!url},async t=>{
  const {createDatabase}=await import('../../apps/api/src/database.mjs');
  const {applyMigrations}=await import('../../apps/api/src/migrations.mjs');
  const {PostgresGameSessionRepository}=await import('../../apps/api/src/game-session-repository.mjs');
  const {createGameSessionService}=await import('../../apps/api/src/game-session-service.mjs');
  const {PostgresGameSaveRepository}=await import('../../apps/api/src/game-save-repository.mjs');
  const {createGameSaveService}=await import('../../apps/api/src/game-save-service.mjs');
  const db=createDatabase({databaseUrl:url,databaseSsl:false}),pool=db.pool;t.after(()=>db.close());
  await applyMigrations(pool,path.resolve(__dirname,'../../apps/api/migrations'));
  async function fixture(policy={}) {
    const userId=uuid(),grantId=uuid(),workId=uuid(),releaseId=uuid();let now=new Date();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Save transaction test')",[userId]);
    await pool.query("INSERT INTO device_grants(id,user_id,device_label,client_kind,authenticated_at,expires_at) VALUES($1,$2,'test','browser',$3,$4)",[grantId,userId,now,new Date(now.getTime()+3600000)]);
    await pool.query("INSERT INTO works(id,owner_user_id,title,kind,state,visibility) VALUES($1,$2,'Save test','game','published','public')",[workId,userId]);
    await pool.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published')",[workId]);
    const namespaces={default:{readSchema:{min:1,max:2},writeSchema:1},secondary:{readSchema:{min:1,max:2},writeSchema:1}};
    async function release(id,scopes=namespaces) {
      await pool.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state,approved_capabilities) VALUES($1,$2,'web','v1','web_zip','ready','enabled',$3)",[id,workId,JSON.stringify(['cloudSave'])]);
      for(const channel of ['production','preview'])await pool.query("INSERT INTO game_release_service_scopes(work_id,release_id,channel,status,namespaces,approved_by,reason) VALUES($1,$2,$3,'active',$4,$5,'save test approval')",[workId,id,channel,JSON.stringify(scopes),userId]);
    }
    await release(releaseId);
    for(const namespace of Object.keys(namespaces))await pool.query("INSERT INTO game_save_policies(id,work_id,namespace,status,schema_max,max_document_bytes,max_live_bytes,max_history_bytes,max_slots,approved_by,reason) VALUES($1,$2,$3,'active',2,$4,$5,$6,$7,$8,'save test policy')",
      [uuid(),workId,namespace,policy.document??262144,policy.live??1048576,policy.history??5242880,policy.slots??10,userId]);
    const actor={userId,grantId},sessions=createGameSessionService({repository:new PostgresGameSessionRepository(pool),clock:()=>now});
    const repository=new PostgresGameSaveRepository(pool);
    const service=createGameSaveService({repository,gameSessionService:sessions,clock:()=>now});
    const issue=async(channel='production',id=releaseId)=>(await sessions.create(actor,{workId,releaseId:id,channel,launchNonce:uuid()})).gameSessionId;
    const token=await issue();
    const resource=(slotKey='autosave',extra={})=>({workId,namespace:'default',slotKey,...extra});
    const command=(bytes=Buffer.from('{"level":1}'),extra={})=>({...resource(),ifNoneMatch:'*',idempotencyKey:uuid(),schemaVersion:1,contentType:'application/json',bytes,sha256:hash(bytes),...extra});
    const write=(input,session=token)=>service.write(actor,session,input);
    const advance=ms=>{now=new Date(now.getTime()+ms);};
    return {actor,workId,releaseId,token,sessions,repository,service,resource,command,write,issue,release,advance};
  }
  const rejected=(promise,code)=>assert.rejects(promise,{code});
  await t.test('concurrent retries make one revision; receipt precedes stale CAS and binds all fields',async()=>{
    const f=await fixture(),input=f.command();
    const [a,b]=await Promise.all([f.write(input),f.write(input)]);
    assert.deepEqual(a,b);assert.equal(a.revision,'1');
    const second=f.command(Buffer.from('{"level":2}'),{ifNoneMatch:undefined,ifMatch:a.etag});
    const results=await Promise.allSettled([f.write(second),f.write({...second,idempotencyKey:uuid()})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'SAVE_CONFLICT');
    assert.deepEqual(await f.write(input),a);
    await rejected(f.write({...input,ifNoneMatch:undefined,ifMatch:a.etag}),'SAVE_IDEMPOTENCY_MISMATCH');
    await rejected(f.write({...input,schemaVersion:2}),'SAVE_IDEMPOTENCY_MISMATCH');
    await rejected(f.service.delete(f.actor,f.token,{...f.resource(),ifMatch:a.etag,idempotencyKey:input.idempotencyKey}),'SAVE_IDEMPOTENCY_MISMATCH');
    const count=(await pool.query('SELECT count(*)::int AS count FROM game_save_revisions r JOIN game_save_slots s ON s.id=r.slot_id WHERE s.work_id=$1',[f.workId])).rows[0].count;
    assert.equal(count,2);
    const rate=(await pool.query('SELECT day_writes FROM game_save_rate_usage WHERE work_id=$1',[f.workId])).rows[0];
    assert.equal(rate.day_writes,2);
  });
  await t.test('work quota spans namespaces, serializes parallel writes, and failures roll back all counters',async()=>{
    const f=await fixture({document:1048576});
    const bytes=Buffer.alloc(600000,7);
    const results=await Promise.allSettled(['default','secondary'].map(namespace=>f.write(f.command(bytes,{namespace,contentType:'application/octet-stream'}))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'SAVE_QUOTA_EXCEEDED');
    const usage=(await pool.query('SELECT * FROM game_save_usage WHERE work_id=$1',[f.workId])).rows[0];
    assert.equal(usage.live_slots,1);assert.equal(Number(usage.live_bytes),600000);assert.equal(Number(usage.version),1);
    assert.equal((await pool.query('SELECT day_writes FROM game_save_rate_usage WHERE work_id=$1',[f.workId])).rows[0].day_writes,1);
    const g=await fixture();
    const many=await Promise.allSettled(Array.from({length:12},(_,i)=>g.write(g.command(undefined,{slotKey:'slot-'+i,namespace:i%2?'secondary':'default'}))));
    assert.equal(many.filter(r=>r.status==='fulfilled').length,10);
    for(const r of many.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'SAVE_QUOTA_EXCEEDED');
  });
  await t.test('history rolls within byte budget; receipts survive purge; restore and delete append revisions',async()=>{
    const f=await fixture({history:15});
    const firstInput=f.command(Buffer.alloc(10,1),{contentType:'application/octet-stream'});
    const first=await f.write(firstInput);
    const second=await f.write(f.command(Buffer.alloc(10,2),{contentType:'application/octet-stream',ifNoneMatch:undefined,ifMatch:first.etag}));
    const third=await f.write(f.command(Buffer.alloc(10,3),{contentType:'application/octet-stream',ifNoneMatch:undefined,ifMatch:second.etag}));
    assert.equal(third.historyDegraded,true);assert.deepEqual(await f.write(firstInput),first);
    let history=await f.service.history(f.actor,f.token,f.resource());
    assert.equal(history.items.find(r=>r.revision==='1').payloadAvailable,false);
    assert.equal(history.items.find(r=>r.revision==='2').payloadAvailable,true);
    await rejected(f.service.restore(f.actor,f.token,{...f.resource(),revisionId:first.revisionId,ifMatch:third.etag,idempotencyKey:uuid()}),'SAVE_HISTORY_UNAVAILABLE');
    const restored=await f.service.restore(f.actor,f.token,{...f.resource(),revisionId:second.revisionId,ifMatch:third.etag,idempotencyKey:uuid()});
    assert.equal(restored.revision,'4');assert.equal(restored.restoredFromRevisionId,second.revisionId);
    assert.deepEqual((await f.service.content(f.actor,f.token,f.resource())).bytes,Buffer.alloc(10,2));
    const deleted=await f.service.delete(f.actor,f.token,{...f.resource(),ifMatch:restored.etag,idempotencyKey:uuid()});
    assert.equal(deleted.revision,'5');assert.equal(deleted.deleted,true);
    await rejected(f.service.delete(f.actor,f.token,{...f.resource(),ifMatch:deleted.etag,idempotencyKey:uuid()}),'SAVE_SLOT_NOT_FOUND');
    assert.deepEqual(await f.service.list(f.actor,f.token,f.resource()),[]);
    await rejected(f.service.content(f.actor,f.token,f.resource()),'SAVE_SLOT_NOT_FOUND');
    assert.equal((await f.service.metadata(f.actor,f.token,f.resource())).etag,deleted.etag);
    await rejected(f.write(f.command()),'SAVE_CONFLICT');
    const resumed=await f.write(f.command(undefined,{ifNoneMatch:undefined,ifMatch:deleted.etag}));
    assert.equal(resumed.revision,'6');
    const usage=(await pool.query('SELECT * FROM game_save_usage WHERE work_id=$1',[f.workId])).rows[0];
    assert.equal(Number(usage.live_bytes),resumed.bytes);assert.ok(Number(usage.history_bytes)<=15);
    history=await f.service.history(f.actor,f.token,{...f.resource(),beforeRevision:'4'});
    assert.deepEqual(history.items.map(r=>r.revision),['3','2','1']);
    await rejected(f.service.history(f.actor,f.token,{...f.resource(),beforeRevision:'9999999999999999999'}),'SCHEMA_INVALID');
  });
  await t.test('failure after inserting bytes and advancing the pointer rolls back the entire save',async()=>{
    const f=await fixture({history:0}),first=await f.write(f.command());
    const beforeUsage=(await pool.query('SELECT * FROM game_save_usage WHERE work_id=$1',[f.workId])).rows[0];
    const command=f.command(Buffer.from('{"level":9}'),{ifNoneMatch:undefined,ifMatch:first.etag});
    const trim=f.repository.trimHistory.bind(f.repository);
    f.repository.trimHistory=async(...args)=>{await trim(...args);throw new Error('simulated storage failure');};
    await assert.rejects(f.write(command),/simulated storage failure/);
    assert.equal((await f.service.metadata(f.actor,f.token,f.resource())).etag,first.etag);
    assert.deepEqual((await f.service.content(f.actor,f.token,f.resource())).bytes,Buffer.from('{"level":1}'));
    assert.deepEqual((await pool.query('SELECT * FROM game_save_usage WHERE work_id=$1',[f.workId])).rows[0],beforeUsage);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM game_save_revisions r JOIN game_save_slots s ON s.id=r.slot_id WHERE s.work_id=$1',[f.workId])).rows[0].count,1);
    f.repository.trimHistory=trim;
    const result=await f.write(command);assert.equal(result.revision,'2');assert.equal(result.historyDegraded,true);
  });
  await t.test('user, grant, work, namespace and preview scopes stay isolated',async()=>{
    const f=await fixture(),other=await fixture();await f.write(f.command());
    await rejected(f.service.content(other.actor,f.token,f.resource()),'GAME_SESSION_INVALID');
    await rejected(f.service.content({...f.actor,grantId:other.actor.grantId},f.token,f.resource()),'GAME_SESSION_INVALID');
    await rejected(f.service.content(f.actor,f.token,{...f.resource(),workId:other.workId}),'GAME_SESSION_INVALID');
    await rejected(f.service.content(f.actor,f.token,{...f.resource(),namespace:'undeclared'}),'GAME_SESSION_INVALID');
    const preview=await f.issue('preview');
    assert.deepEqual(await f.service.list(f.actor,preview,f.resource()),[]);
    await f.write(f.command(Buffer.from('{"preview":true}')),preview);
    assert.deepEqual((await f.service.content(f.actor,f.token,f.resource())).bytes,Buffer.from('{"level":1}'));
    await pool.query("UPDATE releases SET serving_state='disabled' WHERE id=$1",[f.releaseId]);
    await rejected(f.service.content(f.actor,f.token,f.resource()),'GAME_SESSION_INVALID');
  });
  await t.test('release rollback cannot overwrite an unreadable schema; retired policy permits read/delete and receipt replay',async()=>{
    const f=await fixture();
    const oldRelease=uuid(),newRelease=uuid();
    await f.release(oldRelease,{default:{readSchema:{min:1,max:1},writeSchema:1}});
    await f.release(newRelease,{default:{readSchema:{min:1,max:2},writeSchema:2}});
    const oldToken=await f.issue('production',oldRelease),newToken=await f.issue('production',newRelease);
    const initial=await f.write(f.command(),oldToken);
    const nextInput=f.command(Buffer.from('{"version":2}'),{schemaVersion:2,ifNoneMatch:undefined,ifMatch:initial.etag});
    const next=await f.write(nextInput,newToken);
    await rejected(f.service.content(f.actor,oldToken,f.resource()),'SAVE_RELEASE_INCOMPATIBLE');
    await rejected(f.write(f.command(undefined,{ifNoneMatch:undefined,ifMatch:next.etag}),oldToken),'SAVE_RELEASE_INCOMPATIBLE');
    await pool.query("UPDATE game_save_policies SET status='retired' WHERE work_id=$1",[f.workId]);
    assert.deepEqual(await f.write(nextInput,newToken),next);
    assert.deepEqual((await f.service.content(f.actor,newToken,f.resource())).bytes,nextInput.bytes);
    await rejected(f.write(f.command(undefined,{ifNoneMatch:undefined,ifMatch:next.etag,schemaVersion:2}),newToken),'SAVE_POLICY_NOT_ACTIVE');
    const deleted=await f.service.delete(f.actor,newToken,{...f.resource(),ifMatch:next.etag,idempotencyKey:uuid()});
    assert.equal(deleted.deleted,true);
  });
  await t.test('rate budgets span channels, retries are free, UTC daily quota survives and deletion remains available',async()=>{
    const f=await fixture(),preview=await f.issue('preview');let previous;
    for(let i=0;i<20;i++)previous=await f.write(f.command(undefined,previous?{ifNoneMatch:undefined,ifMatch:previous.etag}:{}));
    await rejected(f.write(f.command(),preview),'SAVE_RATE_LIMITED');
    f.advance(61000);
    await pool.query('UPDATE game_save_rate_usage SET day_writes=2000 WHERE work_id=$1',[f.workId]);
    await rejected(f.write(f.command(undefined,{ifNoneMatch:undefined,ifMatch:previous.etag})),'SAVE_RATE_LIMITED');
    await f.service.delete(f.actor,f.token,{...f.resource(),ifMatch:previous.etag,idempotencyKey:uuid()});
    assert.equal((await pool.query('SELECT day_writes FROM game_save_rate_usage WHERE work_id=$1',[f.workId])).rows[0].day_writes,2001);
  });
  await t.test('SQL invariants forbid cross-slot pointers, mutation of facts and purge of current bytes',async()=>{
    const f=await fixture(),a=await f.write(f.command()),b=await f.write(f.command(undefined,{slotKey:'manual'}));
    const slot=(await pool.query('SELECT id FROM game_save_slots WHERE work_id=$1 AND slot_key=$2',[f.workId,'autosave'])).rows[0].id;
    await assert.rejects(pool.query('UPDATE game_save_slots SET current_revision_id=$2,revision=revision+1 WHERE id=$1',[slot,b.revisionId]));
    await assert.rejects(pool.query("UPDATE game_save_revisions SET payload_sha256=$2 WHERE id=$1",[a.revisionId,'0'.repeat(64)]),/append only/);
    await assert.rejects(pool.query('DELETE FROM game_save_revisions WHERE id=$1',[a.revisionId]),/append only/);
    await assert.rejects(pool.query('DELETE FROM game_save_payloads WHERE revision_id=$1',[a.revisionId]),/current save/);
    await assert.rejects(pool.query('UPDATE game_save_operations SET result=$2 WHERE slot_id=$1',[slot,{}]),/append only/);
    await assert.rejects(pool.query('DELETE FROM game_save_policy_events WHERE policy_id IN(SELECT id FROM game_save_policies WHERE work_id=$1)',[f.workId]),/append only/);
    await assert.rejects(pool.query("INSERT INTO game_save_revisions(id,slot_id,revision,base_revision,etag,schema_version,content_type,payload_sha256,stored_bytes,release_id,source_kind,created_at,tombstone) SELECT $2,slot_id,2,1,$3,schema_version,content_type,payload_sha256,stored_bytes,release_id,'write',now(),false FROM game_save_revisions WHERE id=$1",[a.revisionId,uuid(),'"ghsave-'+crypto.randomBytes(24).toString('base64url')+'"']),/advance the current pointer/);
  });
  await t.test('revocation is serialized with a write and every later access is denied',async()=>{
    const f=await fixture();let entered,release;
    const ready=new Promise(resolve=>{entered=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const original=f.repository.mutate.bind(f.repository);
    f.repository.mutate=async(...args)=>{entered();await gate;return original(...args);};
    const pending=f.write(f.command());await ready;
    let revoked=false;const revocation=f.sessions.revoke(f.actor,f.token).then(()=>{revoked=true;});
    // pg_locks proves the actual conflicting row lock; this isn't a timing-only assertion.
    let waiting=false;
    for(let i=0;i<50&&!waiting;i++){
      waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE game_sessions SET revoked_at%') AS waiting")).rows[0].waiting;
      if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true);assert.equal(revoked,false);release();
    await pending;await revocation;
    await rejected(f.service.content(f.actor,f.token,f.resource()),'GAME_SESSION_INVALID');
  });
  await t.test('SDK -> MessageChannel -> API -> PostgreSQL supports two accounts, host restart, CAS and lost acknowledgements',async st=>{
    const {createSaveBridge}=require('../helpers/game-save-bridge.cjs');
    const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');
    const {createApp}=await import('../../apps/api/src/app.mjs');
    const {loadConfig}=await import('../../apps/api/src/config.mjs');
    const f=await fixture(),other=await fixture();
    const actors={'Bearer account-a':f.actor,'Bearer account-b':other.actor};
    const app=createApp({config:loadConfig({NODE_ENV:'test',DATABASE_URL:url,OTP_HMAC_KEY:'x'.repeat(32)}),
      authService:{authenticateBearer:async header=>{assert.ok(actors[header]);return actors[header];}},
      gameSessionService:f.sessions,gameSaveService:f.service});
    st.after(()=>app.close());
    const requests=[];let dropAcknowledgement=false,readRace=null;
    const fetchImpl=async(address,init)=>{
      const parsed=new URL(address,'https://test.invalid');
      requests.push({path:parsed.pathname,headers:init.headers,body:init.body});
      if(parsed.pathname.endsWith('/content')&&readRace){const race=readRace;readRace=null;await race();}
      const response=await app.inject({method:init.method,url:parsed.pathname+parsed.search,headers:init.headers,
        ...(init.body!==undefined?{payload:init.body instanceof Uint8Array?Buffer.from(init.body):init.body}:{})});
      if(dropAcknowledgement&&init.method==='PUT'&&response.statusCode===200){dropAcknowledgement=false;throw new Error('Simulated dropped response after commit');}
      return new Response(response.rawPayload,{status:response.statusCode,headers:response.headers});
    };
    const makeHost=async account=>{
      const api=createApiClient({getAccessToken:()=>account,fetchImpl});
      const bridge=await createSaveBridge({api,descriptor:{workId:f.workId,releaseId:f.releaseId,channel:'production',capabilities:{cloudSave:true}},
        identity:async()=>account,cloudSaveTimeoutMs:10000});
      st.after(()=>bridge.close());return bridge;
    };
    const web=await makeHost('account-a'),agent=await makeHost('account-a'),secondPlayer=await makeHost('account-b');
    assert.equal(await web.client.cloudSave.read({slot:'autosave'}),null);
    const initial=await web.client.cloudSave.write({slot:'autosave',data:{chapter:'二'},schemaVersion:1,createOnly:true,idempotencyKey:uuid()});
    assert.deepEqual((await agent.client.cloudSave.read({slot:'autosave'})).data,{chapter:'二'});
    assert.equal(await secondPlayer.client.cloudSave.read({slot:'autosave'}),null);
    await secondPlayer.client.cloudSave.write({slot:'autosave',data:{chapter:'玩家乙'},schemaVersion:1,createOnly:true,idempotencyKey:uuid()});
    const large=crypto.randomBytes(262144);
    const updated=await agent.client.cloudSave.write({slot:'autosave',data:large,schemaVersion:1,expectedEtag:initial.etag,idempotencyKey:uuid()});
    await assert.rejects(web.client.cloudSave.write({slot:'autosave',data:{chapter:'过期'},schemaVersion:1,expectedEtag:initial.etag,idempotencyKey:uuid()}),
      error=>error.code==='SAVE_CONFLICT'&&error.details.expectedEtag===updated.etag&&error.details.currentRevision==='2');
    const read=await web.client.cloudSave.read({slot:'autosave'});
    assert.deepEqual(Buffer.from(read.data),large);
    const restarted=web.newClient();await restarted.connect();
    assert.deepEqual(Buffer.from((await restarted.cloudSave.read({slot:'autosave'})).data),large);
    dropAcknowledgement=true;
    const replay={slot:'autosave',data:crypto.randomBytes(80000),schemaVersion:1,expectedEtag:updated.etag,idempotencyKey:uuid()};
    await assert.rejects(restarted.cloudSave.write(replay),{code:'NETWORK_ERROR'});
    const afterLostAck=await agent.client.cloudSave.getMetadata({slot:'autosave'});
    assert.equal(afterLostAck.revision,'3');
    const later=await agent.client.cloudSave.write({slot:'autosave',data:{chapter:'更新'},schemaVersion:1,expectedEtag:afterLostAck.etag,idempotencyKey:uuid()});
    const receipt=await restarted.cloudSave.write(replay);
    assert.equal(receipt.revision,'3');assert.equal(receipt.etag,afterLostAck.etag);
    assert.equal((await restarted.cloudSave.getMetadata({slot:'autosave'})).revision,'4');
    const history=await restarted.cloudSave.history({slot:'autosave'});
    assert.ok(history.items.some(row=>row.revisionId===initial.revisionId&&row.payloadAvailable));
    const restored=await restarted.cloudSave.restore({slot:'autosave',revisionId:initial.revisionId,expectedEtag:later.etag,idempotencyKey:uuid()});
    assert.equal(restored.revision,'5');assert.deepEqual((await restarted.cloudSave.read({slot:'autosave'})).data,{chapter:'二'});
    readRace=async()=>agent.client.cloudSave.write({slot:'autosave',data:{chapter:'下载竞态'},schemaVersion:1,expectedEtag:restored.etag,idempotencyKey:uuid()});
    await assert.rejects(restarted.cloudSave.read({slot:'autosave'}),{code:'SAVE_CONFLICT'});
    const latest=await restarted.cloudSave.getMetadata({slot:'autosave'});
    const deleted=await restarted.cloudSave.delete({slot:'autosave',expectedEtag:latest.etag,idempotencyKey:uuid()});
    const tombstone=await restarted.cloudSave.read({slot:'autosave'});
    assert.equal(tombstone.deleted,true);assert.equal(tombstone.data,null);assert.equal(tombstone.etag,deleted.etag);
    const fresh=await restarted.cloudSave.write({slot:'autosave',data:{chapter:'重新开始'},schemaVersion:1,expectedEtag:tombstone.etag,idempotencyKey:uuid()});
    assert.equal(fresh.revision,'8');
    // A policy downgrade/retirement must not prevent replay of a committed write.
    await pool.query('UPDATE game_save_policies SET max_document_bytes=1 WHERE work_id=$1',[f.workId]);
    const afterDowngrade=await restarted.cloudSave.write(replay);
    assert.equal(afterDowngrade.etag,receipt.etag);
    await pool.query("UPDATE game_save_policies SET status='retired' WHERE work_id=$1",[f.workId]);
    assert.equal((await restarted.cloudSave.write(replay)).etag,receipt.etag);
    await assert.rejects(restarted.cloudSave.write({...replay,data:crypto.randomBytes(80000)}),{code:'SAVE_IDEMPOTENCY_MISMATCH'});
    await assert.rejects(restarted.cloudSave.write({...replay,expectedEtag:fresh.etag}),{code:'SAVE_IDEMPOTENCY_MISMATCH'});
    // The same key/body in another account cannot retrieve account A's receipt.
    await assert.rejects(secondPlayer.client.cloudSave.write(replay),{code:'SAVE_POLICY_NOT_ACTIVE'});
    await assert.rejects(restarted.cloudSave.write({...replay,idempotencyKey:uuid()}),{code:'SAVE_POLICY_NOT_ACTIVE'});
    assert.deepEqual((await secondPlayer.client.cloudSave.read({slot:'autosave'})).data,{chapter:'玩家乙'});
    for(const bridge of [web,agent,secondPlayer]){
      assert.ok(bridge.wire.every(frame=>Buffer.byteLength(JSON.stringify(frame))<=32768));
      assert.doesNotMatch(JSON.stringify(bridge.wire),/gameSessionId|Bearer account-|grantId/);
    }
    assert.ok(requests.filter(r=>r.path.includes('/game-saves/')).every(r=>r.headers['X-GameHub-Session']));
  });
  await t.test('HTTP calls run through real auth scope, CAS transaction and raw content download',async st=>{
    const f=await fixture();
    const {createApp}=await import('../../apps/api/src/app.mjs');
    const {loadConfig}=await import('../../apps/api/src/config.mjs');
    const app=createApp({config:loadConfig({NODE_ENV:'test',DATABASE_URL:url,OTP_HMAC_KEY:'x'.repeat(32)}),
      authService:{authenticateBearer:async()=>f.actor},gameSaveService:f.service});
    st.after(()=>app.close());
    const body=Buffer.from(' { "chapter" : "二" }\n'),base='/v1/me/game-saves/'+f.workId+'/slots/autosave';
    const headers={authorization:'Bearer test','x-gamehub-session':f.token,'content-type':'application/json',
      'x-gamehub-save-schema':'1','x-content-sha256':hash(body),'if-none-match':'*','idempotency-key':uuid()};
    const created=await app.inject({method:'PUT',url:base+'?namespace=default',headers,payload:body});
    assert.equal(created.statusCode,200,created.body);
    const repeat=await app.inject({method:'PUT',url:base+'?namespace=default',headers,payload:body});
    assert.deepEqual(repeat.json(),created.json());
    const read=await app.inject({url:base+'/content?namespace=default',headers:{authorization:'Bearer test','x-gamehub-session':f.token}});
    assert.deepEqual(read.rawPayload,body);assert.equal(read.headers.etag,created.headers.etag);
    const stale=await app.inject({method:'PUT',url:base+'?namespace=default',headers:{...headers,'idempotency-key':uuid()},payload:body});
    assert.equal(stale.statusCode,412,stale.body);assert.equal(stale.json().error.details.currentRevision,'1');
  });
});
