const crypto=require('node:crypto');
const path=require('node:path');

exports.createProjectClaimFixture=async function(databaseUrl){
  const {createCommunityTestDatabase}=require('./community-database.cjs');
  const database=await createCommunityTestDatabase(databaseUrl),{pool}=database;
  try{
    const {applyMigrations}=await import('../apps/api/src/migrations.mjs');
    const {PostgresProjectClaimRepository,createProjectClaimService}=await import('../apps/api/src/project-claim-service.mjs');
    const {createApp}=await import('../apps/api/src/app.mjs');
    const {AuthError}=await import('../apps/api/src/auth-service.mjs');
    await applyMigrations(pool,path.resolve(__dirname,'../apps/api/migrations'));
    const actors={
      admin:{userId:crypto.randomUUID(),scopes:['works:read','works:write'],profile:{role:'admin',canPublish:true,displayName:'目录管理员',profileHandle:'catalog-admin'}},
      claimant:{userId:crypto.randomUUID(),scopes:['works:read','works:write'],profile:{role:'user',canPublish:true,displayName:'原游戏作者',profileHandle:'original-maker'}},
    };
    for(const actor of Object.values(actors)){
      await pool.query("INSERT INTO users(id,display_name,role,can_publish,profile_handle) VALUES($1,$2,$3,true,$4)",[actor.userId,actor.profile.displayName,actor.profile.role,actor.profile.profileHandle]);
      await pool.query('INSERT INTO creator_usage(user_id) VALUES($1)',[actor.userId]);
    }
    const workId=crypto.randomUUID();
    await pool.query("INSERT INTO works(id,owner_user_id,title,description,kind,state,visibility,revision,attribution_kind) VALUES($1,$2,'可认领的开源小游戏','平台依据公开页面代为收录。','game','published','public',1,'community_catalog')",[workId,actors.admin.userId]);
    await pool.query('UPDATE creator_usage SET work_count=1 WHERE user_id=$1',[actors.admin.userId]);
    const repository=new PostgresProjectClaimRepository(pool),service=createProjectClaimService({repository});
    const app=createApp({
      config:{requestBodyLimit:65536,corsOrigins:[],cloudSaveEnabled:false},
      database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},projectClaimService:service,
      authService:{authenticateBearer:async authorization=>{
        const userId=String(authorization??'').replace(/^Bearer /,'');
        const actor=Object.values(actors).find(item=>item.userId===userId);
        if(!actor)throw new AuthError('AUTH_REQUIRED',401,'请先登录。');
        return actor;
      }},
    });
    return {database,pool,actors,workId,repository,service,app,
      async createPendingClaim(){
        return service.submit(actors.claimant,workId,{evidenceType:'website',evidenceUrl:'https://example.com/original-maker/game',relationship:'owner',note:'我是原游戏作者，这个公开页面列出了我的署名。'});
      },
      async close(){await app.close();await database.close();},
    };
  }catch(error){await database.close();throw error;}
};
