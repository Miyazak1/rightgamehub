const crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises'),{Readable}=require('node:stream');
exports.createCompetitionFixture=async function(databaseUrl){
  const {createCommunityTestDatabase}=require('./community-database.cjs');
  const db=await createCommunityTestDatabase(databaseUrl),pool=db.pool;
  try{
  const {applyMigrations}=await import('../apps/api/src/migrations.mjs');
  await applyMigrations(pool,path.resolve(__dirname,'../apps/api/migrations'));
  const {PostgresUploadRepository}=await import('../apps/api/src/upload-repository.mjs');
  const {createUploadService}=await import('../apps/api/src/upload-service.mjs');
  const {PostgresValidationRepository}=await import('../apps/api/src/validation-repository.mjs');
  const {createValidationWorker}=await import('../apps/api/src/validation-worker.mjs');
  const {LocalQuarantineStore}=await import('../apps/api/src/local-object-store.mjs');
  const {LocalRuntimeStore}=await import('../apps/api/src/local-runtime-store.mjs');
  const {createGameSessionService}=await import('../apps/api/src/game-session-service.mjs');
  const {PostgresGameSessionRepository}=await import('../apps/api/src/game-session-repository.mjs');
  const {createCompetitionService}=await import('../apps/api/src/competition-service.mjs');
  const directory=path.resolve(__dirname,'../.runtime/competition-fixtures/'+crypto.randomUUID());await fs.mkdir(directory,{recursive:true});
  const actor={userId:crypto.randomUUID(),grantId:crypto.randomUUID(),scopes:['upload','works:write','works:read'],profile:{role:'admin',canPublish:true}};
  await pool.query("INSERT INTO users(id,display_name,social_visibility) VALUES($1,'接入验收玩家','public')",[actor.userId]);
  await pool.query('INSERT INTO creator_usage(user_id) VALUES($1) ON CONFLICT DO NOTHING',[actor.userId]);
  await pool.query("INSERT INTO device_grants(id,user_id,device_label,client_kind,authenticated_at,expires_at) VALUES($1,$2,'competition fixture','browser',now(),now()+interval '1 day')",[actor.grantId,actor.userId]);
  const quarantineStore=new LocalQuarantineStore(path.join(directory,'quarantine')),runtimeStore=new LocalRuntimeStore(path.join(directory,'runtime'));
  const upload=createUploadService({repository:new PostgresUploadRepository(pool),objectStore:quarantineStore});
  const worker=createValidationWorker({repository:new PostgresValidationRepository(pool),quarantineStore,runtimeStore,validatorRoot:path.join(directory,'validator')});
  const sessions=createGameSessionService({repository:new PostgresGameSessionRepository(pool)}),competition=createCompetitionService({pool,gameSessionService:sessions});
  return {database:db,uploadService:upload,validationWorker:worker,pool,actor,directory,runtimeStore,sessions,competition,async close(){await db.close();},async publish(bytes,title='创作者游戏'){
    const workId=crypto.randomUUID();await pool.query("INSERT INTO works(id,owner_user_id,title,kind) VALUES($1,$2,$3,'game')",[workId,actor.userId,title]);
    const job=await upload.create(actor,workId,{targetKey:'web',packageType:'web_zip',fileName:'game.zip',releaseLabel:'competition-v1',declaredBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),autoPublish:true},crypto.randomUUID());
    const grant=await upload.grant(actor,job.id);await upload.receive(job.id,'Upload '+grant.token,Readable.from([bytes]));await upload.complete(actor,job.id,crypto.randomUUID());
    const release=await worker.runOnce({targetUploadId:job.id});return {...release,workId};
  }};
  }catch(error){await db.close();throw error;}
};
