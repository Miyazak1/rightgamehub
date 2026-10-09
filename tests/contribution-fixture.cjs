const crypto=require('node:crypto'),path=require('node:path');
exports.createContributionFixture=async function(url){
  const {createCommunityTestDatabase}=require('./community-database.cjs');
  const db=await createCommunityTestDatabase(url),pool=db.pool;
  try{
    const {applyMigrations}=await import('../apps/api/src/migrations.mjs');
    await applyMigrations(pool,path.resolve(__dirname,'../apps/api/migrations'));
    const {PostgresContributionTaskRepository,createContributionTaskService}=await import('../apps/api/src/contribution-task-service.mjs');
    const {PostgresCreatorFeedbackRepository,createCreatorFeedbackService}=await import('../apps/api/src/creator-feedback-service.mjs');
    const {PostgresPublicProfileRepository}=await import('../apps/api/src/public-profile-repository.mjs');
    const {createPublicProfileService}=await import('../apps/api/src/public-profile-service.mjs');
    const {createApp}=await import('../apps/api/src/app.mjs');
    const {AuthError}=await import('../apps/api/src/auth-service.mjs');
    const actors={};
    for(const name of ['owner','contributor','stranger']){
      const userId=crypto.randomUUID(),handle='t'+userId.replaceAll('-','').slice(0,12);
      const profile={id:userId,handle,displayName:name==='owner'?'像素作者':name==='contributor'?'共建玩家':'另一玩家',canPublish:name==='owner',role:'user'};
      await pool.query("INSERT INTO users(id,display_name,can_publish,social_visibility,profile_handle) VALUES($1,$2,$3,'public',$4)",[userId,profile.displayName,profile.canPublish,handle]);
      actors[name]={userId,scopes:['works:read','profile:read'],profile};
    }
    const workId=crypto.randomUUID(),releaseId=crypto.randomUUID();
    await pool.query("INSERT INTO works(id,owner_user_id,title,kind,state,visibility,repository_url,license_spdx) VALUES($1,$2,'共建测试游戏','game','published','public','https://github.com/example/task-game','MIT')",[workId,actors.owner.userId]);
    await pool.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published')",[workId]);
    await pool.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state) VALUES($1,$2,'web','v1.1','web_zip','ready','enabled')",[releaseId,workId]);
    await pool.query("UPDATE work_targets SET current_release_id=$2 WHERE work_id=$1",[workId,releaseId]);
    const repository=new PostgresContributionTaskRepository(pool),service=createContributionTaskService({repository});
    const feedback=createCreatorFeedbackService({repository:new PostgresCreatorFeedbackRepository(pool)});
    const profiles=createPublicProfileService({repository:new PostgresPublicProfileRepository(pool)});
    const app=createApp({config:{requestBodyLimit:65536},database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},
      authService:{authenticateBearer:async authorization=>{const id=authorization?.replace(/^Bearer /,'');const actor=Object.values(actors).find(a=>a.userId===id);if(!actor)throw new AuthError('AUTH_REQUIRED',401,'请先登录。');return actor;}},
      contributionTaskService:service,creatorFeedbackService:feedback,publicProfileService:profiles});
    return {db,pool,actors,workId,releaseId,repository,service,feedback,profiles,app,
      async draft(){
        const f=await feedback.submit(actors.contributor,workId,{category:'bug',summary:'触屏按钮没有对齐',details:'使用手机竖屏时按钮发生重叠，需要修复并验证窄屏。'});
        await feedback.update(actors.owner,f.id,{action:'review'});
        return service.createFromFeedback(actors.owner,f.id,{title:'修复触屏按钮的对齐',description:'修复手机竖屏下按钮重叠的问题，并验证横屏和桌面布局都正常。',difficulty:'starter',skills:['CSS']});
      },
      async close(){await app.close();await db.close();}
    };
  }catch(e){await db.close();throw e;}
};
