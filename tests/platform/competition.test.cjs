const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises');
const definition=async()=>JSON.parse(await fs.readFile(path.resolve(__dirname,'../../samples/competition-2048/platform.json'),'utf8')).competition;
test('competition declarations are bounded data and versioned; evidence is replayed',async()=>{
  const {normalizeCompetition,validateCompetitionMetrics}=await import('../../packages/contracts/src/competition.mjs');
  const {createTileMerge,verifyTileMerge}=await import('../../packages/competition-rules/tile-merge-v1.mjs');
  const original=await definition();assert.equal(normalizeCompetition(original).boards[0].verification,'replay_verified');
  for(const mutate of [x=>delete x.boards[0].key,x=>x.boards[0].ranking[0].direction='sql',x=>x.boards[0].metrics[0].max=Infinity,x=>x.boards[0].verifier='user-script.js',x=>x.boards[0].metrics[0].key='unknown',x=>x.boards.push(...Array(4).fill(x.boards[0])),x=>x.boards[0].comparator='return 1']){
    const input=structuredClone(original);mutate(input);assert.throws(()=>normalizeCompetition(input),{code:'MANIFEST_COMPETITION_INVALID'});
  }
  assert.throws(()=>validateCompetitionMetrics(original.boards[0],{score:1.5,'max-tile':4,moves:1}));
  const game=createTileMerge(123),actions=[];
  for(let i=0;i<200;i++){const action='LURD'[i%4];if(game.move(action))actions.push(action);}
  const state=game.snapshot(),metrics=verifyTileMerge(123,{format:'tile-merge-v1',moves:actions.join('')});
  assert.deepEqual(metrics,{score:state.score,moves:actions.length,'max-tile':state['max-tile']});
  assert.throws(()=>verifyTileMerge(123,{format:'tile-merge-v1',moves:'X'}));
  assert.throws(()=>verifyTileMerge(123,{format:'tile-merge-v1',moves:'L'.repeat(8193)}));
});
test('PostgreSQL competition: release policy, sessions, replay, best scores, isolation and moderation',{skip:!process.env.GAMEHUB_COMMUNITY_DATABASE_URL,timeout:120000},async t=>{
  const {createCommunityTestDatabase}=require('../community-database.cjs');
  const db=await createCommunityTestDatabase(process.env.GAMEHUB_COMMUNITY_DATABASE_URL),pool=db.pool;t.after(()=>db.close());
  const {applyMigrations}=await import('../../apps/api/src/migrations.mjs');await applyMigrations(pool,path.resolve(__dirname,'../../apps/api/migrations'));
  const {withTransaction}=await import('../../apps/api/src/database.mjs');
  const {createCompetitionService,registerCompetitionRelease}=await import('../../apps/api/src/competition-service.mjs');
  const {createGameSessionService}=await import('../../apps/api/src/game-session-service.mjs');
  const {PostgresGameSessionRepository}=await import('../../apps/api/src/game-session-repository.mjs');
  const {createTileMerge}=await import('../../packages/competition-rules/tile-merge-v1.mjs');
  const users=Array.from({length:4},()=>({userId:crypto.randomUUID(),grantId:crypto.randomUUID()}));let now=new Date();
  for(const user of users){await pool.query("INSERT INTO users(id,display_name,social_visibility) VALUES($1,'测试玩家','public')",[user.userId]);await pool.query("INSERT INTO device_grants(id,user_id,device_label,client_kind,authenticated_at,expires_at) VALUES($1,$2,'competition','browser',$3,$4)",[user.grantId,user.userId,now,new Date(now.getTime()+86400000)]);}
  const owner=users[0],workId=crypto.randomUUID(),releaseId=crypto.randomUUID();
  await pool.query("INSERT INTO works(id,owner_user_id,title,kind,state,visibility) VALUES($1,$2,'2048','game','published','public')",[workId,owner.userId]);
  await pool.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published')",[workId]);
  const release=async id=>{await pool.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state,approved_capabilities) VALUES($1,$2,'web','v1','web_zip','ready','enabled','[\"competition\"]')",[id,workId]);};await release(releaseId);
  await pool.query("UPDATE work_targets SET current_release_id=$2 WHERE work_id=$1",[workId,releaseId]);
  const reported={key:'puzzle-time',modeKey:'puzzle',title:'解谜计时榜',rulesetVersion:1,period:'daily',verification:'client_reported',metrics:[{key:'elapsed',label:'用时',unit:'毫秒',min:0,max:3600000},{key:'errors',label:'错误',unit:'次',min:0,max:100}],ranking:[{metric:'errors',direction:'asc'},{metric:'elapsed',direction:'asc'}]};
  const policy=await definition();policy.boards.push(reported);
  await withTransaction(pool,client=>registerCompetitionRelease(client,{workId,releaseId,ownerUserId:owner.userId,competition:policy}));
  const sessions=createGameSessionService({repository:new PostgresGameSessionRepository(pool),clock:()=>now}),service=createCompetitionService({pool,gameSessionService:sessions,clock:()=>now});
  const boards=await service.boards(workId),replay=boards.find(b=>b.key==='classic-score'),casual=boards.find(b=>b.key==='puzzle-time');assert.equal(boards.length,2);
  const tokens=[];for(const user of users)tokens.push((await sessions.create(user,{workId,releaseId,channel:'production',launchNonce:crypto.randomUUID()})).gameSessionId);
  const start=(i,boardId=casual.id,requestId=crypto.randomUUID())=>service.start(users[i],tokens[i],{boardId,requestId});
  const finish=(i,run,metrics)=>service.finish(users[i],tokens[i],run.id,{metrics});
  await t.test('authority, idempotency and client score forgery',async()=>{
    const requestId=crypto.randomUUID(),run=await start(0,replay.id,requestId);assert.equal((await start(0,replay.id,requestId)).id,run.id);
    await assert.rejects(start(0,casual.id,requestId),{code:'COMPETITION_IDEMPOTENCY_CONFLICT'});
    await assert.rejects(service.get(users[1],tokens[1],run.id),{code:'COMPETITION_RUN_NOT_FOUND'});
    await assert.rejects(start(0,crypto.randomUUID()),{code:'COMPETITION_NOT_ALLOWED'});
    await assert.rejects(finish(0,run,{score:999999,'max-tile':2048,moves:50}),{code:'COMPETITION_EVIDENCE_INVALID'});
    const game=createTileMerge(run.seed);let moves='';for(let i=0;i<50;i++){const action='LURD'[i%4];if(game.move(action))moves+=action;}
    const submission={evidence:{format:'tile-merge-v1',moves}};
    await assert.rejects(service.finish(owner,tokens[0],run.id,{...submission,metrics:{score:999999,moves:moves.length,'max-tile':4}}),{code:'COMPETITION_SCORE_MISMATCH'});
    const results=await Promise.all([service.finish(owner,tokens[0],run.id,submission),service.finish(owner,tokens[0],run.id,submission)]);
    assert.equal(results[0].status,'accepted');assert.deepEqual(results[0],results[1]);assert.equal(results[0].metrics.score,game.snapshot().score);
    assert.equal((await service.leaderboard(null,workId,replay.id)).total,1);
    await assert.rejects(pool.query("UPDATE competition_runs SET metrics='{}' WHERE id=$1",[run.id]),/immutable/);
    await assert.rejects(pool.query('DELETE FROM competition_runs WHERE id=$1',[run.id]),/retained/);
  });
  let bestRun;
  await t.test('generic ascending multi-metric ranking, owner, blocks and privacy',async()=>{
    bestRun=await start(0);await finish(0,bestRun,{elapsed:100,errors:0});
    const worse=await start(0);await finish(0,worse,{elapsed:10,errors:1});
    const second=await start(1);await finish(1,second,{elapsed:200,errors:0});
    const third=await start(2);await finish(2,third,{elapsed:50,errors:0});
    const board=await service.leaderboard(owner,workId,casual.id,{limit:1,offset:1});assert.equal(board.entries[0].player.id,owner.userId);assert.equal(board.myEntry.rank,2);assert.equal(board.hasMore,true);assert.equal(board.total,3);
    await pool.query("UPDATE users SET social_visibility='private' WHERE id=$1",[owner.userId]);assert.equal((await service.leaderboard(owner,workId,casual.id)).myEntry.rank,null);
    await pool.query('INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES($1,$2)',[users[2].userId,users[1].userId]);
    assert.equal((await service.leaderboard(users[1],workId,casual.id)).total,1);assert.equal((await service.leaderboard(null,workId,casual.id)).total,2);
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1",[users[2].userId]);assert.equal((await service.leaderboard(null,workId,casual.id)).total,1);
    const invalid=await start(1);await assert.rejects(finish(1,invalid,{elapsed:1,errors:0,extra:1}),{code:'COMPETITION_METRICS_INVALID'});
    const abandoned=await start(1);await service.abandon(users[1],tokens[1],abandoned.id);await assert.rejects(finish(1,abandoned,{elapsed:1,errors:0}),{code:'COMPETITION_RUN_CLOSED'});
  });
  await t.test('preview results never enter public boards; moderation restores next best',async()=>{
    const preview=(await sessions.create(owner,{workId,releaseId,channel:'preview',launchNonce:crypto.randomUUID()})).gameSessionId;
    const run=await service.start(owner,preview,{boardId:casual.id,requestId:crypto.randomUUID()});await service.finish(owner,preview,run.id,{metrics:{elapsed:0,errors:0}});
    assert.equal((await service.leaderboard(owner,workId,casual.id)).myEntry.scores.elapsed,100);
    await assert.rejects(service.moderate(users[1],bestRun.id,{action:'invalidate',reason:'test'}),{code:'ADMIN_REQUIRED'});
    const admin={...owner,profile:{role:'admin'}};await service.moderate(admin,bestRun.id,{action:'invalidate',reason:'fixture invalidation'});
    assert.equal((await service.leaderboard(owner,workId,casual.id)).myEntry.scores.errors,1);
    await service.moderate(admin,bestRun.id,{action:'restore',reason:'fixture restore'});assert.equal((await service.leaderboard(owner,workId,casual.id)).myEntry.scores.errors,0);
  });
  await t.test('run quotas and bounded maintenance preserve accepted results',async()=>{
    const abandoned=await start(3);await service.abandon(users[3],tokens[3],abandoned.id);
    await pool.query("UPDATE competition_runs SET issued_at=now()-interval '3 days',expires_at=now()-interval '2 days' WHERE id=$1",[abandoned.id]);
    const countBefore=(await pool.query("SELECT count(*)::int AS n FROM competition_runs WHERE status='accepted'")).rows[0].n;
    assert.equal((await service.cleanOnce()).expiredRemoved,1);assert.equal((await pool.query("SELECT count(*)::int AS n FROM competition_runs WHERE status='accepted'")).rows[0].n,countBefore);
    await pool.query(`INSERT INTO competition_runs(id,board_id,user_id,release_id,channel,request_id,period_key,seed,issued_at,expires_at)
      SELECT gen_random_uuid(),$1,$2,$3,'production',gen_random_uuid(),'all-time',0,now(),now()+interval '1 hour' FROM generate_series(1,60)`,[casual.id,users[3].userId,releaseId]);
    await assert.rejects(start(3),{code:'COMPETITION_RATE_LIMITED'});
    const count=(await pool.query('SELECT count(*)::int AS n FROM competition_runs')).rows[0].n;
    await pool.query(`INSERT INTO competition_runs(id,board_id,user_id,release_id,channel,request_id,period_key,seed,issued_at,expires_at)
      SELECT gen_random_uuid(),$1,$2,$3,'production',gen_random_uuid(),'all-time',0,now()-interval '2 hours',now()+interval '1 hour' FROM generate_series(1,$4::int)`,[casual.id,users[3].userId,releaseId,20000-count]);
    await assert.rejects(start(1),{code:'COMPETITION_CAPACITY_REACHED'});
    await pool.query("DELETE FROM competition_runs WHERE status='issued' AND user_id=$1",[users[3].userId]);
  });
  await t.test('publication freezes definitions and keeps changed rule versions apart',async()=>{
    const nextId=crypto.randomUUID();await release(nextId);const changed=structuredClone(policy);changed.boards[0].ranking.reverse();
    await assert.rejects(withTransaction(pool,client=>registerCompetitionRelease(client,{workId,releaseId:nextId,ownerUserId:owner.userId,competition:changed})),{code:'MANIFEST_COMPETITION_VERSION_CONFLICT'});
    changed.boards.forEach(board=>board.rulesetVersion++);await withTransaction(pool,client=>registerCompetitionRelease(client,{workId,releaseId:nextId,ownerUserId:owner.userId,competition:changed}));
    await pool.query('UPDATE work_targets SET current_release_id=$2 WHERE work_id=$1',[workId,nextId]);const next=await service.boards(workId);assert.ok(next.every(b=>b.rulesetVersion===2));assert.equal((await service.leaderboard(owner,workId,next[0].id)).total,0);
    await assert.rejects(service.leaderboard(owner,workId,replay.id),{code:'COMPETITION_BOARD_NOT_FOUND'});
    await pool.query("UPDATE works SET state='withdrawn' WHERE id=$1",[workId]);assert.deepEqual(await service.boards(workId),[]);await assert.rejects(start(0),{code:'GAME_SESSION_INVALID'});
  });
});
