import crypto from 'node:crypto';
import {withTransaction} from './database.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKFLOW='paper.private.research';

export class AgentPaperResearchOperationsError extends Error{
  constructor(code,{details=null}={}){super(code);this.name='AgentPaperResearchOperationsError';this.code=code;this.details=details;this.retryable=false;this.statusCode=code.endsWith('_NOT_FOUND')?404:code.endsWith('_REQUIRED')?403:code.endsWith('_CONFLICT')||code.endsWith('_ACTIVE')?409:400;}
}
const fail=(code,details)=>{throw new AgentPaperResearchOperationsError(code,{details});};
const id=value=>{if(typeof value!=='string'||!UUID.test(value))fail('PAPER_RESEARCH_OPERATIONS_INPUT_INVALID');return value;};
const iso=value=>value?.toISOString?.()??value??null;
const number=value=>Number(value??0);
const classify=code=>{const value=String(code??'').toUpperCase();if(/BUDGET|POLICY|FORBIDDEN|CONSENT|CAPABILITY|AUTHORIZED/.test(value))return'policy';if(/PROVIDER|MODEL|SEMANTIC|COMPOSITION/.test(value))return'provider';if(/DISCOVERY|SOURCE|FULLTEXT|ARXIV|GITHUB|DOI/.test(value))return'source';if(/PARSE|QUALITY|ELIGIBILITY|EVIDENCE|IDENTITY|SELECTION/.test(value))return'quality';if(/LEASE|RUNTIME|STAGE|TIMEOUT|WORKER|TERMINATED/.test(value))return'runtime';return'unknown';};

