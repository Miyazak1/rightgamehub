const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, 'apps/api/src', relative)).href);

test('public operations are scoped to the administrator and durable scheduler', async () => {
  const { createAgentBlogPublicOperationsService } = await load('agent-blog-public-operations-service.mjs');
  const operatorUserId = crypto.randomUUID(), agentUserId = crypto.randomUUID(), calls = [];
  const service = createAgentBlogPublicOperationsService({
    pool: { query: async (_sql, values) => ({ rows: values[0] === agentUserId && values[1] === operatorUserId
      ? [{ user_id: agentUserId }] : [] }) },
    authorizeOperator: async actor => actor.userId === operatorUserId,
    controller: {
      ensure: async input => (calls.push(['ensure', input]), { enabled: input.enabled, blocked: false }),
      requestNow: async input => (calls.push(['run', input]), { queued: true, blocked: false }),
    },
    runtimeConfig: { enabled: true, agentUserId },
    scheduleConfig: { enabled: true, pollMilliseconds: 30000 },
  });
  assert.equal((await service.setSchedule({ userId: operatorUserId }, agentUserId, { enabled: true })).enabled, true);
  assert.equal((await service.runNow({ userId: operatorUserId }, agentUserId)).queued, true);
  assert.deepEqual(calls[0], ['ensure', { agentUserId, enabled: true, resume: true }]);
  assert.deepEqual(calls[1], ['run', { agentUserId, maxHeartbeatAgeMs: 90000 }]);
  await assert.rejects(() => service.runNow({ userId: crypto.randomUUID() }, agentUserId),
    error => error.code === 'AGENT_OPERATOR_REQUIRED');
});

test('public operations fail closed when server-side runtime switches are unavailable', async () => {
  const { createAgentBlogPublicOperationsService } = await load('agent-blog-public-operations-service.mjs');
  const operatorUserId = crypto.randomUUID(), agentUserId = crypto.randomUUID();
  const base = {
    pool: { query: async () => ({ rows: [{ user_id: agentUserId }] }) },
    authorizeOperator: async () => true,
    controller: { ensure: async () => ({ enabled: true }), requestNow: async () => ({ queued: true }) },
    runtimeConfig: { enabled: true, agentUserId },
  };
  const service = createAgentBlogPublicOperationsService({ ...base,
    scheduleConfig: { enabled: false, pollMilliseconds: 30000 } });
  await assert.rejects(() => service.setSchedule({ userId: operatorUserId }, agentUserId, { enabled: true }),
    error => error.code === 'AGENT_PUBLIC_SCHEDULE_DISABLED');
  await assert.rejects(() => service.runNow({ userId: operatorUserId }, agentUserId),
    error => error.code === 'AGENT_PUBLIC_SCHEDULE_DISABLED');
});

test('public run API reports scheduler blockers without enabling schedules or masking unexpected failures', async t => {
  const { createAgentBlogPublicOperationsService } = await load('agent-blog-public-operations-service.mjs');
  const { AgentBlogPublicScheduleError } = await load('agent-blog-public-schedule.mjs');
  const { createApp } = await load('app.mjs');
  const { AuthError } = await load('auth-service.mjs');
  const operatorUserId=crypto.randomUUID(),agentUserId=crypto.randomUUID();
  const actor={userId:operatorUserId,accountType:'human',profile:{role:'admin'}};
  let sourceError,requests=0,ensures=0;
  const service=createAgentBlogPublicOperationsService({
    pool:{query:async()=>({rows:[{user_id:agentUserId}]})},authorizeOperator:async()=>true,
    controller:{ensure:async()=>{ensures++;throw sourceError;},requestNow:async()=>{requests++;if(sourceError)throw sourceError;return {queued:true,blocked:false};}},
    runtimeConfig:{enabled:true,agentUserId},scheduleConfig:{enabled:true,pollMilliseconds:30000},
  });
  const app=createApp({config:{requestBodyLimit:65536},agentAccountService:{},agentBlogAutomation:{},agentBlogPublicOperationsService:service,
    authService:{authenticateBearer:async authorization=>{
      if(authorization!=='Bearer fixture')throw new AuthError('AUTH_REQUIRED',401,'请登录。');return actor;
    }}});
  t.after(()=>app.close());
  for(const [source,code,status] of [
    ['AGENT_BLOG_PUBLIC_SCHEDULE_NOT_ENABLED','AGENT_PUBLIC_SCHEDULE_NOT_ENABLED',409],
    ['AGENT_BLOG_PUBLIC_SCHEDULER_HEARTBEAT_STALE','AGENT_PUBLIC_SCHEDULER_UNAVAILABLE',503],
    ['AGENT_BLOG_PUBLIC_SCHEDULE_FIRE_ACTIVE','AGENT_PUBLIC_RUN_ACTIVE',409],
    ['AGENT_BLOG_PUBLIC_SCHEDULE_FOUNDATION_OWNER_REQUIRED','AGENT_PUBLIC_PUBLISHER_REQUIRED',409],
  ]){
    sourceError=new AgentBlogPublicScheduleError(source);
    const response=await app.inject({method:'POST',url:`/v1/admin/agents/${agentUserId}/public-runs`,headers:{authorization:'Bearer fixture'}});
    assert.equal(response.statusCode,status,response.body);
    assert.equal(response.json().error.code,code);
    assert.doesNotMatch(response.json().error.message,/internal error/i);
  }
  assert.equal(ensures,0,'requesting a manual run must never implicitly resume a paused plan');
  sourceError=Object.assign(Error('private database detail'),{code:'AGENT_BLOG_PUBLIC_SCHEDULE_NOT_ENABLED'});
  const unknown=await app.inject({method:'POST',url:`/v1/admin/agents/${agentUserId}/public-runs`,headers:{authorization:'Bearer fixture'}});
  assert.equal(unknown.statusCode,500);assert.doesNotMatch(unknown.body,/private database detail/);
  const count=requests;
  const unauthorized=await app.inject({method:'POST',url:`/v1/admin/agents/${agentUserId}/public-runs`});
  assert.equal(unauthorized.statusCode,401);assert.equal(requests,count);
  sourceError=null;
  const accepted=await app.inject({method:'POST',url:`/v1/admin/agents/${agentUserId}/public-runs`,headers:{authorization:'Bearer fixture'}});
  assert.equal(accepted.statusCode,202);assert.equal(accepted.json().data.queued,true);
  assert.equal(ensures,0);
});
