const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const harness=require('./support/researcher-qa-db.cjs');

const crossref=message=>new Response(JSON.stringify({message}),{status:200,headers:{'content-type':'application/json'}});

test('R1.9 reports persisted liveness and only recovers an expired stage with immutable audit',
  {skip:!harness.enabled},async()=>{
    const{admin}=await harness.setup();
    try{
      const{createAgentAccountService}=await harness.load('agent-account-service.mjs');
      const{PostgresAgentAccountRepository}=await harness.load('agent-account-repository.mjs');
      const{PostgresAgentRuntimeRepository}=await harness.load('agent-runtime-repository.mjs');
      const{createAgentPaperDiscoveryService}=await harness.load('agent-paper-discovery-service.mjs');
      const{createAgentPaperResearchExecutionService}=await harness.load('agent-paper-research-execution.mjs');
      const{createAgentPaperResearchOperationsService}=await harness.load('agent-paper-research-operations.mjs');
      const operatorId=crypto.randomUUID();
      await admin.query("INSERT INTO users(id,display_name,role)VALUES($1,'R1.9 operator','admin')",[operatorId]);
      const account=await createAgentAccountService({repository:new PostgresAgentAccountRepository(admin),authorizeOperator:async()=>true}).provision({userId:operatorId},{provisionKey:`r19-${crypto.randomUUID()}`,displayName:'R1.9 paper agent',handle:`r19-${crypto.randomBytes(5).toString('hex')}`,badgeLabel:'AI 助手',operatorLabel:'DB test',capabilities:['blog:auto-publish'],metadata:{}});
      const discovery=createAgentPaperDiscoveryService({pool:admin,authorizeOperator:async()=>true,fetchImpl:async()=>crossref({title:['Observable Paper Runtime'],author:[{given:'Ada',family:'Example'}],issued:{'date-parts':[[2026]]},'container-title':['Fixture Journal'],type:'journal-article'})});
      const discovered=await discovery.discover({userId:operatorId},account.agentUserId,{kind:'doi',doi:'10.5555/r19-operations',requestId:crypto.randomUUID()});
      const repository=new PostgresAgentRuntimeRepository(admin);
      const executionService=createAgentPaperResearchExecutionService({pool:admin,runtimeRepository:repository,authorizeOperator:async()=>true});
      const execution=await executionService.start({userId:operatorId},account.agentUserId,discovered.candidates[0].queue.id,{requestId:crypto.randomUUID()});
      await repository.registerWorker({workerId:'paper-r19-worker',instanceId:crypto.randomUUID(),capabilities:['paper.private.research:resolve-source'],metadata:{role:'paper-research',agentUserId:account.agentUserId}});
      const stage=await repository.claimNextStage('paper-r19-worker',60,['paper.private.research:resolve-source'],execution.runtimeRunId);
      await repository.startStage({stageId:stage.id,workerId:'paper-r19-worker',leaseToken:stage.leaseToken});
      const service=createAgentPaperResearchOperationsService({pool:admin,runtimeRepository:repository,authorizeOperator:async()=>true});
      const healthy=await service.snapshot({userId:operatorId},account.agentUserId);
      assert.equal(healthy.workers[0].fresh,true);
      assert.equal(healthy.redriveCandidates.length,0);
      await assert.rejects(service.recoverExpiredStage({userId:operatorId},account.agentUserId,execution.id,{requestId:crypto.randomUUID(),reason:'租约仍健康，验证服务必须拒绝抢占'}),error=>error.code==='PAPER_RESEARCH_OPERATIONS_LEASE_ACTIVE');
      await admin.query("UPDATE agent_run_stages SET lease_until=now()-interval '1 second' WHERE id=$1",[stage.id]);
      const degraded=await service.snapshot({userId:operatorId},account.agentUserId);
      assert.equal(degraded.redriveCandidates[0].id,stage.id);
      assert(degraded.blockers.some(item=>item.code==='PAPER_RESEARCH_EXPIRED_STAGE_LEASE'));
      const requestId=crypto.randomUUID(),reason='确认 worker 已停止且租约过期，按运行时规则恢复';
      const recovered=await service.recoverExpiredStage({userId:operatorId},account.agentUserId,execution.id,{requestId,reason});
      assert.equal(recovered.recovery.examined,1);
      assert.equal(recovered.recovery.failed,1);
      assert.deepEqual(await service.recoverExpiredStage({userId:operatorId},account.agentUserId,execution.id,{requestId,reason}),recovered);
      const audit=(await admin.query('SELECT * FROM agent_runtime_operator_actions WHERE request_id=$1',[requestId])).rows[0];
      assert.equal(audit.stage_id,stage.id);
      await assert.rejects(admin.query("UPDATE agent_runtime_operator_actions SET reason='attempted mutation' WHERE id=$1",[audit.id]),/immutable/u);
      const paperEvent=(await admin.query("SELECT count(*)::int AS n FROM agent_paper_research_execution_events WHERE execution_id=$1 AND event_type='execution.requeued'",[execution.id])).rows[0];
      assert.equal(paperEvent.n,1);
    }finally{await admin.end();}
  });

