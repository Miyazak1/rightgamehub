import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const CAPABILITY = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/u;
const WORKFLOW = /^[a-z][a-z0-9.-]{2,119}$/u;
const HOSTS = new Set(['codex', 'mcp-app', 'harness', 'cursor', 'vscode', 'desktop-app']);
const SURFACES = new Set(['mcp-app', 'sidebar', 'desktop-window']);
const CONNECTIONS = new Set(['control-plane', 'local-pipe']);
const TERMINAL = new Set(['succeeded', 'rejected', 'failed', 'cancelled', 'uncertain']);

export class AgentCapabilityHostError extends Error {
  constructor(code) {
    super(code); this.name = 'AgentCapabilityHostError'; this.code = code; this.retryable = false;
    this.statusCode = code.endsWith('_NOT_FOUND') ? 404
      : code.endsWith('_CONFLICT') || code.endsWith('_BUSY') ? 409
        : code.endsWith('_REQUIRED') || code.endsWith('_DENIED') ? 403 : 400;
  }
}

const fail = code => { throw new AgentCapabilityHostError(code); };
const iso = value => value?.toISOString?.() ?? value ?? null;
const json = value => JSON.stringify(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && UUID.test(value) ? value : fail('CAPABILITY_HOST_INPUT_INVALID');

function normalizeProfile(value) {
  if (!object(value) || value.schemaVersion !== 'capability-host-profile-v1'
    || !HOSTS.has(value.host) || typeof value.hostVersion !== 'string' || value.hostVersion.length < 1
    || value.hostVersion.length > 80 || !SURFACES.has(value.surface)
    || !CONNECTIONS.has(value.connection) || !object(value.features)) fail('CAPABILITY_HOST_PROFILE_INVALID');
  const keys = ['submit', 'cancel', 'resume', 'artifacts', 'fileConsent', 'background'];
  if (Object.keys(value.features).length !== keys.length
    || keys.some(key => typeof value.features[key] !== 'boolean')) fail('CAPABILITY_HOST_PROFILE_INVALID');
  if (value.connection === 'local-pipe' && value.host === 'mcp-app') fail('CAPABILITY_HOST_PROFILE_INVALID');
  return structuredClone(value);
}

function normalizeBinding(input) {
  if (!object(input) || !CAPABILITY.test(String(input.capabilityId))
    || !SEMVER.test(String(input.capabilityVersion)) || !WORKFLOW.test(String(input.workflowKey))
    || !Number.isSafeInteger(input.workflowVersion) || input.workflowVersion < 1
    || !object(input.features)
    || typeof input.features.cancel !== 'boolean'
    || typeof input.features.resume !== 'boolean'
    || typeof input.features.artifacts !== 'boolean') fail('CAPABILITY_HOST_BINDING_INVALID');
  const features = { cancel: input.features.cancel === true, resume: input.features.resume === true,
    artifacts: input.features.artifacts === true, openMode: input.features.openMode };
  if (!['host-preview', 'external-app', 'download'].includes(features.openMode)) {
    fail('CAPABILITY_HOST_BINDING_INVALID');
  }
  return { capabilityId: input.capabilityId, capabilityVersion: input.capabilityVersion,
    workflowKey: input.workflowKey, workflowVersion: input.workflowVersion, features };
}

function state(status) {
  if (status === 'queued') return 'queued';
  if (['running', 'waiting'].includes(status)) return 'running';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'cancelled') return 'cancelled';
  return 'failed';
}

function runView(row) {
  if (!row) return null;
  const mapped = state(row.status);
  const total = Number(row.stage_count ?? 0);
  const completed = Number(row.completed_stage_count ?? 0);
  const settings = row.binding_settings ?? {};
  return {
    schemaVersion: 'capability-host-run-v1', runId: row.id,
    capabilityId: row.host_capability_id, capabilityVersion: row.host_capability_version,
    contractKey: row.host_contract_key, state: mapped,
    progress: { phase: row.active_stage_key ?? mapped, completed, total, unit: 'items' },
    artifactCount: mapped === 'succeeded' ? Number(row.artifact_count ?? 0) : 0,
    resumable: ['queued', 'running'].includes(mapped) && settings.features?.resume === true,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    errorCode: mapped === 'failed' ? (row.error_code ?? 'CAPABILITY_HOST_RUN_FAILED') : null,
  };
}

