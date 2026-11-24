const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),h=require('./support/researcher-qa-db.cjs');
const {publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');

test('plugin assembled shared runtime: durable disable/resume, source QA, replay and chat without GitHub',{skip:!h.enabled,timeout:120000},async t=>{
 await publicPipelineFixture(t,{interactionExercise:async f=>{
  const {pool,agentId,operatorId,runtimeRepository}=f,load=h.load;
  const {githubAgentPlugin}=await load('agent-plugins/github/index.mjs');
  const {createGitHubToolConfiguration}=await load('agent-plugins/github/tools.mjs');
  const {createAgentPluginHost}=await load('agent-plugin-host.mjs');
  let network=0,models=0;const revision='a'.repeat(40);
  const fetchImpl=async url=>{
   network++;
   if(url.endsWith('/repos/owner/project'))return Response.json({private:false,full_name:'owner/project',default_branch:'main'});
   if(url.endsWith('/commits/main'))return Response.json({sha:revision});
   if(url.includes('/git/trees/'))return Response.json({tree:[{path:'src/index.ts',mode:'100644',type:'blob'}],truncated:false});
   assert.ok(url.endsWith('/contents/src/index.ts?ref='+revision),url);
   return new Response('export function unique(selector) {\n return document.querySelectorAll(selector).length === 1;\n}');
  };
  const pluginHost=createAgentPluginHost({definitions:[{...githubAgentPlugin,toolConfiguration:()=>createGitHubToolConfiguration({fetchImpl})}]});
  const repository=new (await load('agent-interaction-repository.mjs')).PostgresAgentInteractionRepository(pool);
  await (await load('agent-interaction-bootstrap.mjs')).bootstrapAgentInteractions({repository,runtimeRepository,agentId,pluginHost});
  const service=(await load('agent-interaction-service.mjs')).createAgentInteractionService({repository,agentId,pluginHost});
  const env={AGENT_INTERACTIONS_ENABLED:'true',AGENT_INTERACTIONS_AGENT_USER_ID:agentId,AGENT_SECRET_ENCRYPTION_KEY:'cd'.repeat(32),AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:agentId,AGENT_BLOG_PUBLIC_RUNTIME_MODEL_ID:'fixture-blog',AGENT_GITHUB_RESEARCH_TOKEN:'fixture-token-not-real-123456',PAPER_STUDY_ENABLED:'false'};
  const adapter=async request=>{
   models++;const payload=JSON.parse(request.request.messages[1].content);
   const output=request.responseSchema.key==='agent.github.question-plan'?{files:payload.alreadyRead?[]:[{path:'src/index.ts',fromLine:1}]}:{claims:[{kind:'code-fact',text:'通过命中元素数量等于一来确认唯一性。',references:[{source:1,fromLine:1,toLine:3}]}],limitations:['没有运行项目。']};
   return {output:JSON.stringify(output),providerRequestId:'plugin-fixture-'+models,usage:{inputTokens:100,outputTokens:100},responseRef:{finishReason:'stop'}};
  };
  const createRuntime=(await load('agent-interaction-runtime.mjs')).createAgentInteractionRuntime;
  const execution=createRuntime({env,pool,service,adapter});t.after(()=>execution.close());
  const id=crypto.randomUUID(),origin={channel:'web',actorRef:operatorId,platformUserId:operatorId,conversationRef:crypto.randomUUID(),eventRef:id};
  const accepted=await service.receive(origin,{requestId:id,message:'解释唯一性检查，不写文章。'}),parent=await repository.claim(agentId,'message');assert.equal(parent.id,accepted.id);
  const queued=await (await service.tools(parent)).execute(null,'github_answer_question',{repositoryUrl:'https://github.com/owner/project',question:'如何检查唯一性？'});
  await repository.settle(parent,{result:{reply:queued.reply,task:queued.task}});
  const before=await repository.get(queued.task.id);assert.deepEqual(before.input_json.plugin,{id:'mooyu.github',version:'1.0.0'});
  pluginHost.setEnabled('mooyu.github',false);
  assert.equal((await execution.worker.tick('task')).code,'AGENT_PLUGIN_DISABLED');
  assert.equal((await repository.get(before.id)).state,'waiting');assert.equal(network,0);assert.equal(models,0);
  assert.ok(!(await service.tools(parent)).descriptions.some(d=>d.name==='github_answer_question'));
  assert.equal((await service.status(origin,parent.id)).state,'completed');
  pluginHost.setEnabled('mooyu.github',true);
  await pool.query('UPDATE agent_interactions SET next_attempt_at=now() WHERE id=$1',[before.id]);
  const bound=pluginHost.bindRuntime({core:execution.runtime,env,repository,service});
  const replayWorker=(await load('agent-interaction-worker.mjs')).createAgentInteractionWorker({repository,service,agentId,taskExecutor:async row=>{
   const result=await bound.executeTask(row),counts={network,models};
   assert.deepEqual(await bound.executeTask(row),result);assert.deepEqual({network,models},counts);
   // A pre-plugin row retains its exact legacy implementation and durable run.
   const legacy={...row,input_json:{...row.input_json}};delete legacy.input_json.plugin;
   assert.deepEqual(await bound.executeTask(legacy),result);assert.deepEqual({network,models},counts);
   return result;
  }});
  assert.equal((await replayWorker.tick('task')).completed,true);await bound.close();
  const done=await repository.get(before.id);assert.equal(done.state,'completed');assert.match(done.result_json.reply,/#L1-L3/);assert.deepEqual(done.input_json,before.input_json);assert.equal(models,3);
  const counts={network,models};assert.equal((await execution.worker.tick('task')).idle,true);
  assert.equal((await service.status(origin,done.id)).reply,done.result_json.reply);
  assert.deepEqual({network,models},counts);
  await execution.close();assert.equal((await pool.query('SELECT 1 AS n')).rows[0].n,1);
  // GitHub disabled at startup: no adapters/configuration/legacy article runtime are required.
  const disabled=createAgentPluginHost({definitions:[{...githubAgentPlugin,toolConfiguration(){assert.fail('disabled plugin loaded');}}],activePlugins:[]});
  const chatService=(await load('agent-interaction-service.mjs')).createAgentInteractionService({repository,agentId,pluginHost:disabled});
  let chatCalls=0;
  const chat=createRuntime({env:{AGENT_INTERACTIONS_ENABLED:'true',AGENT_INTERACTIONS_AGENT_USER_ID:agentId,AGENT_SECRET_ENCRYPTION_KEY:'cd'.repeat(32)},pool,service:chatService,adapter:async()=>{chatCalls++;return {output:JSON.stringify({reply:'你好，我是小墨鱼。'}),providerRequestId:'plugin-disabled-chat',usage:{inputTokens:100,outputTokens:50},responseRef:{finishReason:'stop'}};}});
  assert.ok((await chatService.tools(parent)).descriptions.some(d=>d.name==='get_agent_work'));assert.equal((await chatService.capabilities()).paperEnabled,false);
  const chatId=crypto.randomUUID();await chatService.receive({...origin,eventRef:chatId},{requestId:chatId,message:'你好'});
  assert.equal((await chat.worker.tick('message')).completed,true);assert.equal(chatCalls,1);assert.equal(network,counts.network);
  await chat.close();
  // The widened task protocol executes a newly registered kind without a core branch.
  const extra={manifest:{schemaVersion:'agent-plugin-v1',id:'test.echo',version:'1.0.0',hostApiVersion:1,kind:'capability',displayName:'Echo fixture',defaultEnabled:true,dependencies:[],capabilities:[],tools:['echo_fixture'],backendTools:[],taskKinds:[{kind:'echo-fixture',requiresInvoke:false}],workflows:[],publicCapabilities:[],legacyTaskKinds:[]},descriptions:[{name:'echo_fixture',arguments:{},purpose:'fixture'}],workflows:[],toolContracts:[],admit:async()=>({kind:'echo-fixture',value:'immutable fixture'}),executeTask:async row=>({reply:row.input_json.value})};
  const extraHost=createAgentPluginHost({definitions:[extra]}),extraService=(await load('agent-interaction-service.mjs')).createAgentInteractionService({repository,agentId,pluginHost:extraHost});
  const extraTask=await (await extraService.tools(parent)).execute(null,'echo_fixture',{}),extraRuntime=extraHost.bindRuntime({});
  const extraWorker=(await load('agent-interaction-worker.mjs')).createAgentInteractionWorker({repository,service:extraService,agentId,taskExecutor:extraRuntime.executeTask});
  assert.equal((await extraWorker.tick('task')).completed,true);assert.equal((await repository.get(extraTask.task.id)).result_json.reply,'immutable fixture');await extraRuntime.close();
  const missing=await repository.accept({agentId,origin:{...origin,eventRef:crypto.randomUUID()},kind:'github-question',input:{kind:'github-question',plugin:{id:'mooyu.github',version:'9.0.0'},topic:'retained task'}});
  assert.equal((await execution.worker.tick('task')).code,'AGENT_PLUGIN_VERSION_UNAVAILABLE');assert.equal((await repository.get(missing.id)).state,'waiting');assert.deepEqual({network,models},counts);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[agentId])).rows[0].n,0);
 }});
});