test('R1.10 keeps durable alert episodes, one weekly report, notification outbox and bounded retention',
  {skip:!harness.enabled},async()=>{
    const{admin}=await harness.setup();
    try{
      const{createAgentAccountService}=await harness.load('agent-account-service.mjs');
      const{PostgresAgentAccountRepository}=await harness.load('agent-account-repository.mjs');
      const{PostgresAgentRuntimeRepository}=await harness.load('agent-runtime-repository.mjs');
      const{createAgentPaperResearchOperationsService}=await harness.load('agent-paper-research-operations.mjs');
      const operatorId=crypto.randomUUID(),operatorEmail=`r110-${crypto.randomBytes(4).toString('hex')}@example.test`;
      await admin.query("INSERT INTO users(id,display_name,role)VALUES($1,'R1.10 operator','admin')",[operatorId]);
      await admin.query("INSERT INTO auth_identities(id,user_id,provider,subject)VALUES($1,$2,'email',$3)",[crypto.randomUUID(),operatorId,operatorEmail]);
      const account=await createAgentAccountService({repository:new PostgresAgentAccountRepository(admin),authorizeOperator:async()=>true}).provision({userId:operatorId},{provisionKey:`r110-${crypto.randomUUID()}`,displayName:'R1.10 paper agent',handle:`r110-${crypto.randomBytes(5).toString('hex')}`,badgeLabel:'AI 助手',operatorLabel:'DB test',capabilities:['blog:auto-publish'],metadata:{}});
      const delivered=[];
      const repository=new PostgresAgentRuntimeRepository(admin);
      const service=createAgentPaperResearchOperationsService({pool:admin,runtimeRepository:repository,
        authorizeOperator:async()=>true,notificationSender:{configured:true,async sendOperationsMessage(message){delivered.push(message);}}});
      const actor={userId:operatorId};
      const policy=await service.configurePolicy(actor,account.agentUserId,{enabled:true,workerHeartbeatSeconds:180,
        staleStageSeconds:900,oldestBacklogSeconds:21600,metricRetentionDays:30,weeklyReportEnabled:true,
        emailNotificationsEnabled:true,weeklyReportWeekday:1,weeklyReportLocalTime:'00:00',timezone:'Asia/Shanghai'});
      assert.equal(policy.version,1);
      const first=await service.evaluate(account.agentUserId);
      assert.equal(first.health,'blocked');
      assert.equal(first.opened,1);
      assert.equal(first.weeklyReportCreated,true);
      const second=await service.evaluate(account.agentUserId);
      assert.equal(second.opened,0);
      assert.equal(second.weeklyReportCreated,false);
      const open=(await admin.query("SELECT * FROM agent_research_operation_alerts WHERE agent_user_id=$1 AND status='open'",[account.agentUserId])).rows;
      assert.equal(open.length,1);
      assert.equal(open[0].code,'PAPER_RESEARCH_WORKER_MISSING');
      assert.equal(open[0].occurrences,2);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_research_weekly_reports WHERE agent_user_id=$1',[account.agentUserId])).rows[0].n,1);
      const initialDelivery=await service.deliverPending(account.agentUserId);
      assert.equal(initialDelivery.sent,2);
      assert(delivered.every(message=>message.email===operatorEmail));

      await repository.registerWorker({workerId:`paper-r110-${crypto.randomBytes(4).toString('hex')}`,
        instanceId:crypto.randomUUID(),capabilities:['paper.private.research:resolve-source'],
        metadata:{role:'paper-research',agentUserId:account.agentUserId}});
      const recovered=await service.evaluate(account.agentUserId);
      assert.equal(recovered.health,'ready');
      assert.equal(recovered.resolved,1);
      assert.equal((await service.deliverPending(account.agentUserId)).sent,1);
      const resolved=(await admin.query("SELECT * FROM agent_research_operation_alerts WHERE agent_user_id=$1 AND status='resolved'",[account.agentUserId])).rows;
      assert.equal(resolved.length,1);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_research_operation_alert_events WHERE alert_id=$1',[resolved[0].id])).rows[0].n,2);

      await admin.query(`INSERT INTO agent_research_metric_snapshots(id,agent_user_id,health,payload_json,observed_at)
        VALUES($1,$2,'ready','{}',now()-interval '31 days')`,[crypto.randomUUID(),account.agentUserId]);
      const preview=await service.retentionPreview(actor,account.agentUserId);
      assert.equal(preview.deletableMetricSnapshots,1);
      const requestId=crypto.randomUUID(),reason='清理超过三十天的派生健康快照，保留研究与审计事实';
      const applied=await service.applyRetention(actor,account.agentUserId,{requestId,reason});
      assert.equal(applied.deletedMetricSnapshots,1);
      assert.equal(applied.idempotentReplay,false);
      assert.equal((await service.applyRetention(actor,account.agentUserId,{requestId,reason})).idempotentReplay,true);
      const run=(await admin.query('SELECT * FROM agent_research_retention_runs WHERE agent_user_id=$1 AND request_id=$2',[account.agentUserId,requestId])).rows[0];
      await assert.rejects(admin.query("UPDATE agent_research_retention_runs SET reason='attempted mutation' WHERE id=$1",[run.id]),/immutable/u);
      const report=(await admin.query('SELECT id FROM agent_research_weekly_reports WHERE agent_user_id=$1',[account.agentUserId])).rows[0];
      await assert.rejects(admin.query("DELETE FROM agent_research_weekly_reports WHERE id=$1",[report.id]),/immutable/u);
      const view=await service.snapshot(actor,account.agentUserId);
      assert.equal(view.alerts[0].status,'resolved');
      assert.equal(view.weeklyReports.length,1);
      assert(view.retention.protectedRecords.includes('EvidenceSpan 与结论'));
    }finally{await admin.end();}
  });
