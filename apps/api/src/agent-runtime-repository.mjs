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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY = /^[a-z][a-z0-9.-]{2,119}$/u;

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
    attemptStartedAt: iso(row.attempt_started_at),
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

function outboxView(row) {
  return row ? {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    dedupeKey: row.dedupe_key,
    payload: row.payload_json,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: iso(row.available_at),
    leaseToken: row.lease_token,
    leaseUntil: iso(row.lease_until),
    lastErrorCode: row.last_error_code,
  } : null;
}

const boundedInteger = (value, min, max, code) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(code);
  return value;
};

const workerIdentifier = value => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 120) fail('AGENT_RUNTIME_WORKER_INVALID');
  return value;
};

const routeKeys = value => {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 256 || value.some(item => typeof item !== 'string' || item.length < 5 || item.length > 201)) fail('AGENT_RUNTIME_ROUTES_INVALID');
  return [...new Set(value)];
};
const policyDigest = value => {
  const copy = structuredClone(value);
  if (copy && typeof copy === 'object') delete copy.decidedAt;
  return stableHash(copy);
};

function normalizeRunHandoff(value) {
  if (value == null) return null;
  const keys = ['kind', 'sourceRunId', 'sourceArtifactId', 'sourceOutputType',
    'sourceArtifactKey', 'sourceContentSha256'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || typeof value.kind !== 'string' || !KEY.test(value.kind)
    || typeof value.sourceRunId !== 'string' || !UUID.test(value.sourceRunId)
    || typeof value.sourceArtifactId !== 'string' || !UUID.test(value.sourceArtifactId)
    || typeof value.sourceOutputType !== 'string' || !KEY.test(value.sourceOutputType)
    || typeof value.sourceArtifactKey !== 'string' || !KEY.test(value.sourceArtifactKey)
    || typeof value.sourceContentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sourceContentSha256)) {
    fail('AGENT_RUN_HANDOFF_INVALID');
  }
  return structuredClone(value);
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
    idempotencyKey, input = {}, config = {}, budget = null, handoff = null,
  }) {
    return withTransaction(this.pool, async client => {
      handoff = normalizeRunHandoff(handoff);
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
        const existingHandoff = (await client.query('SELECT * FROM agent_run_handoffs WHERE target_run_id=$1',
          [existing.id])).rows[0] ?? null;
        const sameHandoff = handoff === null ? existingHandoff === null : existingHandoff !== null
          && existingHandoff.handoff_kind === handoff.kind
          && existingHandoff.source_run_id === handoff.sourceRunId
          && existingHandoff.source_artifact_id === handoff.sourceArtifactId
          && existingHandoff.source_output_type === handoff.sourceOutputType
          && existingHandoff.source_artifact_key === handoff.sourceArtifactKey
          && existingHandoff.source_content_sha256 === handoff.sourceContentSha256
          && existingHandoff.target_input_sha256 === inputHash;
        if (!sameHandoff) fail('AGENT_RUN_IDEMPOTENCY_CONFLICT');
        return { id: existing.id, status: existing.status, existing: true };
      }
      if (handoff) {
        const source = (await client.query(`SELECT source.agent_user_id,source.status,source.output_type,source.output_id,
            artifact.artifact_key,artifact.content_sha256
          FROM agent_runs source JOIN agent_runtime_stage_artifacts artifact
            ON artifact.run_id=source.id AND artifact.id=$2
          WHERE source.id=$1 FOR SHARE OF source,artifact`,
        [handoff.sourceRunId, handoff.sourceArtifactId])).rows[0];
        if (!source || source.agent_user_id !== agentUserId || source.status !== 'succeeded'
          || source.output_id !== handoff.sourceArtifactId || source.output_type !== handoff.sourceOutputType
          || source.artifact_key !== handoff.sourceArtifactKey
          || source.content_sha256 !== handoff.sourceContentSha256) fail('AGENT_RUN_HANDOFF_SOURCE_INVALID');
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
      if (handoff) await client.query(`INSERT INTO agent_run_handoffs(
          id,agent_user_id,handoff_kind,source_run_id,source_artifact_id,source_output_type,
          source_artifact_key,source_content_sha256,target_run_id,target_input_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [crypto.randomUUID(), agentUserId, handoff.kind,
        handoff.sourceRunId, handoff.sourceArtifactId, handoff.sourceOutputType,
        handoff.sourceArtifactKey, handoff.sourceContentSha256, run.id, inputHash]);
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
      if (handoff) await client.query(`INSERT INTO agent_run_events(run_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,'run.handoff-accepted','system',NULL,$2)`, [id, json({ handoffKind: handoff.kind,
        sourceRunId: handoff.sourceRunId, sourceArtifactId: handoff.sourceArtifactId,
        sourceContentSha256: handoff.sourceContentSha256 })]);
      return { id: run.id, status: run.status, existing: false };
    });
  }

  async claimNextStage(workerId, leaseSeconds = 60, supportedRoutes = null) {
    workerIdentifier(workerId);
    boundedInteger(leaseSeconds, 5, 3600, 'AGENT_RUNTIME_LEASE_INVALID');
    const routes = routeKeys(supportedRoutes);
    if (routes?.length === 0) return null;
    return withTransaction(this.pool, async client => {
      const leaseToken = crypto.randomUUID();
      const row = (await client.query(`WITH agent_queue AS (
        SELECT r.agent_user_id,
          count(DISTINCT active.id) FILTER (WHERE active.status IN ('leased','running')) AS active_count,
          min(s.available_at) AS oldest_available
        FROM agent_run_stages s
        JOIN agent_runs r ON r.id=s.run_id
        LEFT JOIN agent_runs active_run ON active_run.agent_user_id=r.agent_user_id
          AND active_run.status IN ('queued','running','waiting')
        LEFT JOIN agent_run_stages active ON active.run_id=active_run.id AND active.status IN ('leased','running')
        WHERE s.status='queued' AND s.available_at<=now() AND s.attempt<s.max_attempts
          AND r.status IN ('queued','running','waiting')
          AND ($4::text[] IS NULL OR (r.workflow_key||':'||s.stage_key)=ANY($4))
        GROUP BY r.agent_user_id
      ), candidate AS (
        SELECT s.id FROM agent_run_stages s
        JOIN agent_runs r ON r.id=s.run_id
        JOIN agent_accounts account ON account.user_id=r.agent_user_id
        JOIN agent_queue queue ON queue.agent_user_id=r.agent_user_id
        WHERE s.status='queued' AND s.available_at<=now() AND s.attempt<s.max_attempts
          AND r.status IN ('queued','running','waiting')
          AND ($4::text[] IS NULL OR (r.workflow_key||':'||s.stage_key)=ANY($4))
        ORDER BY queue.active_count,queue.oldest_available,s.available_at,s.created_at,s.id
        FOR UPDATE OF account,s SKIP LOCKED LIMIT 1
      ) UPDATE agent_run_stages s SET status='leased',attempt=attempt+1,lease_token=$2,leased_by=$1,
        lease_until=now()+($3*interval '1 second'),attempt_started_at=now(),started_at=COALESCE(started_at,now()),updated_at=now()
        FROM candidate WHERE s.id=candidate.id RETURNING s.*`, [workerId, leaseToken, leaseSeconds, routes])).rows[0];
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

  async completeStage({ stageId, workerId, leaseToken, outputRef = {}, runOutput = null }) {
    return withTransaction(this.pool, async client => {
      const locked = (await client.query(`SELECT * FROM agent_run_stages WHERE id=$1 AND status IN ('leased','running')
        AND leased_by=$2 AND lease_token=$3 AND lease_until>now() FOR UPDATE`, [stageId, workerId, leaseToken])).rows[0];
      if (!locked) fail('AGENT_RUNTIME_LEASE_LOST');
      const incompleteActions = Number((await client.query(`SELECT count(*)::int AS n FROM agent_run_actions
        WHERE stage_id=$1 AND status NOT IN ('succeeded','rejected','failed','uncertain','cancelled')`, [stageId])).rows[0]?.n ?? 0);
      if (incompleteActions !== 0) fail('AGENT_RUNTIME_ACTIONS_INCOMPLETE');
      const row = (await client.query(`UPDATE agent_run_stages SET status='succeeded',output_ref_json=$4,
        lease_token=NULL,leased_by=NULL,lease_until=NULL,attempt_started_at=NULL,finished_at=now(),updated_at=now()
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
      let finalizedRun = null;
      if (runOutput !== null) {
        if (!runOutput || typeof runOutput.type !== 'string' || typeof runOutput.id !== 'string') fail('AGENT_RUN_OUTPUT_INVALID');
        const remaining = Number((await client.query(`SELECT count(*)::int AS n FROM agent_run_stages
          WHERE run_id=$1 AND status NOT IN ('succeeded','skipped')`, [row.run_id])).rows[0]?.n ?? 0);
        if (remaining !== 0) fail('AGENT_RUN_OUTPUT_EARLY');
        finalizedRun = (await client.query(`UPDATE agent_runs SET status='succeeded',output_type=$2,output_id=$3,
          finished_at=now(),updated_at=now() WHERE id=$1 AND status='running' RETURNING *`,
        [row.run_id, runOutput.type, runOutput.id])).rows[0];
        if (!finalizedRun) fail('AGENT_RUN_NOT_FINALIZABLE');
        await client.query(`INSERT INTO agent_run_events(run_id,event_type,actor_kind,actor_ref,payload_json)
          VALUES($1,'run.succeeded','worker',$2,$3)`, [row.run_id, workerId, json({ outputType: runOutput.type, outputId: runOutput.id })]);
      }
      return { stage: stageView(row), unlocked: unlocked.map(stageView), run: finalizedRun ? {
        id: finalizedRun.id, status: finalizedRun.status, outputType: finalizedRun.output_type, outputId: finalizedRun.output_id,
      } : null };
    });
  }

  async failStage({ stageId, workerId, leaseToken, errorCode, errorMessage, retryable = false, backoffSeconds = 0, uncertain = false }) {
    return withTransaction(this.pool, async client => {
      const stage = (await client.query(`SELECT * FROM agent_run_stages WHERE id=$1 AND status IN ('leased','running')
        AND leased_by=$2 AND lease_token=$3 AND lease_until>now() FOR UPDATE`, [stageId, workerId, leaseToken])).rows[0];
      if (!stage) fail('AGENT_RUNTIME_LEASE_LOST');
      const exposed = (await client.query(`SELECT id,status FROM agent_run_actions WHERE stage_id=$1
        AND status IN ('sending','sent','acknowledged','uncertain') FOR UPDATE`, [stageId])).rows;
      const unsafeOutcome = uncertain || exposed.length > 0;
      if (exposed.length) {
        await client.query(`UPDATE agent_budget_reservations reservation SET status='uncertain',
          charged_provider_calls=reserved_provider_calls,charged_input_tokens=reserved_input_tokens,
          charged_output_tokens=reserved_output_tokens,charged_cost_microusd=reserved_cost_microusd,
          settled_at=now(),updated_at=now() FROM agent_run_actions action
          WHERE action.stage_id=$1 AND reservation.action_id=action.id AND reservation.status='reserved'`, [stageId]);
        await client.query(`UPDATE agent_provider_calls call SET status='uncertain',error_code=$2,error_message=$3,
          finished_at=now(),updated_at=now() FROM agent_run_actions action
          WHERE action.stage_id=$1 AND call.action_id=action.id AND call.status IN ('sending','acknowledged')`,
        [stageId, errorCode, errorMessage]);
      }
      if (exposed.length) await client.query(`UPDATE agent_run_actions SET status='uncertain',error_code=$2,error_message=$3,
        finished_at=now(),updated_at=now() WHERE stage_id=$1 AND status IN ('sending','sent','acknowledged')`,
      [stageId, errorCode, errorMessage]);
      await client.query(`UPDATE agent_budget_reservations reservation SET status='released',released_at=now(),updated_at=now()
        FROM agent_run_actions action WHERE action.stage_id=$1 AND reservation.action_id=action.id
          AND reservation.status='reserved' AND action.status IN ('prepared','authorized','reserved')`, [stageId]);
      await client.query(`UPDATE agent_provider_calls call SET status='failed',error_code=$2,error_message=$3,
        finished_at=now(),updated_at=now() FROM agent_run_actions action
        WHERE action.stage_id=$1 AND call.action_id=action.id AND call.status='reserved'
          AND action.status IN ('prepared','authorized','reserved')`, [stageId, errorCode, errorMessage]);
      await client.query(`UPDATE agent_run_actions SET status='cancelled',error_code=$2,error_message=$3,
        finished_at=now(),updated_at=now() WHERE stage_id=$1 AND status IN ('prepared','authorized','reserved')`,
      [stageId, errorCode, errorMessage]);
      const retry = retryable && !unsafeOutcome && stage.attempt < stage.max_attempts;
      const nextStatus = retry ? 'queued' : unsafeOutcome ? 'uncertain' : 'failed';
      const row = (await client.query(`UPDATE agent_run_stages SET status=$2,available_at=CASE WHEN $2='queued'
          THEN now()+($5*interval '1 second') ELSE available_at END,lease_token=NULL,leased_by=NULL,lease_until=NULL,
        attempt_started_at=NULL,error_code=$3,error_message=$4,finished_at=CASE WHEN $2='queued' THEN NULL ELSE now() END,updated_at=now()
        WHERE id=$1 RETURNING *`, [stageId, nextStatus, errorCode, errorMessage, backoffSeconds])).rows[0];
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,$2,$3,'worker',$4,$5)`, [row.run_id, row.id, retry ? 'stage.retry-scheduled' : `stage.${nextStatus}`, workerId,
      json({ errorCode, retryable: retry, backoffSeconds, externalOutcomeUncertain: unsafeOutcome })]);
      if (retry) {
        await client.query(`INSERT INTO agent_runtime_outbox(id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,available_at)
          VALUES($1,'stage',$2,'stage.available',$3,$4,now()+($5*interval '1 second')) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), row.id, `stage-available:${row.id}:${row.attempt}`, json({ runId: row.run_id, stageId: row.id, stageKey: row.stage_key }), backoffSeconds]);
      } else {
        await client.query(`UPDATE agent_run_stages SET status='cancelled',lease_token=NULL,leased_by=NULL,lease_until=NULL,
          attempt_started_at=NULL,finished_at=now(),updated_at=now(),error_code='AGENT_RUN_TERMINATED'
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
      || policyDigest(existing.policy_decision_json) !== policyDigest(policyDecision)) fail('AGENT_ACTION_IDEMPOTENCY_CONFLICT');
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

  async waitForActionConfirmation({ actionId, stageId, workerId, leaseToken }) {
    return withTransaction(this.pool, async client => {
      const action = (await client.query(`SELECT * FROM agent_run_actions
        WHERE id=$1 AND stage_id=$2 AND status='prepared' FOR UPDATE`, [actionId, stageId])).rows[0];
      if (!action) fail('AGENT_ACTION_STATE_CONFLICT');
      const stage = (await client.query(`UPDATE agent_run_stages SET status='waiting',lease_token=NULL,
        leased_by=NULL,lease_until=NULL,attempt_started_at=NULL,updated_at=now()
        WHERE id=$1 AND status='running' AND leased_by=$2 AND lease_token=$3 AND lease_until>now() RETURNING *`,
      [stageId, workerId, leaseToken])).rows[0];
      if (!stage) fail('AGENT_RUNTIME_LEASE_LOST');
      await client.query(`UPDATE agent_runs SET status='waiting',updated_at=now()
        WHERE id=$1 AND status='running'`, [action.run_id]);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,$2,$3,'action.confirmation-required','system',$4,$5)`, [action.run_id, stage.id, action.id, workerId,
        json({ policyDecision: action.policy_decision_json })]);
      return { action: actionView(action), stage: stageView(stage), runStatus: 'waiting' };
    });
  }

  async loadStageExecutionContext({ stageId, workerId, leaseToken }) {
    workerIdentifier(workerId);
    const row = (await this.pool.query(`SELECT s.*,r.agent_user_id,r.workflow_key,r.workflow_version,
        r.manifest_sha256,r.behavior_profile_id,r.policy_profile_id,r.capability_snapshot,r.config_snapshot,
        r.input_json,r.input_sha256,r.budget_json,w.manifest_json
      FROM agent_run_stages s JOIN agent_runs r ON r.id=s.run_id
      JOIN agent_workflow_definitions w ON w.workflow_key=r.workflow_key AND w.workflow_version=r.workflow_version
      WHERE s.id=$1 AND s.status='running' AND s.leased_by=$2 AND s.lease_token=$3 AND s.lease_until>now()`,
    [stageId, workerId, leaseToken])).rows[0];
    if (!row) fail('AGENT_RUNTIME_LEASE_LOST');
    const prerequisites = (await this.pool.query(`SELECT stage_key,status,output_ref_json FROM agent_run_stages
      WHERE run_id=$1 AND stage_key=ANY($2::text[]) ORDER BY ordinal,id`, [row.run_id, row.depends_on])).rows;
    return {
      run: {
        id: row.run_id, agentUserId: row.agent_user_id, workflowKey: row.workflow_key,
        workflowVersion: row.workflow_version, manifestSha256: row.manifest_sha256,
        behaviorProfileId: row.behavior_profile_id, policyProfileId: row.policy_profile_id,
        capabilitySnapshot: row.capability_snapshot, configSnapshot: row.config_snapshot,
        input: row.input_json, inputSha256: row.input_sha256, budget: row.budget_json,
      },
      stage: stageView(row),
      manifest: normalizeWorkflowManifest(row.manifest_json),
      prerequisites: prerequisites.map(item => ({ stageKey: item.stage_key, status: item.status, outputRef: item.output_ref_json })),
    };
  }

  async claimNextOutbox(workerId, leaseSeconds = 30) {
    workerIdentifier(workerId);
    boundedInteger(leaseSeconds, 5, 600, 'AGENT_RUNTIME_LEASE_INVALID');
    return withTransaction(this.pool, async client => {
      const leaseToken = crypto.randomUUID();
      const row = (await client.query(`WITH candidate AS (
        SELECT id FROM agent_runtime_outbox WHERE status='pending' AND available_at<=now() AND attempts<max_attempts
        ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE agent_runtime_outbox o SET status='dispatching',attempts=attempts+1,lease_token=$1,
        lease_until=now()+($2*interval '1 second'),updated_at=now()
        FROM candidate WHERE o.id=candidate.id RETURNING o.*`, [leaseToken, leaseSeconds])).rows[0];
      return outboxView(row);
    });
  }

  async deliverOutbox({ outboxId, leaseToken }) {
    const row = (await this.pool.query(`UPDATE agent_runtime_outbox SET status='delivered',lease_token=NULL,
      lease_until=NULL,delivered_at=now(),last_error_code=NULL,last_error_message=NULL,updated_at=now()
      WHERE id=$1 AND status='dispatching' AND lease_token=$2 AND lease_until>now() RETURNING *`,
    [outboxId, leaseToken])).rows[0];
    if (!row) fail('AGENT_RUNTIME_OUTBOX_LEASE_LOST');
    return outboxView(row);
  }

  async failOutbox({ outboxId, leaseToken, errorCode, errorMessage, retryable = true, backoffSeconds = 1 }) {
    boundedInteger(backoffSeconds, 0, 3600, 'AGENT_RUNTIME_BACKOFF_INVALID');
    return withTransaction(this.pool, async client => {
      const current = (await client.query(`SELECT * FROM agent_runtime_outbox WHERE id=$1 AND status='dispatching'
        AND lease_token=$2 AND lease_until>now() FOR UPDATE`, [outboxId, leaseToken])).rows[0];
      if (!current) fail('AGENT_RUNTIME_OUTBOX_LEASE_LOST');
      const retry = retryable && current.attempts < current.max_attempts;
      const row = (await client.query(`UPDATE agent_runtime_outbox SET status=$3,lease_token=NULL,lease_until=NULL,
        available_at=CASE WHEN $3='pending' THEN now()+($6*interval '1 second') ELSE available_at END,
        last_error_code=$4,last_error_message=$5,updated_at=now() WHERE id=$1 AND lease_token=$2 RETURNING *`,
      [outboxId, leaseToken, retry ? 'pending' : 'failed', errorCode, errorMessage, backoffSeconds])).rows[0];
      return { message: outboxView(row), retryScheduled: retry };
    });
  }

  async recoverExpiredOutbox({ limit = 25, baseBackoffSeconds = 1 } = {}) {
    boundedInteger(limit, 1, 200, 'AGENT_RUNTIME_RECOVERY_LIMIT_INVALID');
    boundedInteger(baseBackoffSeconds, 0, 300, 'AGENT_RUNTIME_BACKOFF_INVALID');
    return withTransaction(this.pool, async client => {
      const rows = (await client.query(`SELECT * FROM agent_runtime_outbox
        WHERE status='dispatching' AND lease_until<=now() ORDER BY lease_until,id
        FOR UPDATE SKIP LOCKED LIMIT $1`, [limit])).rows;
      let requeued = 0;
      let failed = 0;
      for (const item of rows) {
        const retry = item.attempts < item.max_attempts;
        const backoff = Math.min(300, baseBackoffSeconds * (2 ** Math.max(0, item.attempts - 1)));
        await client.query(`UPDATE agent_runtime_outbox SET status=$2,lease_token=NULL,lease_until=NULL,
          available_at=CASE WHEN $2='pending' THEN now()+($3*interval '1 second') ELSE available_at END,
          last_error_code='AGENT_OUTBOX_LEASE_EXPIRED',last_error_message='Outbox dispatch lease expired before acknowledgement.',updated_at=now()
          WHERE id=$1`, [item.id, retry ? 'pending' : 'failed', backoff]);
        if (retry) requeued += 1; else failed += 1;
      }
      return { examined: rows.length, requeued, failed };
    });
  }

  async recoverExpiredStages({ workerId = 'agent-runtime-recovery', limit = 25, baseBackoffSeconds = 1 } = {}) {
    workerIdentifier(workerId);
    boundedInteger(limit, 1, 200, 'AGENT_RUNTIME_RECOVERY_LIMIT_INVALID');
    boundedInteger(baseBackoffSeconds, 0, 300, 'AGENT_RUNTIME_BACKOFF_INVALID');
    return withTransaction(this.pool, async client => {
      const rows = (await client.query(`SELECT * FROM agent_run_stages
        WHERE status IN ('leased','running') AND (lease_until<=now()
          OR attempt_started_at+(timeout_seconds*interval '1 second')<=now())
        ORDER BY least(lease_until,attempt_started_at+(timeout_seconds*interval '1 second')),id
        FOR UPDATE SKIP LOCKED LIMIT $1`, [limit])).rows;
      const result = { examined: rows.length, requeued: 0, failed: 0, uncertain: 0 };
      for (const stage of rows) {
        const exposed = (await client.query(`SELECT id FROM agent_run_actions WHERE stage_id=$1
          AND status IN ('sending','sent','acknowledged','uncertain') FOR UPDATE`, [stage.id])).rows;
        const errorCode = exposed.length ? 'AGENT_STAGE_RECOVERY_UNCERTAIN' : 'AGENT_STAGE_LEASE_EXPIRED';
        const errorMessage = exposed.length
          ? 'Stage lease expired after an external action crossed the sending boundary.'
          : 'Stage lease or attempt timeout expired before a durable result was committed.';
        if (exposed.length) {
          await client.query(`UPDATE agent_budget_reservations reservation SET status='uncertain',
            charged_provider_calls=reserved_provider_calls,charged_input_tokens=reserved_input_tokens,
            charged_output_tokens=reserved_output_tokens,charged_cost_microusd=reserved_cost_microusd,
            settled_at=now(),updated_at=now() FROM agent_run_actions action
            WHERE action.stage_id=$1 AND reservation.action_id=action.id AND reservation.status='reserved'`, [stage.id]);
          await client.query(`UPDATE agent_provider_calls call SET status='uncertain',error_code=$2,error_message=$3,
            finished_at=now(),updated_at=now() FROM agent_run_actions action
            WHERE action.stage_id=$1 AND call.action_id=action.id AND call.status IN ('sending','acknowledged')`,
          [stage.id, errorCode, errorMessage]);
        }
        if (exposed.length) await client.query(`UPDATE agent_run_actions SET status='uncertain',error_code=$2,
          error_message=$3,finished_at=now(),updated_at=now() WHERE stage_id=$1 AND status IN ('sending','sent','acknowledged')`,
        [stage.id, errorCode, errorMessage]);
        await client.query(`UPDATE agent_budget_reservations reservation SET status='released',released_at=now(),updated_at=now()
          FROM agent_run_actions action WHERE action.stage_id=$1 AND reservation.action_id=action.id
            AND reservation.status='reserved' AND action.status IN ('prepared','authorized','reserved')`, [stage.id]);
        await client.query(`UPDATE agent_provider_calls call SET status='failed',error_code=$2,error_message=$3,
          finished_at=now(),updated_at=now() FROM agent_run_actions action
          WHERE action.stage_id=$1 AND call.action_id=action.id AND call.status='reserved'
            AND action.status IN ('prepared','authorized','reserved')`, [stage.id, errorCode, errorMessage]);
        await client.query(`UPDATE agent_run_actions SET status='cancelled',error_code=$2,error_message=$3,
          finished_at=now(),updated_at=now() WHERE stage_id=$1 AND status IN ('prepared','authorized','reserved')`,
        [stage.id, errorCode, errorMessage]);
        const retry = exposed.length === 0 && stage.attempt < stage.max_attempts;
        const nextStatus = exposed.length ? 'uncertain' : retry ? 'queued' : 'failed';
        const backoff = Math.min(300, baseBackoffSeconds * (2 ** Math.max(0, stage.attempt - 1)));
        const updated = (await client.query(`UPDATE agent_run_stages SET status=$2,
          available_at=CASE WHEN $2='queued' THEN now()+($5*interval '1 second') ELSE available_at END,
          lease_token=NULL,leased_by=NULL,lease_until=NULL,attempt_started_at=NULL,error_code=$3,error_message=$4,
          finished_at=CASE WHEN $2='queued' THEN NULL ELSE now() END,updated_at=now() WHERE id=$1 RETURNING *`,
        [stage.id, nextStatus, errorCode, errorMessage, backoff])).rows[0];
        await client.query(`INSERT INTO agent_run_events(run_id,stage_id,event_type,actor_kind,actor_ref,payload_json)
          VALUES($1,$2,$3,'system',$4,$5)`, [stage.run_id, stage.id,
        retry ? 'stage.recovered' : `stage.${nextStatus}`, workerId,
        json({ previousWorker: stage.leased_by, attempt: stage.attempt, errorCode, backoffSeconds: retry ? backoff : 0 })]);
        if (retry) {
          result.requeued += 1;
          await client.query(`INSERT INTO agent_runtime_outbox(id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,available_at)
            VALUES($1,'stage',$2,'stage.available',$3,$4,now()+($5*interval '1 second')) ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), stage.id, `stage-available:${stage.id}:${stage.attempt}`,
            json({ runId: stage.run_id, stageId: stage.id, stageKey: stage.stage_key, recovered: true }), backoff]);
        } else {
          if (nextStatus === 'uncertain') result.uncertain += 1; else result.failed += 1;
          await client.query(`UPDATE agent_run_stages SET status='cancelled',lease_token=NULL,leased_by=NULL,
            lease_until=NULL,attempt_started_at=NULL,finished_at=now(),updated_at=now(),error_code='AGENT_RUN_TERMINATED'
            WHERE run_id=$1 AND id<>$2 AND status IN ('blocked','queued','leased','running','waiting')`, [stage.run_id, stage.id]);
          await client.query(`UPDATE agent_runs SET status=$2,error_code=$3,error_message=$4,finished_at=now(),updated_at=now()
            WHERE id=$1 AND status IN ('queued','running','waiting')`, [stage.run_id, nextStatus, errorCode, errorMessage]);
        }
        void updated;
      }
      return result;
    });
  }

  async registerWorker({ workerId, instanceId, runtimeVersion = '1.0.0', capabilities = [], metadata = {}, staleAfterSeconds = 120 }) {
    workerIdentifier(workerId);
    boundedInteger(staleAfterSeconds, 15, 3600, 'AGENT_RUNTIME_WORKER_STALE_INVALID');
    const row = (await this.pool.query(`INSERT INTO agent_runtime_workers(
        worker_id,instance_id,runtime_version,status,capabilities_json,metadata_json
      ) VALUES($1,$2,$3,'idle',$4,$5)
      ON CONFLICT(worker_id) DO UPDATE SET instance_id=EXCLUDED.instance_id,runtime_version=EXCLUDED.runtime_version,
        status='idle',current_stage_id=NULL,capabilities_json=EXCLUDED.capabilities_json,metadata_json=EXCLUDED.metadata_json,
        started_at=now(),last_seen_at=now(),stopped_at=NULL,updated_at=now()
      WHERE agent_runtime_workers.status='offline'
        OR agent_runtime_workers.last_seen_at<=now()-($6*interval '1 second') RETURNING *`,
    [workerId, instanceId, runtimeVersion, json(capabilities), json(metadata), staleAfterSeconds])).rows[0];
    if (!row) fail('AGENT_RUNTIME_WORKER_ALREADY_ACTIVE');
    return { workerId: row.worker_id, instanceId: row.instance_id, status: row.status };
  }

  async heartbeatWorker({ workerId, instanceId, status = 'idle', currentStageId = null }) {
    workerIdentifier(workerId);
    if (!['idle', 'busy', 'stopping'].includes(status) || (status === 'busy') !== Boolean(currentStageId)) fail('AGENT_RUNTIME_WORKER_HEARTBEAT_INVALID');
    const row = (await this.pool.query(`UPDATE agent_runtime_workers SET status=$3,current_stage_id=$4,
      last_seen_at=now(),updated_at=now() WHERE worker_id=$1 AND instance_id=$2 AND status<>'offline' RETURNING *`,
    [workerId, instanceId, status, currentStageId])).rows[0];
    if (!row) fail('AGENT_RUNTIME_WORKER_INSTANCE_LOST');
    return { workerId: row.worker_id, instanceId: row.instance_id, status: row.status, lastSeenAt: iso(row.last_seen_at) };
  }

  async stopWorker({ workerId, instanceId }) {
    workerIdentifier(workerId);
    const row = (await this.pool.query(`UPDATE agent_runtime_workers SET status='offline',current_stage_id=NULL,
      stopped_at=now(),last_seen_at=now(),updated_at=now() WHERE worker_id=$1 AND instance_id=$2 AND status<>'offline' RETURNING *`,
    [workerId, instanceId])).rows[0];
    if (!row) fail('AGENT_RUNTIME_WORKER_INSTANCE_LOST');
    return { workerId: row.worker_id, instanceId: row.instance_id, status: row.status, stoppedAt: iso(row.stopped_at) };
  }
}