export function createAgentPaperResearchOperationsService({pool,runtimeRepository,authorizeOperator,
  maxWorkerHeartbeatAgeMs=180000,staleStageAgeMs=900000,oldestBacklogAgeMs=21600000,notificationSender=null}={}){
  if(!pool||!runtimeRepository||typeof authorizeOperator!=='function')fail('PAPER_RESEARCH_OPERATIONS_DEPENDENCY_REQUIRED');
  const scope=async(actor,agentUserId)=>{
    const operatorId=id(actor?.userId);agentUserId=id(agentUserId);
    if(await authorizeOperator(structuredClone(actor))!==true)fail('PAPER_RESEARCH_OPERATIONS_OPERATOR_REQUIRED');
    const account=(await pool.query(`SELECT user_id FROM agent_accounts WHERE user_id=$1 AND operator_user_id=$2 AND status='active'`,[agentUserId,operatorId])).rows[0];
    if(!account)fail('PAPER_RESEARCH_OPERATIONS_AGENT_NOT_FOUND');
    return{agentUserId,operatorId};
  };
  const policyShape=row=>({enabled:row.enabled,workerHeartbeatSeconds:row.worker_heartbeat_seconds,
    staleStageSeconds:row.stale_stage_seconds,oldestBacklogSeconds:row.oldest_backlog_seconds,
    metricRetentionDays:row.metric_retention_days,weeklyReportEnabled:row.weekly_report_enabled,
    emailNotificationsEnabled:row.email_notifications_enabled,
    weeklyReportWeekday:row.weekly_report_weekday,weeklyReportLocalTime:String(row.weekly_report_local_time).slice(0,5),
    timezone:row.timezone,version:row.version,updatedAt:iso(row.updated_at)});
  const ensurePolicy=async agentUserId=>{await pool.query(`INSERT INTO agent_research_operations_policies(agent_user_id)
      VALUES($1) ON CONFLICT(agent_user_id)DO NOTHING`,[agentUserId]);
    return(await pool.query(`SELECT * FROM agent_research_operations_policies WHERE agent_user_id=$1`,[agentUserId])).rows[0];};
  const buildSnapshot=async(agentUserId,policy)=>{
    const[workersResult,backlogResult,stagesResult,metricsResult,budgetResult,errorResult,recoveryResult]=await Promise.all([
      pool.query(`SELECT worker_id,instance_id,runtime_version,status,current_stage_id,capabilities_json,metadata_json,
          started_at,last_seen_at,stopped_at,extract(epoch FROM(now()-last_seen_at))*1000 AS heartbeat_age_ms
        FROM agent_runtime_workers WHERE metadata_json->>'agentUserId'=$1
          AND (metadata_json->>'role'='paper-research' OR capabilities_json ? 'paper.private.research:resolve-source')
        ORDER BY last_seen_at DESC,worker_id`,[agentUserId]),
      pool.query(`SELECT count(*) FILTER(WHERE item.state='queued')::int AS queued_items,
          count(*) FILTER(WHERE execution.status IN('queued','running'))::int AS active_executions,
          count(*) FILTER(WHERE execution.status='blocked')::int AS blocked_executions,
          count(*) FILTER(WHERE execution.status='failed')::int AS failed_executions,
          min(item.created_at) FILTER(WHERE item.state='queued' AND execution.id IS NULL) AS oldest_waiting_at
        FROM agent_paper_research_queue_items item
        LEFT JOIN LATERAL(SELECT candidate.* FROM agent_paper_research_executions candidate
          WHERE candidate.queue_item_id=item.id ORDER BY candidate.created_at DESC LIMIT 1)execution ON true
        WHERE item.agent_user_id=$1`,[agentUserId]),
      pool.query(`SELECT stage.id,stage.run_id,execution.id AS execution_id,stage.stage_key,stage.status,
          stage.attempt,stage.max_attempts,stage.leased_by,stage.lease_until,stage.attempt_started_at,stage.updated_at,
          stage.error_code,extract(epoch FROM(now()-coalesce(stage.attempt_started_at,stage.updated_at)))*1000 AS stage_age_ms,
          (stage.status IN('leased','running') AND (stage.lease_until<=now()
            OR stage.attempt_started_at+(stage.timeout_seconds*interval '1 second')<=now())) AS recoverable
        FROM agent_run_stages stage JOIN agent_runs run ON run.id=stage.run_id
        LEFT JOIN agent_paper_research_executions execution ON execution.runtime_run_id=run.id
        WHERE run.agent_user_id=$1 AND run.workflow_key=$2
          AND stage.status IN('queued','leased','running','waiting','failed','uncertain')
        ORDER BY stage.updated_at DESC LIMIT 100`,[agentUserId,WORKFLOW]),
      pool.query(`SELECT stage.stage_key,count(*)::int AS samples,
          count(*) FILTER(WHERE stage.status='succeeded')::int AS succeeded,
          count(*) FILTER(WHERE stage.status IN('failed','uncertain'))::int AS failed,
          round(avg(extract(epoch FROM(stage.finished_at-stage.attempt_started_at))*1000))::bigint AS average_ms,
          round(percentile_cont(.95)WITHIN GROUP(ORDER BY extract(epoch FROM(stage.finished_at-stage.attempt_started_at))*1000))::bigint AS p95_ms
        FROM agent_run_stages stage JOIN agent_runs run ON run.id=stage.run_id
        WHERE run.agent_user_id=$1 AND run.workflow_key=$2 AND stage.finished_at IS NOT NULL
          AND stage.created_at>=now()-interval '30 days' GROUP BY stage.stage_key ORDER BY min(stage.ordinal)`,[agentUserId,WORKFLOW]),
      pool.query(`SELECT count(*)::int AS reservations,
          coalesce(sum(charged_provider_calls),0)::bigint AS provider_calls,
          coalesce(sum(charged_input_tokens),0)::bigint AS input_tokens,
          coalesce(sum(charged_output_tokens),0)::bigint AS output_tokens,
          coalesce(sum(charged_cost_microusd),0)::bigint AS cost_microusd,
          count(*)FILTER(WHERE reservation.status='reserved')::int AS active_reservations,
          count(*)FILTER(WHERE reservation.status='uncertain')::int AS uncertain_reservations
        FROM agent_budget_reservations reservation JOIN agent_runs run ON run.id=reservation.run_id
        WHERE run.agent_user_id=$1 AND run.workflow_key=$2 AND reservation.period_month=date_trunc('month',now())::date`,[agentUserId,WORKFLOW]),
      pool.query(`SELECT coalesce(run.error_code,execution.error_code) AS error_code,count(*)::int AS occurrences,
          max(coalesce(run.finished_at,execution.finished_at,execution.updated_at)) AS last_seen_at
        FROM agent_paper_research_executions execution LEFT JOIN agent_runs run ON run.id=execution.runtime_run_id
        WHERE execution.agent_user_id=$1 AND coalesce(run.error_code,execution.error_code) IS NOT NULL
          AND execution.created_at>=now()-interval '30 days'
        GROUP BY coalesce(run.error_code,execution.error_code) ORDER BY count(*) DESC,last_seen_at DESC LIMIT 30`,[agentUserId]),
      pool.query(`SELECT action.id,action.run_id,action.stage_id,action.action_type,action.reason,
          action.result_json,action.created_at FROM agent_runtime_operator_actions action
        WHERE action.agent_user_id=$1 ORDER BY action.created_at DESC LIMIT 20`,[agentUserId]),
    ]);
    const now=Date.now(),workers=workersResult.rows.map(row=>({workerId:row.worker_id,instanceId:row.instance_id,
      runtimeVersion:row.runtime_version,status:row.status,currentStageId:row.current_stage_id,
      role:row.metadata_json?.role??null,capabilities:row.capabilities_json,lastSeenAt:iso(row.last_seen_at),
      heartbeatAgeMs:number(row.heartbeat_age_ms),fresh:row.status!=='offline'&&number(row.heartbeat_age_ms)<=policy.worker_heartbeat_seconds*1000}));
    const backlogRow=backlogResult.rows[0]??{},oldest=backlogRow.oldest_waiting_at?new Date(backlogRow.oldest_waiting_at):null;
    const stages=stagesResult.rows.map(row=>({id:row.id,runId:row.run_id,executionId:row.execution_id,stageKey:row.stage_key,
      status:row.status,attempt:row.attempt,maxAttempts:row.max_attempts,leasedBy:row.leased_by,
      leaseUntil:iso(row.lease_until),stageAgeMs:number(row.stage_age_ms),recoverable:row.recoverable===true,errorCode:row.error_code}));
    const errors=errorResult.rows.map(row=>({code:row.error_code,category:classify(row.error_code),occurrences:row.occurrences,lastSeenAt:iso(row.last_seen_at)}));
    const categories=Object.fromEntries(['source','quality','provider','runtime','policy','unknown'].map(category=>[category,errors.filter(item=>item.category===category).reduce((sum,item)=>sum+item.occurrences,0)]));
    const backlog={queuedItems:number(backlogRow.queued_items),activeExecutions:number(backlogRow.active_executions),blockedExecutions:number(backlogRow.blocked_executions),failedExecutions:number(backlogRow.failed_executions),oldestWaitingAt:iso(oldest),oldestWaitingAgeMs:oldest?Math.max(0,now-oldest.getTime()):0};
    const blockers=[];
    if(!workers.some(worker=>worker.fresh))blockers.push({code:workers.length?'PAPER_RESEARCH_WORKER_HEARTBEAT_STALE':'PAPER_RESEARCH_WORKER_MISSING',severity:'blocked'});
    const recoverable=stages.filter(stage=>stage.recoverable&&stage.executionId);
    if(recoverable.length)blockers.push({code:'PAPER_RESEARCH_EXPIRED_STAGE_LEASE',severity:'blocked',count:recoverable.length});
    const stalled=stages.filter(stage=>['queued','waiting','leased','running'].includes(stage.status)&&stage.stageAgeMs>policy.stale_stage_seconds*1000);
    if(stalled.length)blockers.push({code:'PAPER_RESEARCH_STAGE_STALLED',severity:'degraded',count:stalled.length});
    if(backlog.oldestWaitingAgeMs>policy.oldest_backlog_seconds*1000)blockers.push({code:'PAPER_RESEARCH_BACKLOG_OLD',severity:'degraded'});
    const budgetRow=budgetResult.rows[0]??{};
    return{schemaVersion:'agent-paper-research-operations-v2',generatedAt:new Date().toISOString(),health:blockers.some(item=>item.severity==='blocked')?'blocked':blockers.length?'degraded':'ready',blockers,workers,backlog,
      activeStages:stages,redriveCandidates:recoverable,stageMetrics:metricsResult.rows.map(row=>({stageKey:row.stage_key,samples:row.samples,succeeded:row.succeeded,failed:row.failed,averageMs:number(row.average_ms),p95Ms:number(row.p95_ms)})),
      monthlyBudget:{reservations:number(budgetRow.reservations),providerCalls:number(budgetRow.provider_calls),inputTokens:number(budgetRow.input_tokens),outputTokens:number(budgetRow.output_tokens),costMicrousd:number(budgetRow.cost_microusd),activeReservations:number(budgetRow.active_reservations),uncertainReservations:number(budgetRow.uncertain_reservations)},
      errors:{categories,items:errors},recentRecoveryActions:recoveryResult.rows.map(row=>({id:row.id,runId:row.run_id,stageId:row.stage_id,type:row.action_type,reason:row.reason,result:row.result_json,createdAt:iso(row.created_at)}))};
  };
  const decorate=async(agentUserId,policy,base)=>{
    const[alerts,reports,retention,metrics]=await Promise.all([
      pool.query(`SELECT id,fingerprint,code,severity,status,occurrences,context_json,first_seen_at,last_seen_at,resolved_at
        FROM agent_research_operation_alerts WHERE agent_user_id=$1 ORDER BY(status='open')DESC,last_seen_at DESC LIMIT 30`,[agentUserId]),
      pool.query(`SELECT id,week_started_at,week_ended_at,report_json,created_at FROM agent_research_weekly_reports
        WHERE agent_user_id=$1 ORDER BY week_started_at DESC LIMIT 8`,[agentUserId]),
      pool.query(`SELECT id,mode,reason,cutoff_at,deleted_metric_snapshots,created_at FROM agent_research_retention_runs
        WHERE agent_user_id=$1 ORDER BY created_at DESC LIMIT 1`,[agentUserId]),
      pool.query(`SELECT count(*)::int AS total,min(observed_at) AS oldest_at,max(observed_at) AS newest_at
        FROM agent_research_metric_snapshots WHERE agent_user_id=$1`,[agentUserId]),
    ]);
    return{...base,policy:policyShape(policy),alerts:alerts.rows.map(row=>({id:row.id,fingerprint:row.fingerprint,
      code:row.code,severity:row.severity,status:row.status,occurrences:row.occurrences,context:row.context_json,
      firstSeenAt:iso(row.first_seen_at),lastSeenAt:iso(row.last_seen_at),resolvedAt:iso(row.resolved_at)})),
      weeklyReports:reports.rows.map(row=>({id:row.id,weekStartedAt:iso(row.week_started_at),weekEndedAt:iso(row.week_ended_at),
        report:row.report_json,createdAt:iso(row.created_at)})),
      retention:{metricSnapshots:number(metrics.rows[0]?.total),oldestMetricAt:iso(metrics.rows[0]?.oldest_at),
        newestMetricAt:iso(metrics.rows[0]?.newest_at),lastRun:retention.rows[0]?{id:retention.rows[0].id,mode:retention.rows[0].mode,
          reason:retention.rows[0].reason,cutoffAt:iso(retention.rows[0].cutoff_at),deletedMetricSnapshots:retention.rows[0].deleted_metric_snapshots,
          createdAt:iso(retention.rows[0].created_at)}:null,
        protectedRecords:['论文与来源','EvidenceSpan 与结论','运行与阶段','告警事件','周报','人工操作审计']}};
  };
  const snapshot=async(actor,agentUserId)=>{({agentUserId}=await scope(actor,agentUserId));const policy=await ensurePolicy(agentUserId);
    return decorate(agentUserId,policy,await buildSnapshot(agentUserId,policy));};

  const configurePolicy=async(actor,agentUserId,input={})=>{
    const scoped=await scope(actor,agentUserId),values={enabled:input.enabled!==false,
      workerHeartbeatSeconds:Number(input.workerHeartbeatSeconds),staleStageSeconds:Number(input.staleStageSeconds),
      oldestBacklogSeconds:Number(input.oldestBacklogSeconds),metricRetentionDays:Number(input.metricRetentionDays),
      weeklyReportEnabled:input.weeklyReportEnabled!==false,emailNotificationsEnabled:input.emailNotificationsEnabled===true,
      weeklyReportWeekday:Number(input.weeklyReportWeekday),
      weeklyReportLocalTime:String(input.weeklyReportLocalTime??''),timezone:String(input.timezone??'')};
    if(!Number.isInteger(values.workerHeartbeatSeconds)||values.workerHeartbeatSeconds<60||values.workerHeartbeatSeconds>3600
      ||!Number.isInteger(values.staleStageSeconds)||values.staleStageSeconds<300||values.staleStageSeconds>86400
      ||!Number.isInteger(values.oldestBacklogSeconds)||values.oldestBacklogSeconds<900||values.oldestBacklogSeconds>604800
      ||!Number.isInteger(values.metricRetentionDays)||values.metricRetentionDays<30||values.metricRetentionDays>730
      ||!Number.isInteger(values.weeklyReportWeekday)||values.weeklyReportWeekday<1||values.weeklyReportWeekday>7
      ||!/^([01]\d|2[0-3]):[0-5]\d$/u.test(values.weeklyReportLocalTime)
      ||!/^[-+A-Za-z0-9_/]{3,64}$/u.test(values.timezone))fail('PAPER_RESEARCH_OPERATIONS_POLICY_INVALID');
    const row=(await pool.query(`INSERT INTO agent_research_operations_policies(agent_user_id,enabled,worker_heartbeat_seconds,
        stale_stage_seconds,oldest_backlog_seconds,metric_retention_days,weekly_report_enabled,email_notifications_enabled,
        weekly_report_weekday,weekly_report_local_time,timezone,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(agent_user_id)DO UPDATE SET enabled=EXCLUDED.enabled,worker_heartbeat_seconds=EXCLUDED.worker_heartbeat_seconds,
        stale_stage_seconds=EXCLUDED.stale_stage_seconds,oldest_backlog_seconds=EXCLUDED.oldest_backlog_seconds,
        metric_retention_days=EXCLUDED.metric_retention_days,weekly_report_enabled=EXCLUDED.weekly_report_enabled,
        email_notifications_enabled=EXCLUDED.email_notifications_enabled,
        weekly_report_weekday=EXCLUDED.weekly_report_weekday,weekly_report_local_time=EXCLUDED.weekly_report_local_time,
        timezone=EXCLUDED.timezone,updated_by=EXCLUDED.updated_by,updated_at=now(),version=agent_research_operations_policies.version+1
      RETURNING *`,[scoped.agentUserId,values.enabled,values.workerHeartbeatSeconds,values.staleStageSeconds,
      values.oldestBacklogSeconds,values.metricRetentionDays,values.weeklyReportEnabled,values.emailNotificationsEnabled,
      values.weeklyReportWeekday,values.weeklyReportLocalTime,values.timezone,scoped.operatorId])).rows[0];
    return{schemaVersion:'agent-paper-research-operations-policy-v1',...policyShape(row)};
  };

  const retentionPreview=async(actor,agentUserId)=>{({agentUserId}=await scope(actor,agentUserId));const policy=await ensurePolicy(agentUserId);
    const row=(await pool.query(`SELECT now()-($2*interval '1 day') AS cutoff_at,count(*)::int AS deletable
      FROM agent_research_metric_snapshots WHERE agent_user_id=$1 AND observed_at<now()-($2*interval '1 day')`,[agentUserId,policy.metric_retention_days])).rows[0];
    return{schemaVersion:'agent-paper-research-retention-preview-v1',cutoffAt:iso(row.cutoff_at),deletableMetricSnapshots:row.deletable,
      protectedRecords:['论文与来源','EvidenceSpan 与结论','运行与阶段','告警事件','周报','人工操作审计']};};
  const applyRetention=async(actor,agentUserId,{requestId,reason}={})=>{
    const scoped=await scope(actor,agentUserId);requestId=id(requestId);reason=String(reason??'').trim();
    if(reason.length<10||reason.length>1000)fail('PAPER_RESEARCH_OPERATIONS_REASON_INVALID');
    const policy=await ensurePolicy(scoped.agentUserId);
    return withTransaction(pool,async client=>{
      const duplicate=(await client.query(`SELECT * FROM agent_research_retention_runs WHERE agent_user_id=$1 AND request_id=$2`,[scoped.agentUserId,requestId])).rows[0];
      if(duplicate)return{schemaVersion:'agent-paper-research-retention-v1',deletedMetricSnapshots:duplicate.deleted_metric_snapshots,cutoffAt:iso(duplicate.cutoff_at),idempotentReplay:true};
      const cutoff=(await client.query(`SELECT now()-($1*interval '1 day') AS value`,[policy.metric_retention_days])).rows[0].value;
      const deleted=await client.query(`DELETE FROM agent_research_metric_snapshots WHERE agent_user_id=$1 AND observed_at<$2`,[scoped.agentUserId,cutoff]);
      await client.query(`INSERT INTO agent_research_retention_runs(id,agent_user_id,operator_user_id,request_id,mode,reason,cutoff_at,deleted_metric_snapshots)
        VALUES($1,$2,$3,$4,'operator',$5,$6,$7)`,[crypto.randomUUID(),scoped.agentUserId,scoped.operatorId,requestId,reason,cutoff,deleted.rowCount]);
      return{schemaVersion:'agent-paper-research-retention-v1',deletedMetricSnapshots:deleted.rowCount,cutoffAt:iso(cutoff),idempotentReplay:false};
    });
  };

  const evaluate=async(agentUserId)=>{
    agentUserId=id(agentUserId);const policy=await ensurePolicy(agentUserId);if(!policy.enabled)return{skipped:true,reason:'disabled'};
    const base=await buildSnapshot(agentUserId,policy),observedAt=new Date();
    const result=await withTransaction(pool,async client=>{
      await client.query(`INSERT INTO agent_research_metric_snapshots(id,agent_user_id,health,payload_json,observed_at)VALUES($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(),agentUserId,base.health,JSON.stringify({health:base.health,blockers:base.blockers,backlog:base.backlog,monthlyBudget:base.monthlyBudget}),observedAt]);
      const activeFingerprints=[];let opened=0,resolved=0;
      for(const blocker of base.blockers){const fingerprint=blocker.code;activeFingerprints.push(fingerprint);
        const existing=(await client.query(`SELECT * FROM agent_research_operation_alerts WHERE agent_user_id=$1 AND fingerprint=$2 AND status='open' FOR UPDATE`,[agentUserId,fingerprint])).rows[0];
        if(existing){await client.query(`UPDATE agent_research_operation_alerts SET severity=$3,occurrences=occurrences+1,context_json=$4,last_seen_at=$5 WHERE id=$1 AND agent_user_id=$2`,[existing.id,agentUserId,blocker.severity,JSON.stringify(blocker),observedAt]);}
        else{const alertId=crypto.randomUUID();await client.query(`INSERT INTO agent_research_operation_alerts(id,agent_user_id,fingerprint,code,severity,status,context_json,first_seen_at,last_seen_at)
            VALUES($1,$2,$3,$4,$5,'open',$6,$7,$7)`,[alertId,agentUserId,fingerprint,blocker.code,blocker.severity,JSON.stringify(blocker),observedAt]);
          await client.query(`INSERT INTO agent_research_operation_alert_events(id,alert_id,agent_user_id,event_type,payload_json,created_at)VALUES($1,$2,$3,'opened',$4,$5)`,[crypto.randomUUID(),alertId,agentUserId,JSON.stringify(blocker),observedAt]);
          if(policy.email_notifications_enabled)await client.query(`INSERT INTO agent_research_operation_deliveries(id,agent_user_id,kind,dedupe_key,payload_json)
            VALUES($1,$2,'alert.opened',$3,$4) ON CONFLICT(agent_user_id,dedupe_key)DO NOTHING`,[crypto.randomUUID(),agentUserId,`alert-opened:${alertId}`,JSON.stringify({code:blocker.code,severity:blocker.severity,context:blocker})]);opened++;}}
      const openRows=(await client.query(`SELECT * FROM agent_research_operation_alerts WHERE agent_user_id=$1 AND status='open' FOR UPDATE`,[agentUserId])).rows;
      for(const alert of openRows.filter(item=>!activeFingerprints.includes(item.fingerprint))){await client.query(`UPDATE agent_research_operation_alerts SET status='resolved',resolved_at=$2,last_seen_at=$2 WHERE id=$1`,[alert.id,observedAt]);
        await client.query(`INSERT INTO agent_research_operation_alert_events(id,alert_id,agent_user_id,event_type,payload_json,created_at)VALUES($1,$2,$3,'resolved',$4,$5)`,[crypto.randomUUID(),alert.id,agentUserId,JSON.stringify({health:base.health}),observedAt]);
        if(policy.email_notifications_enabled)await client.query(`INSERT INTO agent_research_operation_deliveries(id,agent_user_id,kind,dedupe_key,payload_json)
          VALUES($1,$2,'alert.resolved',$3,$4) ON CONFLICT(agent_user_id,dedupe_key)DO NOTHING`,[crypto.randomUUID(),agentUserId,`alert-resolved:${alert.id}`,JSON.stringify({code:alert.code,severity:alert.severity})]);resolved++;}
      let weeklyReportCreated=false;
      if(policy.weekly_report_enabled){const window=(await client.query(`SELECT
          (date_trunc('week',now() AT TIME ZONE $1) AT TIME ZONE $1) AS week_started_at,
          ((date_trunc('week',now() AT TIME ZONE $1)+interval '7 days') AT TIME ZONE $1) AS week_ended_at,
          ((date_trunc('week',now() AT TIME ZONE $1)+(($2-1)*interval '1 day')+$3::time) AT TIME ZONE $1) AS due_at`,
        [policy.timezone,policy.weekly_report_weekday,String(policy.weekly_report_local_time)])).rows[0];
        if(observedAt>=window.due_at){const inserted=await client.query(`INSERT INTO agent_research_weekly_reports(id,agent_user_id,week_started_at,week_ended_at,report_json)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT(agent_user_id,week_started_at)DO NOTHING`,[crypto.randomUUID(),agentUserId,window.week_started_at,window.week_ended_at,
          JSON.stringify({schemaVersion:'agent-paper-research-weekly-report-v1',health:base.health,blockers:base.blockers,backlog:base.backlog,monthlyBudget:base.monthlyBudget,errors:base.errors})]);weeklyReportCreated=inserted.rowCount===1;
          if(weeklyReportCreated&&policy.email_notifications_enabled)await client.query(`INSERT INTO agent_research_operation_deliveries(id,agent_user_id,kind,dedupe_key,payload_json)
            VALUES($1,$2,'weekly-report',$3,$4) ON CONFLICT(agent_user_id,dedupe_key)DO NOTHING`,[crypto.randomUUID(),agentUserId,`weekly:${iso(window.week_started_at)}`,
            JSON.stringify({health:base.health,blockers:base.blockers,backlog:base.backlog,monthlyBudget:base.monthlyBudget})]);}}
      const cutoff=new Date(observedAt.getTime()-policy.metric_retention_days*86400000);
      const deleted=await client.query(`DELETE FROM agent_research_metric_snapshots WHERE agent_user_id=$1 AND observed_at<$2`,[agentUserId,cutoff]);
      if(deleted.rowCount)await client.query(`INSERT INTO agent_research_retention_runs(id,agent_user_id,mode,reason,cutoff_at,deleted_metric_snapshots)
        VALUES($1,$2,'automatic','自动清理超出策略期限的派生健康快照',$3,$4)`,[crypto.randomUUID(),agentUserId,cutoff,deleted.rowCount]);
      return{opened,resolved,weeklyReportCreated,deletedMetricSnapshots:deleted.rowCount};
    });
    return{schemaVersion:'agent-paper-research-operations-evaluation-v1',agentUserId,observedAt:iso(observedAt),health:base.health,...result};
  };
  const deliverPending=async(agentUserId,{limit=10}={})=>{
    agentUserId=id(agentUserId);
    if(!notificationSender?.configured||typeof notificationSender.sendOperationsMessage!=='function')return{configured:false,examined:0,sent:0,failed:0};
    const rows=(await pool.query(`SELECT delivery.*,identity.subject AS email FROM agent_research_operation_deliveries delivery
      JOIN agent_accounts account ON account.user_id=delivery.agent_user_id
      JOIN auth_identities identity ON identity.user_id=account.operator_user_id AND identity.provider='email'
      WHERE delivery.agent_user_id=$1 AND delivery.status='pending' AND delivery.next_attempt_at<=now()
      ORDER BY delivery.created_at,delivery.id LIMIT $2`,[agentUserId,Math.max(1,Math.min(50,Number(limit)||10))])).rows;
    let sent=0,failed=0;
    for(const row of rows){const title=row.kind==='weekly-report'?'小墨鱼论文研究周报':row.kind==='alert.resolved'?'小墨鱼研究告警已恢复':'小墨鱼论文研究告警';
      const text=`${title}\n\n${row.payload_json.code??`当前健康状态：${row.payload_json.health??'未知'}`}\n\n这是服务端自动运维消息。`;
      try{await notificationSender.sendOperationsMessage({email:row.email,subject:title,text,
          html:`<div lang="zh-CN" style="font-family:system-ui;max-width:620px;margin:auto;padding:24px;border:1px solid #d8d3e5"><h2>${title}</h2><pre style="white-space:pre-wrap">${text}</pre></div>`});
        await pool.query(`UPDATE agent_research_operation_deliveries SET status='sent',attempts=attempts+1,sent_at=now(),updated_at=now(),last_error=NULL WHERE id=$1 AND status='pending'`,[row.id]);sent++;
      }catch(error){await pool.query(`UPDATE agent_research_operation_deliveries SET attempts=attempts+1,last_error=$2,
          next_attempt_at=now()+(least(3600,power(2,least(attempts,10))::int)*interval '1 second'),updated_at=now() WHERE id=$1 AND status='pending'`,[row.id,String(error?.message??error).slice(0,1000)]);failed++;}}
    return{configured:true,examined:rows.length,sent,failed};
  };
  const recoverExpiredStage=async(actor,agentUserId,executionId,{requestId,reason}={})=>{
    const scoped=await scope(actor,agentUserId);executionId=id(executionId);requestId=id(requestId);
    reason=String(reason??'').trim();if(reason.length<10||reason.length>1000)fail('PAPER_RESEARCH_OPERATIONS_REASON_INVALID');
    const existing=(await pool.query(`SELECT * FROM agent_runtime_operator_actions WHERE agent_user_id=$1 AND request_id=$2`,[scoped.agentUserId,requestId])).rows[0];
    if(existing){if(existing.precondition_json?.executionId!==executionId||existing.reason!==reason)fail('PAPER_RESEARCH_OPERATIONS_IDEMPOTENCY_CONFLICT');return existing.result_json;}
    const row=(await pool.query(`SELECT execution.id,execution.runtime_run_id,execution.status AS execution_status,
        run.status AS run_status,stage.id AS stage_id,stage.stage_key,stage.status AS stage_status,
        stage.attempt,stage.max_attempts,stage.leased_by,stage.lease_until,stage.attempt_started_at,stage.timeout_seconds,
        (stage.status IN('leased','running') AND (stage.lease_until<=now()
          OR stage.attempt_started_at+(stage.timeout_seconds*interval '1 second')<=now())) AS recoverable
      FROM agent_paper_research_executions execution JOIN agent_runs run ON run.id=execution.runtime_run_id
      JOIN LATERAL(SELECT candidate.* FROM agent_run_stages candidate WHERE candidate.run_id=run.id
        AND candidate.status IN('leased','running') ORDER BY candidate.ordinal LIMIT 1)stage ON true
      WHERE execution.agent_user_id=$1 AND execution.id=$2 AND run.workflow_key=$3`,[scoped.agentUserId,executionId,WORKFLOW])).rows[0];
    if(!row)fail('PAPER_RESEARCH_OPERATIONS_EXECUTION_NOT_FOUND');
    if(row.recoverable!==true)fail('PAPER_RESEARCH_OPERATIONS_LEASE_ACTIVE',{stageId:row.stage_id,leaseUntil:iso(row.lease_until)});
    const precondition={executionId,executionStatus:row.execution_status,runStatus:row.run_status,stageId:row.stage_id,stageKey:row.stage_key,stageStatus:row.stage_status,attempt:row.attempt,maxAttempts:row.max_attempts,leaseUntil:iso(row.lease_until),leasedBy:row.leased_by};
    const recovery=await runtimeRepository.recoverExpiredStages({stageId:row.stage_id,workerId:`operator-recovery-${scoped.operatorId}`.slice(0,120),limit:1,baseBackoffSeconds:0});
    const result={schemaVersion:'agent-paper-research-recovery-v1',executionId,runId:row.runtime_run_id,stageId:row.stage_id,stageKey:row.stage_key,recovery};
    try{await withTransaction(pool,async client=>{
      await client.query(`INSERT INTO agent_runtime_operator_actions(id,agent_user_id,operator_user_id,run_id,stage_id,request_id,action_type,reason,precondition_json,result_json)
        VALUES($1,$2,$3,$4,$5,$6,'expired-stage.recover',$7,$8,$9)`,[crypto.randomUUID(),scoped.agentUserId,scoped.operatorId,row.runtime_run_id,row.stage_id,requestId,reason,JSON.stringify(precondition),JSON.stringify(result)]);
      await client.query(`INSERT INTO agent_paper_research_execution_events(id,execution_id,agent_user_id,actor_kind,actor_ref,event_type,stage_key,payload_json)
        VALUES($1,$2,$3,'operator',$4,'execution.requeued',$5,$6)`,[crypto.randomUUID(),executionId,scoped.agentUserId,scoped.operatorId,row.stage_key,JSON.stringify({reason,requestId,recovery})]);
    });}catch(error){if(error?.code!=='23505')throw error;const duplicate=(await pool.query(`SELECT result_json,precondition_json,reason FROM agent_runtime_operator_actions WHERE agent_user_id=$1 AND request_id=$2`,[scoped.agentUserId,requestId])).rows[0];if(!duplicate||duplicate.precondition_json?.executionId!==executionId||duplicate.reason!==reason)fail('PAPER_RESEARCH_OPERATIONS_IDEMPOTENCY_CONFLICT');return duplicate.result_json;}
    return result;
  };
  return Object.freeze({snapshot,configurePolicy,retentionPreview,applyRetention,evaluate,deliverPending,recoverExpiredStage});
}
