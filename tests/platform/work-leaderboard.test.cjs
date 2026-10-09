const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),databaseUrl=process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
test('work leaderboard rejects invalid calendar dates before reaching PostgreSQL',async()=>{
  const {readWorkLeaderboard}=await import('../../apps/api/src/work-leaderboard.mjs');
  let calls=0;const repository={workLeaderboard:async()=>{calls++;return {entries:[],total:0,puzzle_id:null,my_entry:null};}};
  const now=new Date('2026-10-08T07:00:00Z');
  for(const date of ['0000-01-01','2026-02-29','2026-04-31','2026-13-01','2026-10-09'])await assert.rejects(readWorkLeaderboard(repository,null,{workId:'gamehub-guess-baike',date},now),{code:'SCHEMA_INVALID'});
  assert.equal(calls,0);assert.equal((await readWorkLeaderboard(repository,null,{workId:'gamehub-guess-baike',date:'2024-02-29'},now)).date,'2024-02-29');
});
test('work leaderboard ranks before pagination and protects dates, puzzle groups and private results',{skip:!databaseUrl,timeout:120000},async t=>{
  const {createCommunityTestDatabase}=require('../community-database.cjs');
  const {applyMigrations}=await import('../../apps/api/src/migrations.mjs');
  const {PostgresSocialRepository}=await import('../../apps/api/src/social-repository.mjs');
  const {createSocialService}=await import('../../apps/api/src/social-service.mjs');
  const {createApp}=await import('../../apps/api/src/app.mjs');
  const database=await createCommunityTestDatabase(databaseUrl),pool=database.pool;let app;
  t.after(async()=>{await app?.close();await database.close();});
  assert.equal((await applyMigrations(pool,path.join(root,'apps/api/migrations'))).total,54);
  const ids=Array.from({length:65},()=>crypto.randomUUID());
  await pool.query(`INSERT INTO users(id,display_name,social_visibility,status)
    SELECT id,name,visibility,status FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,name text,visibility text,status text)`,
    [JSON.stringify(ids.map((id,i)=>({id,name:'玩家 '+i,visibility:i===61?'private':i===62?'followers':'public',status:i===63?'suspended':'active'})))]);
  const date='2026-10-08',puzzleId='test-main';
  await pool.query(`INSERT INTO guess_baike_results(user_id,puzzle_date,puzzle_id,hints,guessed_count,elapsed_seconds,completed_at)
    SELECT id,$2::date,$3,0,n,30,'2026-10-08T03:00:00Z'::timestamptz FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id,n)`,[ids,date,puzzleId]);
  // The last record belongs to another puzzle on the same day and cannot mix in.
  await pool.query("UPDATE guess_baike_results SET puzzle_id='test-other',guessed_count=0 WHERE user_id=$1",[ids[64]]);
  const service=createSocialService({repository:new PostgresSocialRepository(pool),clock:()=>new Date('2026-10-08T07:00:00Z')});
  const query={workId:'gamehub-guess-baike',date,puzzleId};
  const guest=await service.workLeaderboard(null,query);
  assert.equal(guest.total,61);assert.equal(guest.entries.length,10);assert.equal(guest.myEntry,null);assert.equal(guest.hasMore,true);
  assert.ok(guest.entries.every(row=>!row.player.isMe));assert.equal(guest.verification,'client_reported');
  const actor={userId:ids[60]},first=await service.workLeaderboard(actor,{...query,limit:50});
  assert.equal(first.myEntry.rank,61);assert.equal(first.myEntry.player.isMe,true);assert.equal(first.entries.length,50);
  const second=await service.workLeaderboard(actor,{...query,limit:50,offset:50});
  assert.equal(second.entries[0].rank,51);assert.equal(second.entries.length,11);assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.entries,...second.entries].map(row=>row.player.id)).size,61);
  for(const id of [ids[61],ids[62]]){
    const board=await service.workLeaderboard({userId:id},query);assert.equal(board.myEntry.rank,null);assert.equal(board.total,61);
    assert.ok(board.entries.every(row=>row.player.id!==id));
  }
  assert.equal((await service.workLeaderboard({userId:ids[63]},query)).myEntry,null);
  await pool.query('INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES($1,$2),($3,$1)',[actor.userId,ids[0],ids[1]]);
  const blocked=await service.workLeaderboard(actor,query);assert.equal(blocked.total,59);assert.equal(blocked.myEntry.rank,59);
  assert.equal(blocked.entries[0].player.id,ids[2]);assert.equal((await service.workLeaderboard(null,query)).total,61);
  assert.equal((await service.workLeaderboard(null,{...query,puzzleId:'test-other'})).total,1);
  assert.equal((await service.workLeaderboard(actor,{...query,date:'2026-10-07'})).myEntry,null);
  assert.equal((await service.workLeaderboard(null,{...query,date:'2026-10-07'})).total,0);
  for(const input of [{date:'2026-02-30'},{date:'2026-10-09'},{offset:-1},{limit:51},{puzzleId:''}])await assert.rejects(service.workLeaderboard(null,{...query,...input}),{code:'SCHEMA_INVALID'});
  await assert.rejects(service.workLeaderboard(null,{...query,workId:crypto.randomUUID()}),{code:'LEADERBOARD_NOT_SUPPORTED'});
  app=createApp({config:{requestBodyLimit:65536,corsOrigins:[]},socialService:service,authService:{authenticateBearer:async bearer=>{assert.equal(bearer,'Bearer owner');return actor;}}});
  const route='/v1/works/gamehub-guess-baike/leaderboard?date='+date+'&puzzleId='+puzzleId;
  const publicResponse=await app.inject({url:route});assert.equal(publicResponse.statusCode,200);assert.match(publicResponse.headers['cache-control'],/no-store/);
  assert.equal(publicResponse.json().data.myEntry,null);
  const own=await app.inject({url:route,headers:{authorization:'Bearer owner'}});assert.equal(own.json().data.myEntry.rank,59);
  for(const suffix of ['&limit=51','&offset=-1','&unknown=1'])assert.equal((await app.inject({url:route+suffix})).statusCode,400);
  assert.equal((await app.inject({url:'/v1/works/gamehub-unknown/leaderboard'})).statusCode,404);
  await pool.query("UPDATE guess_baike_results SET completed_at='2026-10-08T05:00:00Z' WHERE user_id=$1",[ids[64]]);
  assert.equal((await service.workLeaderboard(null,{workId:query.workId,date})).puzzleId,'test-other');
  const {PostgresGuessBaikeRepository}=await import('../../apps/api/src/guess-baike-repository.mjs');
  const {createGuessBaikeService}=await import('../../apps/api/src/guess-baike-service.mjs');
  await createGuessBaikeService({repository:new PostgresGuessBaikeRepository(pool)}).seedBuiltIns();
  const official=(await pool.query("SELECT id FROM guess_baike_puzzles WHERE status='ready' ORDER BY id LIMIT 1")).rows[0].id;
  await pool.query("UPDATE guess_baike_results SET puzzle_id=$1 WHERE puzzle_id='test-main'",[official]);
  await pool.query('INSERT INTO guess_baike_schedule(puzzle_date,puzzle_id,created_by_user_id) VALUES($1,$2,$3)',[date,official,actor.userId]);
  const scheduled=await service.workLeaderboard(null,{workId:query.workId,date});assert.equal(scheduled.puzzleId,official);assert.equal(scheduled.total,61);
  assert.ok((await pool.query("SELECT 1 FROM pg_indexes WHERE indexname='guess_baike_results_daily_board_idx'")).rowCount);
});
