const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./support/researcher-qa-db.cjs');
const {publicPipelineFixture}=require('./agent-blog-public-pipeline-db.test.cjs');
test('a bounded empty discovery is a durable successful no-op and replay does not invoke a model',
  {skip:!harness.enabled},async t=>publicPipelineFixture(t,{candidateCount:0,allowEmptyDiscovery:true}));
test('an exhausted malformed model result is retained for review and does not block the next publication',
  {skip:!harness.enabled},async t=>publicPipelineFixture(t,{selectionFailures:2,expectedFailure:/AGENT_BLOG_SELECTION_SCHEMA_INVALID/u,
    expectedCalls:3,recoverAfterFailure:true}));
test('durable request ownership and schedule recovery preserve identities and reject stale owners',
  {skip:!harness.enabled},async t=>publicPipelineFixture(t,{afterPublication:async({admin,account,result})=>{
    const {PostgresAgentBlogPublicRequestRepository}=await harness.load('agent-blog-public-request-repository.mjs');
    const {PostgresAgentBlogPublicScheduleRepository}=await harness.load('agent-blog-public-schedule.mjs');
    const requests=new PostgresAgentBlogPublicRequestRepository(admin),schedules=new PostgresAgentBlogPublicScheduleRepository(admin);
    const id=crypto.randomUUID(),snapshot={immutable:'frozen-input'};
    await requests.prepare({agentUserId:account.agentUserId,requestId:id,triggerKind:'manual',triggerRef:id,snapshot});
    const first=await requests.claim(account.agentUserId,id);
    await assert.rejects(requests.claim(account.agentUserId,id),error=>error.code==='AGENT_PUBLIC_REQUEST_BUSY');
    await requests.heartbeat(account.agentUserId,id,first.lease_token,180);
    await admin.query("UPDATE agent_blog_public_requests SET lease_until=now()-interval '1 second' WHERE request_id=$1",[id]);
    const resumed=await requests.claim(account.agentUserId,id);
    assert.notEqual(resumed.lease_token,first.lease_token);
    assert.deepEqual(resumed.snapshot_json,snapshot);
    await assert.rejects(requests.heartbeat(account.agentUserId,id,first.lease_token,180),error=>error.code==='AGENT_PUBLIC_REQUEST_LEASE_LOST');
    await assert.rejects(admin.query("UPDATE agent_blog_public_requests SET snapshot_json='{}' WHERE request_id=$1",[id]),/immutable/);
    await requests.settle(account.agentUserId,id,resumed.lease_token,{needsReview:true,safeForNext:true,errorCode:'ISOLATED_REVIEW'});
    const schedule=await schedules.ensureDaily({agentUserId:account.agentUserId,enabled:true});
    await admin.query("UPDATE agent_schedules SET next_fire_at=now()-interval '1 minute' WHERE id=$1",[schedule.id]);
    const fire=await schedules.claimDue({agentUserId:account.agentUserId});
    assert.ok(fire);
    assert.equal((await schedules.ensureDaily({agentUserId:account.agentUserId,enabled:true,preserveExisting:true})).id,schedule.id);
    assert.equal(await schedules.claimDue({agentUserId:account.agentUserId,recoverOnly:true}),null);
    await schedules.renew(fire.id,fire.attemptId);
    await admin.query("UPDATE agent_schedule_fires SET lease_until=now()-interval '1 second' WHERE id=$1",[fire.id]);
    const takeover=await schedules.claimDue({agentUserId:account.agentUserId,recoverOnly:true});
    assert.equal(takeover.id,fire.id);assert.equal(takeover.requestId,fire.requestId);
    assert.notEqual(takeover.attemptId,fire.attemptId);
    await assert.rejects(schedules.finish(fire.id,fire.attemptId,{status:'succeeded'}),error=>error.code==='AGENT_BLOG_PUBLIC_SCHEDULE_LEASE_LOST');
    await schedules.defer(takeover.id,takeover.attemptId,'DEPENDENCY_UNAVAILABLE');
    assert.equal((await admin.query('SELECT enabled FROM agent_schedules WHERE id=$1',[schedule.id])).rows[0].enabled,true);
    await schedules.finish(takeover.id,takeover.attemptId,{status:'failed',retryNextDaily:true,suspendAfterFailures:1});
    assert.equal((await admin.query('SELECT enabled FROM agent_schedules WHERE id=$1',[schedule.id])).rows[0].enabled,true);
    await assert.rejects(admin.query("UPDATE agent_schedule_fires SET status='running' WHERE id=$1",[fire.id]),/immutable/);
    const replay=await requests.findCompleted({agentUserId:account.agentUserId,requestId:result.requestId});
    assert.equal(replay.publication.articleId,result.publication.articleId);
  }}));
