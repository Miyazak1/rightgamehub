const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),h=require('./support/researcher-qa-db.cjs'),{publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');
test('release bootstrap retains enabled schedules, grants, policy, budgets and historical requests',{skip:!h.enabled,timeout:120000},async t=>{
 await publicPipelineFixture(t,{interactionExercise:async({pool,agentId,operatorId,runtimeRepository})=>{
  const {PostgresAgentInteractionRepository}=await h.load('agent-interaction-repository.mjs'),repository=new PostgresAgentInteractionRepository(pool),{bootstrapAgentInteractions}=await h.load('agent-interaction-bootstrap.mjs');
  const {PostgresAgentBlogPublicScheduleRepository}=await h.load('agent-blog-public-schedule.mjs');await new PostgresAgentBlogPublicScheduleRepository(pool).ensureDaily({agentUserId:agentId,enabled:true});
  await repository.configureParticipant({userId:operatorId,profile:{role:'admin'}},agentId,{channel:'qq',actorRef:'300000001',canInvoke:true,expectedRevision:0});
  const requestId=randomUUID(),history=await repository.accept({agentId,origin:{channel:'web',actorRef:operatorId,platformUserId:operatorId,conversationRef:randomUUID(),eventRef:requestId},input:{requestId,message:'historical fixture request'}});
  await pool.query("UPDATE agent_interactions SET state='completed',result_json=$2 WHERE id=$1",[history.id,JSON.stringify({reply:'historical fixture response'})]);
  const tables=['agent_schedules','agent_channel_participants','agent_policy_profiles','agent_capability_grants','agent_budget_reservations','agent_interactions','blog_articles'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await pool.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS hash FROM ${table} t`)).rows[0].hash])));
  const before=await snapshot();await bootstrapAgentInteractions({repository,runtimeRepository,agentId});await bootstrapAgentInteractions({repository,runtimeRepository,agentId});assert.deepEqual(await snapshot(),before);assert.equal((await pool.query('SELECT bool_and(enabled) AS enabled FROM agent_schedules WHERE agent_user_id=$1',[agentId])).rows[0].enabled,true);
  if(process.env.MOOYU_RELEASE_PROOF_DIR)fs.writeFileSync(process.env.MOOYU_RELEASE_PROOF_DIR+'/rollback-data-preservation.json',JSON.stringify({result:'PASSED',tables:before,historicalRequestId:history.id,enabledSchedulePreserved:true,grantsPreserved:true,budgetPreserved:true,bootstrapIdempotent:true,paperEnabled:false},null,2));
 }});
});
