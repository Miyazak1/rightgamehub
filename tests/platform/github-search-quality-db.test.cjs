const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),h=require('./support/researcher-qa-db.cjs');
const {publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');
for(const mode of ['normal','invalid-citation','invalid-json'])test('generic search real gateways, artifacts and replay: '+mode,{skip:!h.enabled,timeout:120000},async t=>{
 const {createGitHubToolConfiguration}=await h.load('agent-plugins/github/tools.mjs'),{GITHUB_SEARCH_SCHEMAS}=await h.load('agent-plugins/github/search.mjs');
 const urls=[],revision='a'.repeat(40),readme='Runs entirely offline on Windows. 中文界面支持。';
 const fetchImpl=async raw=>{
  const u=new URL(raw);urls.push(u.pathname);
  if(u.pathname==='/search/repositories')return Response.json({total_count:1,incomplete_results:false,items:[{name:'local',owner:{login:'fixture'},description:'offline workflow',language:'Python',license:{spdx_id:'MIT'},stargazers_count:50,forks_count:1,created_at:'2020-01-01T00:00:00Z',pushed_at:'2026-11-20T00:00:00Z'}]});
  if(u.pathname==='/repos/fixture/local')return Response.json({name:'local',full_name:'fixture/local',default_branch:'main',stargazers_count:50,license:{spdx_id:'MIT'}});
  if(u.pathname==='/repos/fixture/local/git/ref/heads/main')return Response.json({object:{sha:revision,type:'commit'}});
  if(u.pathname==='/repos/fixture/local/readme')return new Response(readme,{headers:{'content-disposition':'inline; filename="README.md"'}});
  return new Response('',{status:404});
 };
 const config=createGitHubToolConfiguration({fetchImpl});
 const criteria=[{id:'c1',label:'离线运行',requirement:'must',kind:'documented',op:'supports',value:'offline',requestQuote:'离线'},{id:'c2',label:'Python',requirement:'must',kind:'language',op:'eq',value:'Python',requestQuote:'Python'}];
 const responseRequirements=[{id:'a1',kind:'evidence',label:'逐项核验及证据链接',value:'逐项核验及证据链接',requestQuote:'逐项核验条件，给出证据链接'},{id:'a2',kind:'unknown-reasons',label:'说明未知原因',value:'说明未知原因',requestQuote:'无法确认的说明原因'},{id:'a3',kind:'result-only',label:'不写文章',value:'不写文章',requestQuote:'不写文章'}];
 const plan={criteria,responseRequirements,queries:[{query:'workflow engine',limit:20,sort:'best-match',minStars:0,pushedAfter:null,filters:{language:'Python',license:null,createdAfter:null,createdBefore:null,pushedBefore:null,maxStars:null}}],assumptions:[],clarification:null};
 const searchQuality={toolAdapters:config.adapters,inputSchemas:config.inputSchemas,outputSchemas:config.outputSchemas,responseSchemas:GITHUB_SEARCH_SCHEMAS,respond:async req=>req.responseSchema.key==='agent.github.search-plan'?plan:mode==='invalid-json'?'not JSON':{candidates:[{key:'fixture/local',checks:criteria.map(c=>({criterion:c.id,status:'pass',reason:'作者文档说明支持',references:c.kind==='documented'?[{source:'r1-m1',quote:mode==='invalid-citation'?'Invented evidence not in README.':'Runs entirely offline on Windows.'}]:[]}))}],limitations:[],unhandledRequirements:[]}};
 await publicPipelineFixture(t,{searchQuality,interactionExercise:async fixture=>{
  const {pool,agentId,operatorId}=fixture,{PostgresAgentInteractionRepository}=await h.load('agent-interaction-repository.mjs'),repository=new PostgresAgentInteractionRepository(pool);
  await (await h.load('agent-interaction-bootstrap.mjs')).bootstrapAgentInteractions({repository,runtimeRepository:fixture.runtimeRepository,agentId});
  const schedule=new (await h.load('agent-blog-public-schedule.mjs')).PostgresAgentBlogPublicScheduleRepository(pool);await schedule.ensureDaily({agentUserId:agentId,enabled:false});await schedule.heartbeat({agentUserId:agentId,instanceId:crypto.randomUUID()});
  const before=(await pool.query('SELECT md5(row_to_json(t)::text) AS hash FROM agent_schedules t WHERE agent_user_id=$1',[agentId])).rows;
  const grants=(await pool.query('SELECT capability_key,contract_version,status FROM agent_capability_grants WHERE agent_user_id=$1 ORDER BY capability_key,contract_version',[agentId])).rows;
  const {createAgentPluginHost}=await h.load('agent-plugin-host.mjs'),{githubAgentPlugin}=await h.load('agent-plugins/github/index.mjs');
  const host=createAgentPluginHost({definitions:[{...githubAgentPlugin,createRuntime:()=>({config:fixture.config,interactionPorts:fixture})}]});
  const service=(await h.load('agent-interaction-service.mjs')).createAgentInteractionService({repository,agentId,pluginHost:host});
  const requestId=crypto.randomUUID(),origin={channel:'web',actorRef:operatorId,platformUserId:operatorId,conversationRef:crypto.randomUUID(),eventRef:requestId};
  const message='找 Python 离线工作流项目。请逐项核验条件，给出证据链接；无法确认的说明原因，不写文章。';
  const accepted=await service.receive(origin,{requestId,message}),parent=await repository.get(accepted.id),tools=await service.tools(parent);
  const queued=await tools.execute(null,'github_search_projects',{topic:'workflow'}),task=await repository.claim(agentId,'task');assert.equal(task.id,queued.task.id);assert.equal(task.input_json.userRequest,message);
  const runtime=host.bindRuntime({repository,service});t.after(()=>runtime.close());
  let result;try{result=await runtime.executeTask(task);}catch(error){console.error(JSON.stringify({code:error.code,details:error.details,stages:(await pool.query('SELECT stage_key,status,error_code,error_message FROM agent_run_stages WHERE run_id IN (SELECT id FROM agent_runs WHERE agent_user_id=$1)',[agentId])).rows}));throw error;}
  assert.equal(result.repositories.length,mode==='normal'?1:0);assert.equal(result.search.report.candidates[0].verdict,mode==='normal'?'matched':'unconfirmed');if(mode==='normal')assert.match(result.reply,/#L1-L1/);else{assert.match(result.reply,/核验未完成/);assert.equal(result.search.report.verificationStatus,mode==='invalid-json'?'incomplete':'partial');assert.doesNotMatch(result.reply,/Invented evidence/);}assert.equal(fixture.providerCalls(),2);
  if(mode==='invalid-json')assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_provider_calls p JOIN agent_run_actions a ON a.id=p.action_id WHERE a.run_id=$1 AND p.status='failed' AND p.error_code='AGENT_PROVIDER_OUTPUT_INVALID'",[result.discoveryRunId])).rows[0].n,1);
  assert.deepEqual(result.search.responseRequirements,responseRequirements);assert.equal(result.search.report.candidates[0].checks.length,2);
  const networkCalls=urls.length;assert.deepEqual(await runtime.executeTask(task),result);assert.equal(urls.length,networkCalls);assert.equal(fixture.providerCalls(),2);
  assert.deepEqual((await pool.query('SELECT md5(row_to_json(t)::text) AS hash FROM agent_schedules t WHERE agent_user_id=$1',[agentId])).rows,before);
  assert.deepEqual((await pool.query('SELECT capability_key,contract_version,status FROM agent_capability_grants WHERE agent_user_id=$1 ORDER BY capability_key,contract_version',[agentId])).rows,grants);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM blog_articles WHERE author_user_id=$1',[agentId])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[agentId])).rows[0].n,0);
  const receipt=(await pool.query('SELECT status,safe_for_next,result_json FROM agent_blog_public_requests WHERE agent_user_id=$1 AND request_id=$2',[agentId,task.id])).rows[0];assert.equal(receipt.status,'completed');assert.equal(receipt.safe_for_next,true);assert.deepEqual(receipt.result_json,result);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id WHERE action.run_id=$1',[result.discoveryRunId])).rows[0].n,2);
 }});
});
