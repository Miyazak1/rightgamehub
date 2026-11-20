const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),h=require('./support/researcher-qa-db.cjs');
const {publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');
for(const mode of ['answer','refine','invalid-citation','empty-evidence','v1-recovery'])test('GitHub question real gateways '+mode,{skip:!h.enabled,timeout:120000},async t=>{
 await publicPipelineFixture(t,{interactionExercise:async f=>{
  const {pool,agentId,operatorId,runtimeRepository,artifactRepository}=f,load=h.load;
  const {PostgresAgentInteractionRepository}=await load('agent-interaction-repository.mjs'),repository=new PostgresAgentInteractionRepository(pool);
  await (await load('agent-interaction-bootstrap.mjs')).bootstrapAgentInteractions({repository,runtimeRepository,agentId});
  const {createAgentRuntimePolicyService}=await load('agent-runtime-policy-service.mjs'),policyService=createAgentRuntimePolicyService({pool});
  const {createAgentToolGateway}=await load('agent-tool-gateway.mjs'),{PostgresAgentToolGatewayRepository}=await load('agent-tool-gateway-repository.mjs'),code=await load('agent-github-code-tool.mjs'),question=await load('agent-github-question.mjs');
  let network=0,models=0;const revision='a'.repeat(40),fetchImpl=async(url)=>{
   network++;if(url.endsWith('/repos/owner/project'))return Response.json({private:false,full_name:'owner/project',default_branch:'main'});
   if(url.endsWith('/commits/main'))return Response.json({sha:revision});
   if(url.includes('/git/trees/'))return Response.json({tree:[{path:'src/index.ts',mode:'100644',type:'blob'}],truncated:false});
   assert.ok(url.endsWith('/contents/src/index.ts?ref='+revision));const body='export function unique(selector) {\n return document.querySelectorAll(selector).length === 1;\n}';return new Response(mode==='refine'?['unique(candidate);',...Array(198).fill('// filler'),body].join('\n'):body);
  };
  const toolGateway=createAgentToolGateway({runtimeRepository,toolRepository:new PostgresAgentToolGatewayRepository(pool),policyService,adapters:{'research.github.code.read@1':code.createGitHubCodeAdapter({fetchImpl})},inputSchemas:{'github.code.input@1':code.validateGitHubCodeInput},outputSchemas:{'github.code.output@1':code.validateGitHubCodeOutput}});
  const {createAgentProviderGateway}=await load('agent-provider-gateway.mjs'),{PostgresAgentProviderGatewayRepository}=await load('agent-provider-gateway-repository.mjs'),{createAgentSecretVault}=await load('agent-secret-vault.mjs');
  const providerGateway=createAgentProviderGateway({runtimeRepository,governanceRepository:new PostgresAgentProviderGatewayRepository(pool),policyService,secretVault:createAgentSecretVault({masterKey:'cd'.repeat(32)}),responseSchemas:question.GITHUB_QUESTION_SCHEMAS,adapters:{deepseek:async request=>{
   models++;const payload=JSON.parse(request.request.messages[1].content),refining=!!payload.alreadyRead;
   const output=request.responseSchema.key==='agent.github.question-plan'?{files:mode==='empty-evidence'||refining&&mode!=='refine'?[]:[{path:'src/index.ts',fromLine:refining?200:1}]}:mode==='empty-evidence'?{claims:[],limitations:['没有定位到相关源码，无法确认实现。']}:{claims:[{kind:'code-fact',text:'通过检查命中元素数量等于一来确认唯一性。',references:[{source:mode==='refine'?2:1,fromLine:mode==='refine'?200:1,toLine:mode==='invalid-citation'?99:mode==='refine'?202:3}]}],limitations:['没有运行项目或性能测试。']};
   return {output:JSON.stringify(output),providerRequestId:'question-fixture-'+models,usage:{inputTokens:100,outputTokens:100},responseRef:{finishReason:'stop'}};
  }}});
  const {createAgentInteractionService}=await load('agent-interaction-service.mjs'),service=createAgentInteractionService({repository,agentId}),conversation=crypto.randomUUID(),requestId=crypto.randomUUID(),origin={channel:'web',platformUserId:operatorId,actorRef:operatorId,conversationRef:conversation,eventRef:requestId};
  const accepted=await service.receive(origin,{requestId,message:'请解释这个项目如何保证唯一性，只回答问题，不写文章。'}),parent=await repository.claim(agentId,'message'),tools=await service.tools(parent),delegated=await tools.execute(null,'github_answer_question',{question:'如何保证唯一性？',repositoryUrl:'https://github.com/owner/project'});
  assert.equal(parent.id,accepted.id);await repository.settle(parent,{result:{reply:delegated.reply,task:delegated.task}});
  const task=await repository.claim(agentId,'task');assert.equal(task.kind,'github-question');
  if(mode==='v1-recovery'){
   const v1=question.GITHUB_QUESTION_WORKFLOW_V1,{interactionId}=await load('agent-interaction-contracts.mjs'),agent=await repository.agent(agentId);
   await runtimeRepository.registerWorkflow({actorUserId:operatorId,manifest:v1,status:'draft'});await runtimeRepository.activateWorkflow(v1.workflowKey,1);
   await runtimeRepository.createRun({id:interactionId([task.id,'github-question']),agentUserId:agentId,workflowKey:v1.workflowKey,workflowVersion:1,triggerKind:'manual',triggerRef:'interaction:'+task.id,idempotencyKey:'interaction-question:'+task.id,input:{schemaVersion:'agent-github-question-input-v1',...task.input_json},config:{model:{provider:'deepseek',modelId:agent.model}},budget:v1.defaultBudget});
  }
  const execute=question.createAgentGitHubQuestionExecutor({repository,service,ports:{runtimeRepository,artifactRepository,toolGateway,providerGateway}});
  if(mode==='invalid-citation'){
   await assert.rejects(execute(task),e=>e.details?.stageErrorCode==='AGENT_GITHUB_QUESTION_CITATION_INVALID');
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_runtime_stage_artifacts WHERE run_id=(SELECT run_id FROM agent_interactions WHERE id=$1) AND artifact_key='agent.github.question-answer'",[task.id])).rows[0].n,0);
  }else{
   const result=await execute(task);assert.match(result.reply,mode==='empty-evidence'?/无法确认/:mode==='refine'?/#L200-L202/:/#L1-L3/);assert.equal(result.repository.revision,revision);const expectedModels=['empty-evidence','v1-recovery'].includes(mode)?2:3;assert.equal(models,expectedModels);
   const before=network;assert.deepEqual(await execute(task),result);assert.equal(network,before);assert.equal(models,expectedModels);await repository.settle(task,{result});
   // Follow-up inherits only this requester's current project and exact commit.
   const followId=crypto.randomUUID();await service.receive({...origin,eventRef:followId},{requestId:followId,message:'那有什么局限？'});const follow=await repository.claim(agentId,'message'),followTools=await service.tools(follow),next=await followTools.execute(null,'github_answer_question',{question:'那有什么局限？'}),nextTask=await repository.get(next.task.id);
   assert.equal(nextTask.input_json.repositoryUrl,'https://github.com/owner/project');assert.equal(nextTask.input_json.revision,revision);assert.equal(nextTask.input_json.previous.reply,result.reply);
   const otherContext=await repository.researchContext({...follow,actor_ref:crypto.randomUUID()});assert.equal(otherContext,null);
   assert.equal(await repository.researchContext({...follow,conversation_ref:crypto.randomUUID()}),null);
   const ambiguousOrigin={...origin,eventRef:crypto.randomUUID()};
   await repository.accept({agentId,origin:ambiguousOrigin,kind:'github-search',input:{kind:'github-search',topic:'找几个其他项目',repositoryUrl:null,publication:'draft'}});
   assert.equal(await repository.researchContext({...follow,created_at:new Date(Date.now()+1000)}),null,'a new ambiguous search must not reuse an older project');
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM blog_articles WHERE author_user_id=$1',[agentId])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[agentId])).rows[0].n,0);
 }});
});
