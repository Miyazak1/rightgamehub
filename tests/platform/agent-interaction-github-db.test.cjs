const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),h=require('./support/researcher-qa-db.cjs');
const {publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');
for(const mode of ['search','draft','draft-topic','draft-invalid','published','inspect'])test('shared Agent GitHub '+mode+' uses existing workflows and replays its real receipt',{skip:!h.enabled,timeout:120000},async t=>{
 const draft=mode.startsWith('draft');
 await publicPipelineFixture(t,{compositionCitationRepair:!draft,compositionSchemaFailures:draft?(mode==='draft-invalid'?2:1):0,interactionExercise:async fixture=>{
  const {pool,agentId,operatorId,config}=fixture;
  const {PostgresAgentInteractionRepository}=await h.load('agent-interaction-repository.mjs'),repository=new PostgresAgentInteractionRepository(pool);
  const {bootstrapAgentInteractions}=await h.load('agent-interaction-bootstrap.mjs');await bootstrapAgentInteractions({repository,runtimeRepository:fixture.runtimeRepository,agentId});
  const {PostgresAgentBlogPublicScheduleRepository}=await h.load('agent-blog-public-schedule.mjs'),schedule=new PostgresAgentBlogPublicScheduleRepository(pool);
  await schedule.ensureDaily({agentUserId:agentId,enabled:false});await schedule.heartbeat({agentUserId:agentId,instanceId:crypto.randomUUID()});
  const original=(await pool.query('SELECT topic_scope FROM agent_blog_automation_settings WHERE agent_user_id=$1',[agentId])).rows[0].topic_scope;
  const {createAgentInteractionService}=await h.load('agent-interaction-service.mjs'),service=createAgentInteractionService({repository,agentId});
  const requestId=crypto.randomUUID(),origin={channel:'web',actorRef:operatorId,platformUserId:operatorId,conversationRef:crypto.randomUUID(),eventRef:requestId};
  const accepted=await service.receive(origin,{requestId,message:draft?'帮我写 GitHub 项目文章，只保存草稿，不要发布。':'研究有趣实用的开放工具'}),parent=await repository.get(accepted.id);
  const args={topic:'发现有趣实用且适合快速体验的开放工具',...(draft?{publication:'draft'}:{}),...(['draft','draft-invalid','inspect'].includes(mode)?{repositoryUrl:'https://github.com/owner/project'}:{})};
  const tools=await service.tools(parent),queued=await tools.execute(null,['search','inspect'].includes(mode)?'github_search_projects':'github_write_article',args);
  const task=await repository.claim(agentId,'task');assert.equal(task.id,queued.task.id);
  const {createAgentGitHubInteractionExecutor}=await h.load('agent-interaction-github.mjs'),execute=createAgentGitHubInteractionExecutor({repository,service,runtime:{config,interactionPorts:fixture}});
  if(mode==='draft-invalid'){
   await assert.rejects(execute(task),error=>error.details?.stageErrorCode==='AGENT_BLOG_COMPOSITION_SCHEMA_INVALID');assert.equal(fixture.providerCalls(),3);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM blog_articles WHERE author_user_id=$1',[agentId])).rows[0].n,0);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_provider_output_artifacts output JOIN agent_run_actions action ON action.id=output.action_id JOIN agent_runs run ON run.id=action.run_id WHERE run.agent_user_id=$1 AND output.schema_key='blog.article.composition-attempt'",[agentId])).rows[0].n,2);return;
  }
  let result;try{result=await execute(task);}catch(error){console.error(JSON.stringify({mode,code:error.code,details:error.details,stages:(await pool.query('SELECT stage_key,status,error_code,error_message FROM agent_run_stages WHERE run_id IN (SELECT id FROM agent_runs WHERE agent_user_id=$1)',[agentId])).rows}));throw error;}assert.ok(result.reply.length>10);
  if(mode==='search')assert.equal(result.repositories.length,1);
  if(mode==='inspect')assert.equal(result.repository.url,'https://github.com/owner/project');
  if(draft){assert.equal(result.publicationState,'draft');const attempts=(await pool.query("SELECT output.content_json FROM agent_provider_output_artifacts output JOIN agent_run_actions action ON action.id=output.action_id JOIN agent_runs run ON run.id=action.run_id WHERE run.agent_user_id=$1 AND output.schema_key='blog.article.composition-attempt' ORDER BY output.created_at",[agentId])).rows;assert.deepEqual(attempts.map(r=>r.content_json.accepted),[false,true]);}
  if(mode==='published')assert.equal(result.publicationState,'published');
  const calls=fixture.providerCalls();assert.deepEqual(await execute(task),result);assert.equal(fixture.providerCalls(),calls);
  await repository.settle(task,{result});
  const requests=new (await h.load('agent-blog-public-request-repository.mjs')).PostgresAgentBlogPublicRequestRepository(pool);
  assert.equal(await requests.pending(agentId),null);
  const preflight=await fixture.preflightRepository.snapshot(config);assert.equal(preflight.awaitingHandoff,0);
  const rows=(await pool.query('SELECT publication_state FROM blog_articles WHERE author_user_id=$1',[agentId])).rows;
  assert.deepEqual(rows.map(r=>r.publication_state),draft?['draft']:mode==='published'?['published']:[]);
  assert.equal((await pool.query('SELECT topic_scope FROM agent_blog_automation_settings WHERE agent_user_id=$1',[agentId])).rows[0].topic_scope,original);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE $2',[agentId,'paper.%'])).rows[0].n,0);
 }});
});