const runProjection = `SELECT run.*,
    run.config_snapshot->'capabilityHost'->>'capabilityId' AS host_capability_id,
    run.config_snapshot->'capabilityHost'->>'capabilityVersion' AS host_capability_version,
    run.config_snapshot->'capabilityHost'->>'contractKey' AS host_contract_key,
    binding.settings_json AS binding_settings,
    (SELECT count(*)::int FROM agent_run_stages stage WHERE stage.run_id=run.id) AS stage_count,
    (SELECT count(*)::int FROM agent_run_stages stage WHERE stage.run_id=run.id
      AND stage.status IN ('succeeded','skipped')) AS completed_stage_count,
    (SELECT stage.stage_key FROM agent_run_stages stage WHERE stage.run_id=run.id
      AND stage.status IN ('leased','running','waiting','queued') ORDER BY stage.ordinal LIMIT 1) AS active_stage_key,
    (SELECT count(*)::int FROM agent_runtime_stage_artifacts artifact WHERE artifact.run_id=run.id) AS artifact_count
  FROM agent_runs run
  JOIN agent_capability_host_bindings binding
    ON binding.capability_id=run.config_snapshot->'capabilityHost'->>'capabilityId'
   AND binding.capability_version=run.config_snapshot->'capabilityHost'->>'capabilityVersion'`;

