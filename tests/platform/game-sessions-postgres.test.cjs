const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const url=process.env.GAMEHUB_GAME_SESSION_DATABASE_URL;

test('PostgreSQL game session isolation, atomic quota, expiry and revocation generations', {skip:!url},async t=>{
  const {createDatabase}=await import('../../apps/api/src/database.mjs');
  const {applyMigrations}=await import('../../apps/api/src/migrations.mjs');
  const {PostgresGameSessionRepository}=await import('../../apps/api/src/game-session-repository.mjs');
  const {createGameSessionService,hashGameSession}=await import('../../apps/api/src/game-session-service.mjs');
  const db=createDatabase({databaseUrl:url,databaseSsl:false});t.after(()=>db.close());
  await applyMigrations(db.pool,path.resolve(__dirname,'../../apps/api/migrations'));
  const pool=db.pool;let now=new Date();const userId=crypto.randomUUID(),otherUserId=crypto.randomUUID();
  const grantId=crypto.randomUUID(),otherGrantId=crypto.randomUUID(),quotaGrantId=crypto.randomUUID();
  const workId=crypto.randomUUID(),releaseId=crypto.randomUUID(),otherWorkId=crypto.randomUUID(),modeId=crypto.randomUUID();
  await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Game service test'),($2,'Other test player')",[userId,otherUserId]);
  for(const [id,owner] of [[grantId,userId],[otherGrantId,otherUserId],[quotaGrantId,userId]])await pool.query(
    "INSERT INTO device_grants(id,user_id,device_label,client_kind,authenticated_at,expires_at) VALUES($1,$2,'test','browser',$3,$4)",
    [id,owner,now,new Date(now.getTime()+3600000)]);
  await pool.query("INSERT INTO works(id,owner_user_id,title,kind,state,visibility) VALUES($1,$3,'Service test','game','published','public'),($2,$3,'Other work','game','published','public')",[workId,otherWorkId,userId]);
  await pool.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published')",[workId]);
  await pool.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state,approved_capabilities) VALUES($1,$2,'web','v1','web_zip','ready','enabled',$3)",[releaseId,workId,JSON.stringify(['multiplayer','cloudSave','competition'])]);
  const actor={userId,grantId};
  const repository=new PostgresGameSessionRepository(pool);
  const service=createGameSessionService({repository,clock:()=>now});
  const input=(overrides={})=>({workId,releaseId,channel:'production',launchNonce:crypto.randomUUID(),...overrides});
  const create=()=>service.create(actor,input());
  const rejected=session=>assert.rejects(service.resolve(actor,session.gameSessionId),{code:'GAME_SESSION_INVALID'});
  await t.test('manifest-only claims have no private-service authority',async()=>{
    const s=await create();assert.deepEqual(s.capabilities,['identity','multiplayer']);
    await assert.rejects(service.resolve(actor,s.gameSessionId,{capability:'cloudSave'}),{code:'GAME_SESSION_INVALID'});
    assert.equal((await pool.query('SELECT token_hash FROM game_sessions WHERE token_hash=$1',[hashGameSession(s.gameSessionId)])).rows[0].token_hash.length,32);
    await service.revoke(actor,s.gameSessionId);
  });
  await pool.query("INSERT INTO game_release_service_scopes(work_id,release_id,channel,status,namespaces,mode_ids,approved_by,reason) VALUES($1,$2,'production','active',$3,$4,$5,'test approval')",
    [workId,releaseId,JSON.stringify({default:{readSchema:{min:1,max:3},writeSchema:3}}),[modeId],userId]);
  await t.test('user, device, work, release and preview boundaries are enforced',async()=>{
    const s=await create();
    assert.deepEqual(s.capabilities,['identity','multiplayer','cloudSave','competition']);
    assert.equal((await service.resolve(actor,s.gameSessionId,{namespace:'default',modeId})).releaseId,releaseId);
    await assert.rejects(service.resolve({userId:otherUserId,grantId:otherGrantId},s.gameSessionId),{code:'GAME_SESSION_INVALID'});
    await assert.rejects(service.resolve({userId,grantId:quotaGrantId},s.gameSessionId),{code:'GAME_SESSION_INVALID'});
    await assert.rejects(service.create(actor,input({workId:otherWorkId})),{code:'GAME_SESSION_RELEASE_NOT_ALLOWED'});
    await assert.rejects(service.create({userId:otherUserId,grantId:otherGrantId},input({channel:'preview'})),{code:'GAME_SESSION_RELEASE_NOT_ALLOWED'});
    const preview=await service.create(actor,input({channel:'preview'}));
    await assert.rejects(service.resolve(actor,preview.gameSessionId,{channel:'production'}),{code:'GAME_SESSION_INVALID'});
    await service.revoke(actor,s.gameSessionId);await service.revoke(actor,preview.gameSessionId);
  });
  await t.test('revocation and scope snapshots cannot be rewritten through SQL',async()=>{
    const s=await create();const h=hashGameSession(s.gameSessionId);
    await assert.rejects(pool.query("UPDATE game_sessions SET channel='preview' WHERE token_hash=$1",[h]),/immutable/u);
    await service.revoke(actor,s.gameSessionId);
    await assert.rejects(pool.query('UPDATE game_sessions SET revoked_at=NULL WHERE token_hash=$1',[h]),/immutable/u);
    await assert.rejects(pool.query('DELETE FROM game_release_service_scopes WHERE release_id=$1',[releaseId]),/retire/u);
    await assert.rejects(pool.query("UPDATE game_service_scope_events SET reason='rewrite' WHERE release_id=$1",[releaseId]),/append only/u);
  });
  await t.test('withdraw/republish, disable/re-enable and scope retirement never revive issued sessions',async()=>{
    for(const [off,on] of [
      ["UPDATE works SET state='withdrawn' WHERE id=$1","UPDATE works SET state='published' WHERE id=$1"],
      ["UPDATE work_targets SET state='withdrawn' WHERE work_id=$1","UPDATE work_targets SET state='published' WHERE work_id=$1"],
      ["UPDATE releases SET serving_state='disabled' WHERE work_id=$1","UPDATE releases SET serving_state='enabled' WHERE work_id=$1"],
      ["UPDATE game_release_service_scopes SET status='retired' WHERE work_id=$1","UPDATE game_release_service_scopes SET status='active' WHERE work_id=$1"],
    ]){
      const s=await create();await pool.query(off,[workId]);await rejected(s);await pool.query(on,[workId]);await rejected(s);await service.revoke(actor,s.gameSessionId);
    }
  });
  await t.test('nonce reuse and parallel quota cannot create excess sessions',async()=>{
    const fixed=input();const s=await service.create(actor,fixed);
    await assert.rejects(service.create(actor,fixed),{code:'GAME_SESSION_NONCE_REUSED'});
    await service.revoke(actor,s.gameSessionId);
    const parallel=await Promise.allSettled(Array.from({length:14},()=>service.create({userId,grantId:quotaGrantId},input())));
    assert.equal(parallel.filter(r=>r.status==='fulfilled').length,8);
    for(const result of parallel.filter(r=>r.status==='rejected')) assert.equal(result.reason.code,'GAME_SESSION_LIMIT');
    for(const result of parallel.filter(r=>r.status==='fulfilled'))await service.revoke({userId,grantId:quotaGrantId},result.value.gameSessionId);
  });
  await t.test('revoking sessions does not bypass issuance rate limits',async()=>{
    const limited={userId,grantId:quotaGrantId};
    // This grant has already issued eight successful sessions in the quota test.
    for(let i=0;i<22;i++){const session=await service.create(limited,input());await service.revoke(limited,session.gameSessionId);}
    await assert.rejects(service.create(limited,input()),{code:'GAME_SESSION_RATE_LIMITED'});
  });
  await t.test('expiration and device logout invalidate authorization',async()=>{
    const s=await create();now=new Date(now.getTime()+300000);await rejected(s);
    const next=await create();await pool.query('UPDATE device_grants SET revoked_at=$2 WHERE id=$1',[grantId,now]);await rejected(next);
  });
});
