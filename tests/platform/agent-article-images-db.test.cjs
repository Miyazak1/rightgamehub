const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),h=require('./support/researcher-qa-db.cjs');
const {publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');
test('real draft revision, signed image API and durable paginated QQ delivery preserve permissions and recover safely',{skip:!h.enabled,timeout:120000},async t=>{
 await publicPipelineFixture(t,{compositionCitationRepair:false,interactionExercise:async f=>{
  const {pool,agentId,operatorId}=f,load=h.load;
  const repository=new (await load('agent-interaction-repository.mjs')).PostgresAgentInteractionRepository(pool);
  await (await load('agent-interaction-bootstrap.mjs')).bootstrapAgentInteractions({repository,runtimeRepository:f.runtimeRepository,agentId});
  await repository.configureParticipant({userId:operatorId,profile:{role:'admin'}},agentId,{channel:'qq',actorRef:'495469022',canInvoke:true,expectedRevision:0});
  let enabled=true;const service=(await load('agent-interaction-service.mjs')).createAgentInteractionService({repository,agentId,readQQPolicy:async()=>({agentId,botId:'3922489710',groupId:'905757031',allowedUsers:['495469022'],enabled})});
  const schedule=new (await load('agent-blog-public-schedule.mjs')).PostgresAgentBlogPublicScheduleRepository(pool);await schedule.ensureDaily({agentUserId:agentId,enabled:false});await schedule.heartbeat({agentUserId:agentId,instanceId:crypto.randomUUID()});
  const plan=(await pool.query('SELECT topic_scope FROM agent_blog_automation_settings WHERE agent_user_id=$1',[agentId])).rows[0].topic_scope;
  const origin={channel:'qq',botId:'3922489710',groupId:'905757031',actorRef:'495469022',conversationRef:'3922489710:905757031:495469022',eventRef:'42'};
  const accepted=await service.receive(origin,{requestId:crypto.randomUUID(),message:'请写中文文章，只存草稿，不要发布'}),parent=await repository.claim(agentId,'message');
  const queued=await (await service.tools(parent)).execute(null,'github_write_article',{topic:'适合学生的开源工具',repositoryUrl:'https://github.com/owner/project',publication:'draft'});await repository.settle(parent,{result:{reply:queued.reply,task:queued.task}});
  const task=await repository.claim(agentId,'task'),execute=(await load('agent-interaction-github.mjs')).createAgentGitHubInteractionExecutor({repository,service,runtime:{config:f.config,interactionPorts:f}}),result=await execute(task);assert.ok(result.articleRevisionId);await repository.settle(task,{result});
  const beforeCalls=f.providerCalls(),page0=await service.articleImage(origin,task.id,0);assert.ok(page0.pageCount>1);assert.equal(page0.revisionId,result.articleRevisionId);
  await assert.rejects(service.articleImage({...origin,actorRef:'123456789'},task.id,0));
  enabled=false;await assert.rejects(service.articleImage(origin,task.id,0),{code:'AGENT_INTERACTION_CHANNEL_DENIED'});enabled=true;
  const {createRequire}=require('node:module'),requireApi=createRequire(require('node:path').resolve('apps/api/package.json')),app=requireApi('fastify')();t.after(()=>app.close());
  (await load('agent-interaction-routes.mjs')).registerAgentInteractionRoutes(app,{service,requireAuth:async()=>{},channelSecret:'ab'.repeat(32)});
  const {QQAgentBridge,createQQAgentClient}=await import('../../apps/qq-channel/src/agent-bridge.mjs');
  let imageRequests=0;const client=createQQAgentClient({url:'http://127.0.0.1:12345',secret:'ab'.repeat(32),agentId,fetchImpl:async(_url,options)=>{if(JSON.parse(options.body).operation==='article-image')imageRequests++;const response=await app.inject({method:'POST',url:'/v1/internal/agent/qq',headers:options.headers,payload:options.body});return new Response(response.body,{status:response.statusCode});}});
  const database='mooyu_qq_local_test_'+crypto.randomBytes(8).toString('hex'),url=new URL(process.env.QA_LEDGER_TEST_URL);await pool.query('CREATE DATABASE '+database);url.pathname='/'+database;
  const qqPool=new pool.constructor({connectionString:url.href});t.after(()=>qqPool.end());
  const {parseConfig}=await import('../../apps/qq-channel/src/config.mjs'),{QQRepository}=await import('../../apps/qq-channel/src/repository.mjs'),{QQService}=await import('../../apps/qq-channel/src/service.mjs');
  const config=parseConfig({enabled:true,botId:origin.botId,groupId:origin.groupId,allowedUsers:[origin.actorRef]},{QQ_DATABASE_URL:url.href,QQ_ACCESS_TOKEN:'isolated-image-token-'.repeat(3)});
  let repo=new QQRepository(qqPool,config);await repo.initialize();await repo.enableControl();await repo.enableAgentBridge();
  // Attach the real completed task to an isolated transport request; no extra model call.
  await qqPool.query("INSERT INTO mooyu_qq.messages(channel_id,message_id,user_id,input_text,fingerprint,status,reply,origin_group_id) VALUES($1,'42',$2,'write article','fixture','delivered','accepted',$3)",[config.channelId,origin.actorRef,origin.groupId]);
  await qqPool.query("INSERT INTO mooyu_qq.agent_links(channel_id,message_id,request_id,interaction_id,task_id) VALUES($1,'42',$2,$3,$4)",[config.channelId,crypto.randomUUID(),accepted.id,task.id]);
  const sent=[],gateway={connected:()=>true,send:async row=>{assert.ok(Buffer.isBuffer(row.image_data));sent.push(row);return String(500+sent.length);}};
  const make=()=>new QQService({config,repository:repo,bridge:new QQAgentBridge({repository:repo,client}),gateway});let worker=make();await worker.tick();assert.equal(sent.length,1);assert.equal(imageRequests,page0.pageCount);
  // Reconstruct the worker/repository after page one: queued bytes and ordering survive.
  repo=new QQRepository(qqPool,config);await repo.enableControl();await repo.enableAgentBridge();worker=make();
  for(let i=1;i<page0.pageCount;i++)assert.equal((await worker.tick()).delivered,true);
  await worker.tick();assert.equal(sent.length,page0.pageCount);assert.equal(imageRequests,page0.pageCount);assert.equal(f.providerCalls(),beforeCalls);
  const pages=(await qqPool.query('SELECT p.page_no,p.revision_id,m.status FROM mooyu_qq.agent_image_pages p JOIN mooyu_qq.messages m USING(channel_id,message_id) ORDER BY p.page_no')).rows;
  assert.deepEqual(pages.map(p=>p.page_no),Array.from({length:page0.pageCount},(_,i)=>i));assert.ok(pages.every(p=>p.revision_id===result.articleRevisionId&&p.status==='delivered'));
  const bridge=new QQAgentBridge({repository:repo,client});await repo.locked(async c=>{await bridge.poll(c,config);});assert.equal(sent.length,page0.pageCount);
  // An uncertain earlier page prevents later pages from becoming eligible.
  await qqPool.query("UPDATE mooyu_qq.messages SET status='needs-review' WHERE channel_id=$1 AND message_id=$2",[config.channelId,sent[0].message_id]);
  await qqPool.query("UPDATE mooyu_qq.messages SET status='ready',remote_message_id=NULL WHERE channel_id=$1 AND message_id=$2",[config.channelId,sent[1].message_id]);
  assert.equal((await worker.tick()).idle,true);assert.equal(sent.length,page0.pageCount);
  await qqPool.query("UPDATE mooyu_qq.messages SET status='delivered' WHERE channel_id=$1 AND message_id=$2",[config.channelId,sent[0].message_id]);
  // Removing writing authority after enqueue blocks image disclosure before send intent.
  await repository.configureParticipant({userId:operatorId,profile:{role:'admin'}},agentId,{channel:'qq',actorRef:origin.actorRef,canInvoke:false,expectedRevision:1});
  assert.equal((await worker.tick()).imageAccessBlocked,true);assert.equal(sent.length,page0.pageCount);
  assert.equal((await pool.query('SELECT topic_scope FROM agent_blog_automation_settings WHERE agent_user_id=$1',[agentId])).rows[0].topic_scope,plan);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[agentId])).rows[0].n,0);
 }});
});