export function createAgentCapabilityHostService({ pool, runtimeRepository, authorizeOperator } = {}) {
  if (!pool || !runtimeRepository || typeof authorizeOperator !== 'function') {
    fail('CAPABILITY_HOST_DEPENDENCY_REQUIRED');
  }
  const scope = async (actor, agentUserId) => {
    const operatorId = uuid(actor?.userId); agentUserId = uuid(agentUserId);
    if (await authorizeOperator(structuredClone(actor)) !== true) fail('CAPABILITY_HOST_OPERATOR_REQUIRED');
    const account = (await pool.query(`SELECT user_id FROM agent_accounts
      WHERE user_id=$1 AND operator_user_id=$2 AND status='active'`, [agentUserId, operatorId])).rows[0];
    if (!account) fail('CAPABILITY_HOST_AGENT_NOT_FOUND');
    return { operatorId, agentUserId };
  };
  const loadRun = async (scoped, runId) => {
    const row = (await pool.query(`${runProjection} WHERE run.id=$1 AND run.agent_user_id=$2`,
      [uuid(runId), scoped.agentUserId])).rows[0];
    if (!row) fail('CAPABILITY_HOST_RUN_NOT_FOUND');
    return row;
  };
  return Object.freeze({
    async registerBinding(actor, input) {
      const operatorId = uuid(actor?.userId);
      if (await authorizeOperator(structuredClone(actor)) !== true) fail('CAPABILITY_HOST_OPERATOR_REQUIRED');
      const binding = normalizeBinding(input);
      const settings = { schemaVersion: 'capability-host-binding-v1', features: binding.features };
      const row = (await pool.query(`INSERT INTO agent_capability_host_bindings(
          capability_id,capability_version,workflow_key,workflow_version,settings_json,created_by_user_id)
        SELECT manifest.capability_id,manifest.capability_version,workflow.workflow_key,
          workflow.workflow_version,$5,$6
        FROM agent_capability_execution_manifests manifest,agent_workflow_definitions workflow
        WHERE manifest.capability_id=$1 AND manifest.capability_version=$2 AND manifest.status='active'
          AND workflow.workflow_key=$3 AND workflow.workflow_version=$4 AND workflow.status='active'
          AND EXISTS(SELECT 1
            FROM jsonb_array_elements(workflow.manifest_json->'requiredCapabilities') item
            WHERE item->>'key'=manifest.contract_key
              AND (item->>'version')::integer=manifest.contract_version)
        ON CONFLICT(capability_id,capability_version) DO NOTHING RETURNING *`,
      [binding.capabilityId, binding.capabilityVersion, binding.workflowKey, binding.workflowVersion,
        json(settings), operatorId])).rows[0];
      if (!row) {
        const existing = (await pool.query(`SELECT * FROM agent_capability_host_bindings
          WHERE capability_id=$1 AND capability_version=$2`,
        [binding.capabilityId, binding.capabilityVersion])).rows[0];
        const existingFeatures = existing?.settings_json?.features;
        if (!existing || existing.workflow_key !== binding.workflowKey
          || existing.workflow_version !== binding.workflowVersion
          || existing.settings_json?.schemaVersion !== settings.schemaVersion
          || existingFeatures?.cancel !== binding.features.cancel
          || existingFeatures?.resume !== binding.features.resume
          || existingFeatures?.artifacts !== binding.features.artifacts
          || existingFeatures?.openMode !== binding.features.openMode) {
          fail('CAPABILITY_HOST_BINDING_CONFLICT');
        }
        return { ...binding, status: existing.status, existing: true };
      }
      return { ...binding, status: row.status, existing: false };
    },
    async snapshot(actor, agentUserId, profileInput) {
      const scoped = await scope(actor, agentUserId), profile = normalizeProfile(profileInput);
      const rows = (await pool.query(`${runProjection} WHERE run.agent_user_id=$1
        ORDER BY run.created_at DESC,run.id DESC LIMIT 30`, [scoped.agentUserId])).rows;
      return { profile, runs: rows.map(runView) };
    },
    async submit(actor, agentUserId, profileInput, input) {
      const scoped = await scope(actor, agentUserId), profile = normalizeProfile(profileInput);
      if (!profile.features.submit || !object(input) || !CAPABILITY.test(String(input.capabilityId))
        || !SEMVER.test(String(input.capabilityVersion)) || typeof input.contractKey !== 'string'
        || !object(input.input) || typeof input.idempotencyKey !== 'string'
        || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 160) {
        fail('CAPABILITY_HOST_SUBMISSION_INVALID');
      }
      const binding = (await pool.query(`SELECT binding.*,manifest.contract_key,manifest.contract_version
        FROM agent_capability_host_bindings binding
        JOIN agent_capability_execution_manifests manifest
          USING(capability_id,capability_version)
        JOIN agent_workflow_definitions workflow
          USING(workflow_key,workflow_version)
        WHERE binding.capability_id=$1 AND binding.capability_version=$2
          AND binding.status='active' AND manifest.status='active' AND workflow.status='active'`,
      [input.capabilityId, input.capabilityVersion])).rows[0];
      if (!binding) fail('CAPABILITY_HOST_BINDING_NOT_FOUND');
      const contractKey = `${binding.contract_key}@${binding.contract_version}`;
      if (input.contractKey !== contractKey) fail('CAPABILITY_HOST_CONTRACT_CONFLICT');
      const created = await runtimeRepository.createRun({ agentUserId: scoped.agentUserId,
        workflowKey: binding.workflow_key, workflowVersion: binding.workflow_version,
        triggerKind: 'interaction', triggerRef: `host:${profile.host}`,
        idempotencyKey: input.idempotencyKey, input: input.input,
        config: { capabilityHost: { capabilityId: input.capabilityId,
          capabilityVersion: input.capabilityVersion, contractKey, profile } } });
      return runView(await loadRun(scoped, created.id));
    },
    async get(actor, agentUserId, runId, profileInput) {
      const scoped = await scope(actor, agentUserId); normalizeProfile(profileInput);
      return runView(await loadRun(scoped, runId));
    },
    async cancel(actor, agentUserId, runId, profileInput) {
      const scoped = await scope(actor, agentUserId), profile = normalizeProfile(profileInput);
      if (!profile.features.cancel) fail('CAPABILITY_HOST_CANCEL_DENIED');
      await withTransaction(pool, async client => {
        const row = (await client.query(`SELECT run.id,run.status,binding.settings_json
          FROM agent_runs run JOIN agent_capability_host_bindings binding
            ON binding.capability_id=run.config_snapshot->'capabilityHost'->>'capabilityId'
           AND binding.capability_version=run.config_snapshot->'capabilityHost'->>'capabilityVersion'
          WHERE run.id=$1 AND run.agent_user_id=$2 FOR UPDATE OF run`,
        [uuid(runId), scoped.agentUserId])).rows[0];
        if (!row) fail('CAPABILITY_HOST_RUN_NOT_FOUND');
        if (TERMINAL.has(row.status)) return;
        if (row.settings_json?.features?.cancel !== true) fail('CAPABILITY_HOST_CANCEL_DENIED');
        const active = Number((await client.query(`SELECT count(*)::int AS n FROM agent_run_stages
          WHERE run_id=$1 AND status IN ('leased','running')`, [row.id])).rows[0].n);
        if (active > 0) fail('CAPABILITY_HOST_RUN_BUSY');
        await client.query(`UPDATE agent_run_stages SET status='cancelled',finished_at=now(),updated_at=now()
          WHERE run_id=$1 AND status IN ('blocked','queued','waiting')`, [row.id]);
        await client.query(`UPDATE agent_runs SET status='cancelled',error_code='HOST_CANCELLED',
          error_message='Cancelled by the authenticated host.',finished_at=now(),updated_at=now()
          WHERE id=$1 AND status IN ('queued','running','waiting')`, [row.id]);
        await client.query(`INSERT INTO agent_run_events(run_id,event_type,actor_kind,actor_ref,payload_json)
          VALUES($1,'run.host-cancelled','operator',$2,$3)`, [row.id, scoped.operatorId,
          json({ host: profile.host, surface: profile.surface })]);
      });
      return runView(await loadRun(scoped, runId));
    },
    async artifacts(actor, agentUserId, runId, profileInput) {
      const scoped = await scope(actor, agentUserId), profile = normalizeProfile(profileInput);
      if (!profile.features.artifacts) fail('CAPABILITY_HOST_ARTIFACTS_DENIED');
      const run = await loadRun(scoped, runId);
      if (run.status !== 'succeeded') return [];
      const rows = (await pool.query(`SELECT artifact.*,binding.settings_json
        FROM agent_runtime_stage_artifacts artifact
        JOIN agent_runs run ON run.id=artifact.run_id
        JOIN agent_capability_host_bindings binding
          ON binding.capability_id=run.config_snapshot->'capabilityHost'->>'capabilityId'
         AND binding.capability_version=run.config_snapshot->'capabilityHost'->>'capabilityVersion'
        WHERE artifact.run_id=$1 AND run.agent_user_id=$2 ORDER BY artifact.created_at,artifact.id`,
      [run.id, scoped.agentUserId])).rows;
      return rows.map(row => ({ schemaVersion: 'capability-host-artifact-v1', artifactId: row.id,
        runId: row.run_id, name: row.artifact_key, mediaType: row.media_type,
        sizeBytes: Number(row.size_bytes), sha256: row.content_sha256,
        openMode: row.settings_json.features.openMode }));
    },
    async openDirective(actor, agentUserId, artifactId, profileInput) {
      const scoped = await scope(actor, agentUserId), profile = normalizeProfile(profileInput);
      if (!profile.features.artifacts) fail('CAPABILITY_HOST_ARTIFACTS_DENIED');
      const row = (await pool.query(`SELECT artifact.id,artifact.run_id,artifact.artifact_key,
          artifact.media_type,artifact.size_bytes,artifact.content_sha256,binding.settings_json
        FROM agent_runtime_stage_artifacts artifact
        JOIN agent_runs run ON run.id=artifact.run_id
        JOIN agent_capability_host_bindings binding
          ON binding.capability_id=run.config_snapshot->'capabilityHost'->>'capabilityId'
         AND binding.capability_version=run.config_snapshot->'capabilityHost'->>'capabilityVersion'
        WHERE artifact.id=$1 AND run.agent_user_id=$2 AND run.status='succeeded'`,
      [uuid(artifactId), scoped.agentUserId])).rows[0];
      if (!row) fail('CAPABILITY_HOST_ARTIFACT_NOT_FOUND');
      const openMode = row.settings_json.features.openMode;
      return { schemaVersion: 'capability-artifact-open-v1', artifactId: row.id, runId: row.run_id,
        name: row.artifact_key, mediaType: row.media_type, sizeBytes: Number(row.size_bytes),
        sha256: row.content_sha256, openMode, locator: `mooyu-artifact://${openMode}/${row.id}`,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
    },
    async artifactContent(actor, agentUserId, artifactId, profileInput) {
      const scoped = await scope(actor, agentUserId), profile = normalizeProfile(profileInput);
      if (!profile.features.artifacts) fail('CAPABILITY_HOST_ARTIFACTS_DENIED');
      const row = (await pool.query(`SELECT artifact.id,artifact.run_id,artifact.artifact_key,
          artifact.media_type,artifact.size_bytes,artifact.content_sha256,artifact.content_json
        FROM agent_runtime_stage_artifacts artifact
        JOIN agent_runs run ON run.id=artifact.run_id
        JOIN agent_capability_host_bindings binding
          ON binding.capability_id=run.config_snapshot->'capabilityHost'->>'capabilityId'
         AND binding.capability_version=run.config_snapshot->'capabilityHost'->>'capabilityVersion'
        WHERE artifact.id=$1 AND run.agent_user_id=$2 AND run.status='succeeded'
          AND binding.settings_json->'features'->>'artifacts'='true'`,
      [uuid(artifactId), scoped.agentUserId])).rows[0];
      if (!row) fail('CAPABILITY_HOST_ARTIFACT_NOT_FOUND');
      if (row.media_type !== 'application/json' || stableHash(row.content_json) !== row.content_sha256) {
        fail('CAPABILITY_HOST_ARTIFACT_INTEGRITY');
      }
      return { schemaVersion: 'capability-artifact-content-v1', artifactId: row.id,
        runId: row.run_id, name: row.artifact_key, mediaType: row.media_type,
        sizeBytes: Number(row.size_bytes), sha256: row.content_sha256,
        content: structuredClone(row.content_json) };
    },
  });
}
