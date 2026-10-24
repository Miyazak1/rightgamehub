import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { assertStateTransition, normalizeActionDefinition, normalizeWorkflowManifest, workflowManifestDigest } from './agent-runtime-contracts.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentRuntimeRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentRuntimeRepositoryError';
    this.code = code;
  }
}

const fail = code => { throw new AgentRuntimeRepositoryError(code); };
const iso = value => value?.toISOString?.() ?? value ?? null;
const json = value => JSON.stringify(value);

function stageView(row) {
  return row ? {
    id: row.id,
    runId: row.run_id,
    stageKey: row.stage_key,
    ordinal: row.ordinal,
    kind: row.kind,
    dependsOn: row.depends_on,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    timeoutSeconds: row.timeout_seconds,
    leaseToken: row.lease_token,
    leasedBy: row.leased_by,
    leaseUntil: iso(row.lease_until),
    outputRef: row.output_ref_json,
    errorCode: row.error_code,
  } : null;
}

function actionView(row) {
  return row ? {
    id: row.id,
    runId: row.run_id,
    stageId: row.stage_id,
    actionKey: row.action_key,
    actionKind: row.action_kind,
    capabilityKey: row.capability_key,
    contractVersion: row.contract_version,
    riskLevel: row.risk_level,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    providerRequestId: row.provider_request_id,
    reservationRef: row.reservation_ref,
    responseRef: row.response_ref_json,
    usage: row.usage_json,
    sentAt: iso(row.sent_at),
    acknowledgedAt: iso(row.acknowledged_at),
    finishedAt: iso(row.finished_at),
  } : null;
}

export class PostgresAgentRuntimeRepository {
  constructor(pool) { this.pool = pool; }

  async registerWorkflow({ actorUserId, manifest: input, runtimeMinVersion = '1.0.0', status = 'draft' }) {
    const manifest = normalizeWorkflowManifest(input);
    const digest = workflowManifestDigest(manifest);
    const row = (await this.pool.query(`
      INSERT INTO agent_workflow_definitions(
        workflow_key,workflow_version,schema_version,manifest_json,manifest_sha256,runtime_min_version,status,created_by_user_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(workflow_key,workflow_version) DO NOTHING
      RETURNING *`, [manifest.workflowKey, manifest.workflowVersion, manifest.schemaVersion, json(manifest), digest, runtimeMinVersion, status, actorUserId])).rows[0];
    if (row) return { workflowKey: row.workflow_key, workflowVersion: row.workflow_version, manifestSha256: row.manifest_sha256, status: row.status };
    const existing = (await this.pool.query('SELECT * FROM agent_workflow_definitions WHERE workflow_key=$1 AND workflow_version=$2', [manifest.workflowKey, manifest.workflowVersion])).rows[0];
    if (!existing || existing.manifest_sha256 !== digest) fail('AGENT_WORKFLOW_VERSION_CONFLICT');
    return { workflowKey: existing.workflow_key, workflowVersion: existing.workflow_version, manifestSha256: existing.manifest_sha256, status: existing.status };
  }

  async activateWorkflow(workflowKey, workflowVersion) {
    const row = (await this.pool.query(`UPDATE agent_workflow_definitions SET status='active',updated_at=now()
      WHERE workflow_key=$1 AND workflow_version=$2 AND status='draft' RETURNING *`, [workflowKey, workflowVersion])).rows[0];
    if (!row) fail('AGENT_WORKFLOW_NOT_ACTIVATABLE');
    return { workflowKey: row.workflow_key, workflowVersion: row.workflow_version, status: row.status };
  }

