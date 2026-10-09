const crypto=require('node:crypto');
exports.createGameShareFixture=async function(url,{siteOrigin='https://mooyu.fun',runtimePort=3092}={}){
  const base=await require('./work-edit-fixture.cjs').createWorkEditFixture(url);
  try {
    await base.app.close();const {pool,actors,workId,releaseId}=base;
    for(const actor of Object.values(actors)){actor.grantId=crypto.randomUUID();await pool.query("INSERT INTO device_grants(id,user_id,device_label,client_kind,authenticated_at,expires_at) VALUES($1,$2,'share fixture','browser',now(),now()+interval '1 hour')",[actor.grantId,actor.userId]);}
    await pool.query("UPDATE releases SET approved_capabilities=$2,entry_path='index.html' WHERE id=$1",[releaseId,JSON.stringify(['fileExport','shareLinks'])]);
    const {createGameSessionService}=await import('../apps/api/src/game-session-service.mjs'),{PostgresGameSessionRepository}=await import('../apps/api/src/game-session-repository.mjs');
    const sessions=createGameSessionService({repository:new PostgresGameSessionRepository(pool)});
    const {createGameShareService}=await import('../apps/api/src/game-share-service.mjs');const shares=createGameShareService({pool,gameSessionService:sessions,siteOrigin});
    const {PostgresCatalogRepository}=await import('../apps/api/src/catalog-repository.mjs'),{createCatalogService}=await import('../apps/api/src/catalog-service.mjs');
    const runtimeConfig={runtimeDomain:'localhost',runtimeScheme:'http',runtimePublicPort:runtimePort};const catalog=createCatalogService({repository:new PostgresCatalogRepository(pool),config:runtimeConfig});
    const {createApp}=await import('../apps/api/src/app.mjs'),{AuthError}=await import('../apps/api/src/auth-service.mjs');
    const app=createApp({config:{requestBodyLimit:65536},gameSessionService:sessions,gameShareService:shares,catalogService:catalog,authService:{authenticateBearer:async header=>{const actor=Object.values(actors).find(a=>header==='Bearer '+a.userId);if(!actor)throw new AuthError('AUTH_REQUIRED',401,'请先登录。');return actor;},getProfile:async actor=>actor.profile}});
    return {...base,app,sessions,shares,catalog,runtimeConfig,async session(actor=actors.owner,changes={}){return sessions.create(actor,{workId,releaseId,channel:'production',launchNonce:crypto.randomUUID(),...changes});},async close(){await app.close();await base.close();}};
  } catch(error){await base.close();throw error;}
};
