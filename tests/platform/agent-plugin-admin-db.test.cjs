const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const h=require('./support/researcher-qa-db.cjs'),{publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');
test('plugin admin uses operator authorization, isolated statuses and read-only snapshots',{skip:!h.enabled,timeout:120000},async t=>{
 await publicPipelineFixture(t,{interactionExercise:async({pool,agentId,operatorId})=>{
  const {createAgentPluginAdminService,registerAgentPluginAdminRoutes}=await h.load('agent-plugin-admin.mjs');
  const {createBuiltinAgentPluginHost}=await h.load('agent-plugin-catalog.mjs');
  const host=createBuiltinAgentPluginHost({env:{}}),actor={userId:operatorId,profile:{role:'admin'}};let remote=0,mode='ready';
  const service=createAgentPluginAdminService({pool,interactionService:{agentId,pluginHost:host,capabilities:async()=>({available:true})},qqAdminService:{execute:async(a,id,operation)=>{
   remote++;assert.equal(a.userId,operatorId);assert.equal(id,agentId);assert.equal(operation,'status');
   if(mode==='down')throw Object.assign(Error('private URL/token must not appear'),{code:'QQ_CONTROL_UNAVAILABLE'});
   return {plugins:mode==='legacy'?undefined:[{id:'mooyu.qq',version:'1.0.0',enabled:true,activeVersion:true}],channelRuntime:{started:true,stopped:false},settings:{enabled:false},runtime:{loggedIn:true,connected:true,accountMatches:true},privateToken:'never-return-this',audit:[{private:'not-returned'}]};
  }}});
  const tables=['agent_capability_grants','agent_schedules','agent_blog_automation_settings','agent_channel_participants','agent_interactions','agent_runs','blog_articles','agent_policy_profiles'];
  const snapshot=async()=>Promise.all(tables.map(async table=>(await pool.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS hash FROM ${table} t`)).rows[0].hash));
  const before=await snapshot();
  await assert.rejects(service.read({userId:operatorId,profile:{role:'user'}},agentId),{code:'AGENT_INTERACTION_OPERATOR_REQUIRED'});
  await assert.rejects(service.read({userId:crypto.randomUUID(),profile:{role:'admin'}},agentId),{code:'AGENT_INTERACTION_OPERATOR_REQUIRED'});assert.equal(remote,0);
  const ready=await service.read(actor,agentId);assert.equal(ready.plugins[0].state,'assembled');assert.equal(ready.plugins[0].executorState,'not-probed');assert.equal(ready.plugins[1].state,'running');assert.equal(ready.plugins[1].responseEnabled,false);assert.equal(ready.paperEnabled,false);assert(!JSON.stringify(ready).includes('never-return-this'));
  host.setEnabled('mooyu.github',false);const disabled=await service.read(actor,agentId);assert.equal(disabled.plugins[0].enabled,false);assert.deepEqual(disabled.plugins[0].grants,ready.plugins[0].grants);
  mode='legacy';assert.equal((await service.read(actor,agentId)).plugins[1].state,'upgrade-required');
  mode='down';const down=await service.read(actor,agentId);assert.equal(down.plugins[1].state,'unavailable');assert.equal(down.plugins[1].enabled,null);assert(!JSON.stringify(down).includes('private URL'));
  const app=require('../../apps/api/node_modules/fastify')();t.after(()=>app.close());
  registerAgentPluginAdminRoutes(app,{service,requireAuth:async(req,reply)=>{if(req.headers.authorization!=='fixture')return reply.code(401).send({error:{code:'AUTH_REQUIRED'}});req.actor=actor;}});
  const url='/v1/admin/agents/'+agentId+'/plugins';
  assert.equal((await app.inject({url})).statusCode,401);
  const response=await app.inject({url,headers:{authorization:'fixture'}});assert.equal(response.statusCode,200);assert.match(response.headers['cache-control'],/no-store/);assert.equal(response.json().data.plugins[1].state,'unavailable');
  assert.equal((await app.inject({url:'/v1/admin/agents/'+crypto.randomUUID()+'/plugins',headers:{authorization:'fixture'}})).statusCode,403);
  assert.equal((await app.inject({url,method:'POST',headers:{authorization:'fixture'},payload:{enabled:false}})).statusCode,404);
  assert.deepEqual(await snapshot(),before);
 }});
});