  async createRun({
    id = crypto.randomUUID(), agentUserId, workflowKey, workflowVersion, triggerKind, triggerRef = null,
    idempotencyKey, input = {}, config = {}, budget = null,
  }) {
    return withTransaction(this.pool, async client => {
      const workflow = (await client.query(`SELECT * FROM agent_workflow_definitions
        WHERE workflow_key=$1 AND workflow_version=$2 AND status='active' FOR SHARE`, [workflowKey, workflowVersion])).rows[0];
      if (!workflow) fail('AGENT_WORKFLOW_NOT_ACTIVE');
      const manifest = normalizeWorkflowManifest(workflow.manifest_json);
      const identity = (await client.query(`SELECT a.status AS agent_status,u.status AS user_status,
          b.active_profile_id,p.active_policy_profile_id
        FROM agent_accounts a JOIN users u ON u.id=a.user_id
        JOIN agent_behavior_profile_assignments b ON b.agent_user_id=a.user_id
        JOIN agent_policy_profile_assignments p ON p.agent_user_id=a.user_id
        WHERE a.user_id=$1 FOR SHARE OF a,u,b,p`, [agentUserId])).rows[0];
      if (!identity || identity.agent_status !== 'active' || identity.user_status !== 'active') fail('AGENT_RUNTIME_AGENT_INACTIVE');
      const required = manifest.requiredCapabilities;
      const grants = required.length ? (await client.query(`SELECT id,capability_key,contract_version,scope_json,risk_ceiling
        FROM agent_capability_grants WHERE agent_user_id=$1 AND status='active' AND valid_from<=now()
          AND (valid_until IS NULL OR valid_until>now())
          AND (capability_key,contract_version) IN (SELECT * FROM unnest($2::text[],$3::integer[]))
        ORDER BY capability_key,contract_version,id`, [agentUserId, required.map(item => item.key), required.map(item => item.version)])).rows : [];
      for (const capability of required) if (!grants.some(grant => grant.capability_key === capability.key && grant.contract_version === capability.version)) fail('AGENT_RUNTIME_CAPABILITY_MISSING');
      const inputHash = stableHash(input);
      const existing = (await client.query(`SELECT * FROM agent_runs
        WHERE agent_user_id=$1 AND workflow_key=$2 AND idempotency_key=$3 FOR UPDATE`, [agentUserId, workflowKey, idempotencyKey])).rows[0];
      if (existing) {
        const requestedBudget = budget ?? manifest.defaultBudget;
        if (existing.workflow_version !== workflowVersion || existing.input_sha256 !== inputHash
          || existing.manifest_sha256 !== workflow.manifest_sha256 || existing.trigger_kind !== triggerKind
          || existing.trigger_ref !== triggerRef || stableHash(existing.config_snapshot) !== stableHash(config)
          || stableHash(existing.budget_json) !== stableHash(requestedBudget)) fail('AGENT_RUN_IDEMPOTENCY_CONFLICT');
        return { id: existing.id, status: existing.status, existing: true };
      }
      const capabilitySnapshot = {
        schemaVersion: 'agent-capability-snapshot-v1',
        grants: grants.map(grant => ({ id: grant.id, key: grant.capability_key, version: grant.contract_version, scope: grant.scope_json, riskCeiling: grant.risk_ceiling })),
      };
      const run = (await client.query(`INSERT INTO agent_runs(
        id,agent_user_id,workflow_key,workflow_version,manifest_sha256,trigger_kind,trigger_ref,idempotency_key,status,
        behavior_profile_id,policy_profile_id,capability_snapshot,config_snapshot,input_json,input_sha256,budget_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [
        id, agentUserId, workflowKey, workflowVersion, workflow.manifest_sha256, triggerKind, triggerRef, idempotencyKey,
        identity.active_profile_id, identity.active_policy_profile_id, json(capabilitySnapshot), json(config), json(input), inputHash, json(budget ?? manifest.defaultBudget),
      ])).rows[0];
      for (const [ordinal, stage] of manifest.stages.entries()) {
        const stageId = crypto.randomUUID();
        const status = stage.dependsOn.length ? 'blocked' : 'queued';
        const stageInputHash = stableHash({ runId: id, stageKey: stage.key, inputHash });
        await client.query(`INSERT INTO agent_run_stages(
          id,run_id,stage_key,ordinal,kind,depends_on,status,max_attempts,timeout_seconds,input_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [stageId, id, stage.key, ordinal, stage.kind, stage.dependsOn, status, stage.maxAttempts, stage.timeoutSeconds, stageInputHash]);
        if (status === 'queued') await client.query(`INSERT INTO agent_runtime_outbox(
          id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json
        ) VALUES($1,'stage',$2,'stage.available',$3,$4)`, [crypto.randomUUID(), stageId, `stage-available:${stageId}:0`, json({ runId: id, stageId, stageKey: stage.key })]);
      }
      await client.query(`INSERT INTO agent_run_events(run_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,'run.created','system',NULL,$2)`, [id, json({ triggerKind, workflowKey, workflowVersion })]);
      return { id: run.id, status: run.status, existing: false };
    });
  }

  async claimNextStage(workerId, leaseSeconds = 60) {
    if (typeof workerId !== 'string' || workerId.length < 1 || workerId.length > 120) fail('AGENT_RUNTIME_WORKER_INVALID');
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 3600) fail('AGENT_RUNTIME_LEASE_INVALID');
    return withTransaction(this.pool, async client => {
      const leaseToken = crypto.randomUUID();
      const row = (await client.query(`WITH candidate AS (
        SELECT s.id FROM agent_run_stages s JOIN agent_runs r ON r.id=s.run_id
        WHERE s.status='queued' AND s.available_at<=now() AND s.attempt<s.max_attempts
          AND r.status IN ('queued','running','waiting')
        ORDER BY s.available_at,s.created_at,s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1
      ) UPDATE agent_run_stages s SET status='leased',attempt=attempt+1,lease_token=$2,leased_by=$1,
        lease_until=now()+($3*interval '1 second'),started_at=COALESCE(started_at,now()),updated_at=now()
        FROM candidate WHERE s.id=candidate.id RETURNING s.*`, [workerId, leaseToken, leaseSeconds])).rows[0];
      if (!row) return null;
      await client.query(`UPDATE agent_runs SET status='running',started_at=COALESCE(started_at,now()),updated_at=now()
        WHERE id=$1 AND status IN ('queued','waiting')`, [row.run_id]);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,$2,'stage.leased','worker',$3,$4)`, [row.run_id, row.id, workerId, json({ attempt: row.attempt, leaseToken })]);
      return stageView(row);
    });
  }

  async startStage({ stageId, workerId, leaseToken }) {
    const row = (await this.pool.query(`UPDATE agent_run_stages SET status='running',updated_at=now()
      WHERE id=$1 AND status='leased' AND leased_by=$2 AND lease_token=$3 AND lease_until>now() RETURNING *`, [stageId, workerId, leaseToken])).rows[0];
    if (!row) fail('AGENT_RUNTIME_LEASE_LOST');
    return stageView(row);
  }

  async renewStageLease({ stageId, workerId, leaseToken, leaseSeconds = 60 }) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 3600) fail('AGENT_RUNTIME_LEASE_INVALID');
    const row = (await this.pool.query(`UPDATE agent_run_stages SET lease_until=now()+($4*interval '1 second'),updated_at=now()
      WHERE id=$1 AND status IN ('leased','running') AND leased_by=$2 AND lease_token=$3 AND lease_until>now()
      RETURNING lease_until`, [stageId, workerId, leaseToken, leaseSeconds])).rows[0];
    if (!row) fail('AGENT_RUNTIME_LEASE_LOST');
    return iso(row.lease_until);
  }

  async completeStage({ stageId, workerId, leaseToken, outputRef = {} }) {
    return withTransaction(this.pool, async client => {
      const locked = (await client.query(`SELECT * FROM agent_run_stages WHERE id=$1 AND status IN ('leased','running')
        AND leased_by=$2 AND lease_token=$3 AND lease_until>now() FOR UPDATE`, [stageId, workerId, leaseToken])).rows[0];
      if (!locked) fail('AGENT_RUNTIME_LEASE_LOST');
      const incompleteActions = Number((await client.query(`SELECT count(*)::int AS n FROM agent_run_actions
        WHERE stage_id=$1 AND status NOT IN ('succeeded','rejected','failed','uncertain','cancelled')`, [stageId])).rows[0]?.n ?? 0);
      if (incompleteActions !== 0) fail('AGENT_RUNTIME_ACTIONS_INCOMPLETE');
      const row = (await client.query(`UPDATE agent_run_stages SET status='succeeded',output_ref_json=$4,
        lease_token=NULL,leased_by=NULL,lease_until=NULL,finished_at=now(),updated_at=now()
        WHERE id=$1 AND status IN ('leased','running') AND leased_by=$2 AND lease_token=$3 AND lease_until>now()
        RETURNING *`, [stageId, workerId, leaseToken, json(outputRef)])).rows[0];
      if (!row) fail('AGENT_RUNTIME_LEASE_LOST');
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,$2,'stage.succeeded','worker',$3,$4)`, [row.run_id, row.id, workerId, json({ outputRef })]);
      const unlocked = (await client.query(`UPDATE agent_run_stages candidate SET status='queued',available_at=now(),updated_at=now()
        WHERE candidate.run_id=$1 AND candidate.status='blocked'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(candidate.depends_on) dependency
            LEFT JOIN agent_run_stages prerequisite ON prerequisite.run_id=candidate.run_id AND prerequisite.stage_key=dependency
            WHERE prerequisite.status IS DISTINCT FROM 'succeeded'
          ) RETURNING candidate.*`, [row.run_id])).rows;
      for (const stage of unlocked) {
        await client.query(`INSERT INTO agent_runtime_outbox(id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json)
          VALUES($1,'stage',$2,'stage.available',$3,$4) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), stage.id, `stage-available:${stage.id}:${stage.attempt}`, json({ runId: row.run_id, stageId: stage.id, stageKey: stage.stage_key })]);
        await client.query(`INSERT INTO agent_run_events(run_id,stage_id,event_type,actor_kind,payload_json)
          VALUES($1,$2,'stage.queued','system',$3)`, [row.run_id, stage.id, json({ unlockedBy: row.stage_key })]);
      }
      return { stage: stageView(row), unlocked: unlocked.map(stageView) };
    });
  }

  async failStage({ stageId, workerId, leaseToken, errorCode, errorMessage, retryable = false, backoffSeconds = 0, uncertain = false }) {
    return withTransaction(this.pool, async client => {
      const stage = (await client.query(`SELECT * FROM agent_run_stages WHERE id=$1 AND status IN ('leased','running')
        AND leased_by=$2 AND lease_token=$3 AND lease_until>now() FOR UPDATE`, [stageId, workerId, leaseToken])).rows[0];
      if (!stage) fail('AGENT_RUNTIME_LEASE_LOST');
      const retry = retryable && !uncertain && stage.attempt < stage.max_attempts;
      const nextStatus = retry ? 'queued' : uncertain ? 'uncertain' : 'failed';
      const row = (await client.query(`UPDATE agent_run_stages SET status=$2,available_at=CASE WHEN $2='queued'
          THEN now()+($5*interval '1 second') ELSE available_at END,lease_token=NULL,leased_by=NULL,lease_until=NULL,
        error_code=$3,error_message=$4,finished_at=CASE WHEN $2='queued' THEN NULL ELSE now() END,updated_at=now()
        WHERE id=$1 RETURNING *`, [stageId, nextStatus, errorCode, errorMessage, backoffSeconds])).rows[0];
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,$2,$3,'worker',$4,$5)`, [row.run_id, row.id, retry ? 'stage.retry-scheduled' : `stage.${nextStatus}`, workerId, json({ errorCode, retryable: retry, backoffSeconds })]);
      if (retry) {
        await client.query(`INSERT INTO agent_runtime_outbox(id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,available_at)
          VALUES($1,'stage',$2,'stage.available',$3,$4,now()+($5*interval '1 second')) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), row.id, `stage-available:${row.id}:${row.attempt}`, json({ runId: row.run_id, stageId: row.id, stageKey: row.stage_key }), backoffSeconds]);
      } else {
        await client.query(`UPDATE agent_run_stages SET status='cancelled',lease_token=NULL,leased_by=NULL,lease_until=NULL,
          finished_at=now(),updated_at=now(),error_code='AGENT_RUN_TERMINATED'
          WHERE run_id=$1 AND id<>$2 AND status IN ('blocked','queued','leased','running','waiting')`, [row.run_id, row.id]);
        await client.query(`UPDATE agent_runs SET status=$2,error_code=$3,error_message=$4,finished_at=now(),updated_at=now()
          WHERE id=$1 AND status IN ('queued','running','waiting')`, [row.run_id, nextStatus, errorCode, errorMessage]);
      }
      return { stage: stageView(row), retryScheduled: retry };
    });
  }

  async finalizeRun({ runId, outputType, outputId }) {
    return withTransaction(this.pool, async client => {
      const incomplete = Number((await client.query(`SELECT count(*)::int AS n FROM agent_run_stages
        WHERE run_id=$1 AND status NOT IN ('succeeded','skipped')`, [runId])).rows[0]?.n ?? 0);
      if (incomplete !== 0) fail('AGENT_RUN_STAGES_INCOMPLETE');
      const row = (await client.query(`UPDATE agent_runs SET status='succeeded',output_type=$2,output_id=$3,
        finished_at=now(),updated_at=now() WHERE id=$1 AND status='running' RETURNING *`, [runId, outputType, outputId])).rows[0];
      if (!row) fail('AGENT_RUN_NOT_FINALIZABLE');
      await client.query(`INSERT INTO agent_run_events(run_id,event_type,actor_kind,payload_json)
        VALUES($1,'run.succeeded','system',$2)`, [runId, json({ outputType, outputId })]);
      return { id: row.id, status: row.status, outputType: row.output_type, outputId: row.output_id };
    });
  }

  async createAction({ runId, stageId, action, idempotencyKey, request, policyDecision }) {
    action = normalizeActionDefinition(action);
    const requestHash = stableHash(request);
    const row = (await this.pool.query(`INSERT INTO agent_run_actions(
      id,run_id,stage_id,action_key,action_kind,capability_key,contract_version,risk_level,idempotency_key,
      request_json,request_sha256,policy_decision_json
    ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      WHERE EXISTS(SELECT 1 FROM agent_run_stages WHERE id=$3 AND run_id=$2 AND status='running')
      ON CONFLICT(stage_id,action_key,idempotency_key) DO NOTHING RETURNING *`, [crypto.randomUUID(), runId, stageId, action.actionKey, action.actionKind, action.capabilityKey, action.contractVersion, action.riskLevel, idempotencyKey, json(request), requestHash, json(policyDecision)])).rows[0];
    if (row) return { id: row.id, status: row.status, existing: false };
    const existing = (await this.pool.query(`SELECT * FROM agent_run_actions
      WHERE stage_id=$1 AND action_key=$2 AND idempotency_key=$3`, [stageId, action.actionKey, idempotencyKey])).rows[0];
    if (!existing) fail('AGENT_ACTION_STAGE_NOT_RUNNING');
    if (existing.request_sha256 !== requestHash || existing.action_kind !== action.actionKind
      || existing.capability_key !== action.capabilityKey || existing.contract_version !== action.contractVersion
      || existing.risk_level !== action.riskLevel
      || stableHash(existing.policy_decision_json) !== stableHash(policyDecision)) fail('AGENT_ACTION_IDEMPOTENCY_CONFLICT');
    return { id: existing.id, status: existing.status, existing: true };
  }

  async transitionAction({
    actionId, from, to, reservationRef = null, providerRequestId = null, responseRef = null,
    responseSha256 = null, usage = null, errorCode = null, errorMessage = null,
  }) {
    assertStateTransition('action', from, to);
    return withTransaction(this.pool, async client => {
      const current = (await client.query('SELECT * FROM agent_run_actions WHERE id=$1 FOR UPDATE', [actionId])).rows[0];
      if (!current) fail('AGENT_ACTION_NOT_FOUND');
      if (current.status === to) return { ...actionView(current), existing: true };
      if (current.status !== from) fail('AGENT_ACTION_STATE_CONFLICT');
      const terminal = ['succeeded', 'rejected', 'failed', 'uncertain', 'cancelled'].includes(to);
      const row = (await client.query(`UPDATE agent_run_actions SET status=$2,
          reservation_ref=COALESCE($3,reservation_ref),provider_request_id=COALESCE($4,provider_request_id),
          response_ref_json=COALESCE($5,response_ref_json),response_sha256=COALESCE($6,response_sha256),
          usage_json=COALESCE($7,usage_json),error_code=$8,error_message=$9,
          sent_at=CASE WHEN $2='sent' THEN COALESCE(sent_at,now()) ELSE sent_at END,
          acknowledged_at=CASE WHEN $2='acknowledged' THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,
          finished_at=CASE WHEN $10 THEN now() ELSE finished_at END,updated_at=now()
        WHERE id=$1 AND status=$11 RETURNING *`, [actionId, to, reservationRef, providerRequestId,
        responseRef === null ? null : json(responseRef), responseSha256, usage === null ? null : json(usage),
        errorCode, errorMessage, terminal, from])).rows[0];
      if (!row) fail('AGENT_ACTION_STATE_CONFLICT');
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,$4,'system',$5)`, [row.run_id, row.stage_id, row.id, `action.${to}`, json({ from, to, errorCode })]);
      return { ...actionView(row), existing: false };
    });
  }
}
