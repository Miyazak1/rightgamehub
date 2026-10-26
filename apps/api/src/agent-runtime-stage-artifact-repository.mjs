import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentRuntimeStageArtifactError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentRuntimeStageArtifactError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentRuntimeStageArtifactError(code); };
const KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KINDS = new Set(['model-output', 'validated-output', 'verification']);
const json = value => JSON.stringify(value);

function key(value, code = 'AGENT_STAGE_ARTIFACT_INVALID') {
  if (typeof value !== 'string' || !KEY.test(value)) fail(code);
  return value;
}

function ids(value) {
  if (!Array.isArray(value) || value.length > 32 || value.some(item => typeof item !== 'string' || !UUID.test(item))
    || new Set(value).size !== value.length) fail('AGENT_STAGE_ARTIFACT_SOURCE_INVALID');
  return [...value];
}

function view(row, { includeContent = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    stageId: row.stage_id,
    actionId: row.action_id,
    artifactKey: row.artifact_key,
    artifactKind: row.artifact_kind,
    schema: { key: row.schema_key, version: row.schema_version },
    mediaType: row.media_type,
    contentSha256: row.content_sha256,
    sizeBytes: row.size_bytes,
    sourceToolArtifactIds: row.source_tool_artifact_ids,
    sourceStageArtifactIds: row.source_stage_artifact_ids,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    ...(includeContent ? { content: row.content_json } : {}),
  };
}

export class PostgresAgentRuntimeStageArtifactRepository {
  constructor(pool, { maxBytes = 1048576 } = {}) {
    if (!pool || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) {
      fail('AGENT_STAGE_ARTIFACT_CONFIG_INVALID');
    }
    this.pool = pool;
    this.maxBytes = maxBytes;
  }

  async save({ runId, stageId, workerId, leaseToken, actionId = null, artifactKey, artifactKind,
    schema, content, sourceToolArtifactIds = [], sourceStageArtifactIds = [] }) {
    key(artifactKey);
    if (!KINDS.has(artifactKind) || !schema || !Number.isSafeInteger(schema.version)
      || schema.version < 1 || schema.version > 2147483647) fail('AGENT_STAGE_ARTIFACT_INVALID');
    key(schema.key);
    if (!content || typeof content !== 'object' || Array.isArray(content)) fail('AGENT_STAGE_ARTIFACT_CONTENT_INVALID');
    const toolIds = ids(sourceToolArtifactIds);
    const stageIds = ids(sourceStageArtifactIds);
    if ((toolIds.length + stageIds.length < 1 && !actionId) || toolIds.length + stageIds.length > 32) {
      fail('AGENT_STAGE_ARTIFACT_SOURCE_INVALID');
    }
    const serialized = json(content);
    const sizeBytes = Buffer.byteLength(serialized);
    if (sizeBytes < 1 || sizeBytes > this.maxBytes) fail('AGENT_STAGE_ARTIFACT_SIZE_INVALID');
    const digest = stableHash(content);
    return withTransaction(this.pool, async client => {
      const stage = (await client.query(`SELECT stage.*,run.agent_user_id FROM agent_run_stages stage
        JOIN agent_runs run ON run.id=stage.run_id
        WHERE stage.id=$1 AND stage.run_id=$2 AND stage.status='running' AND stage.leased_by=$3
          AND stage.lease_token=$4 AND stage.lease_until>now() FOR UPDATE OF stage`,
      [stageId, runId, workerId, leaseToken])).rows[0];
      if (!stage) fail('AGENT_RUNTIME_LEASE_LOST');
      const existing = (await client.query(`SELECT * FROM agent_runtime_stage_artifacts
        WHERE stage_id=$1 AND artifact_key=$2`, [stageId, artifactKey])).rows[0];
      if (existing) {
        const same = existing.run_id === runId && existing.action_id === actionId
          && existing.artifact_kind === artifactKind && existing.schema_key === schema.key
          && existing.schema_version === schema.version && existing.content_sha256 === digest
          && stableHash(existing.source_tool_artifact_ids) === stableHash(toolIds)
          && stableHash(existing.source_stage_artifact_ids) === stableHash(stageIds);
        if (!same) fail('AGENT_STAGE_ARTIFACT_IDEMPOTENCY_CONFLICT');
        return { ...view(existing), existing: true };
      }
      if (actionId) {
        const action = (await client.query(`SELECT id FROM agent_run_actions
          WHERE id=$1 AND run_id=$2 AND stage_id=$3 AND status='succeeded'`, [actionId, runId, stageId])).rows[0];
        if (!action) fail('AGENT_STAGE_ARTIFACT_ACTION_INVALID');
      }
      if (toolIds.length) {
        const count = Number((await client.query(`SELECT count(*)::int AS n FROM agent_tool_artifacts artifact
          JOIN agent_run_actions action ON action.id=artifact.action_id
          JOIN agent_tool_calls call ON call.id=artifact.tool_call_id
          WHERE action.run_id=$1 AND action.status='succeeded' AND call.status='succeeded'
            AND artifact.id=ANY($2::uuid[])`, [runId, toolIds])).rows[0].n);
        if (count !== toolIds.length) fail('AGENT_STAGE_ARTIFACT_SOURCE_UNVERIFIED');
      }
      if (stageIds.length) {
        const count = Number((await client.query(`SELECT count(*)::int AS n FROM agent_runtime_stage_artifacts artifact
          JOIN agent_run_stages source_stage ON source_stage.id=artifact.stage_id
          WHERE artifact.run_id=$1 AND source_stage.status='succeeded' AND artifact.id=ANY($2::uuid[])`,
        [runId, stageIds])).rows[0].n);
        if (count !== stageIds.length) fail('AGENT_STAGE_ARTIFACT_SOURCE_UNVERIFIED');
      }
      const id = crypto.randomUUID();
      const row = (await client.query(`INSERT INTO agent_runtime_stage_artifacts(
          id,run_id,stage_id,action_id,artifact_key,artifact_kind,schema_key,schema_version,media_type,
          content_json,content_sha256,size_bytes,source_tool_artifact_ids,source_stage_artifact_ids
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'application/json',$9,$10,$11,$12,$13) RETURNING *`,
      [id, runId, stageId, actionId, artifactKey, artifactKind, schema.key, schema.version,
        serialized, digest, sizeBytes, toolIds, stageIds])).rows[0];
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,actor_ref,payload_json)
        VALUES($1,$2,$3,'stage.artifact-created','worker',$4,$5)`, [runId, stageId, actionId, workerId,
        json({ artifactId: id, artifactKey, artifactKind, schema, contentSha256: digest, sizeBytes })]);
      return { ...view(row), existing: false };
    });
  }

  async read({ runId, artifactId, expectedArtifactKey = null }) {
    const row = (await this.pool.query(`SELECT * FROM agent_runtime_stage_artifacts
      WHERE id=$1 AND run_id=$2 AND ($3::text IS NULL OR artifact_key=$3)`,
    [artifactId, runId, expectedArtifactKey])).rows[0];
    if (!row) fail('AGENT_STAGE_ARTIFACT_NOT_FOUND');
    return view(row, { includeContent: true });
  }

  async readToolArtifact({ runId, artifactId }) {
    const row = (await this.pool.query(`SELECT artifact.* FROM agent_tool_artifacts artifact
      JOIN agent_run_actions action ON action.id=artifact.action_id
      JOIN agent_tool_calls call ON call.id=artifact.tool_call_id
      WHERE artifact.id=$1 AND action.run_id=$2 AND action.status='succeeded' AND call.status='succeeded'`,
    [artifactId, runId])).rows[0];
    if (!row) fail('AGENT_STAGE_ARTIFACT_SOURCE_UNVERIFIED');
    return {
      id: row.id, actionId: row.action_id, mediaType: row.media_type,
      contentSha256: row.content_sha256, sizeBytes: row.size_bytes,
      content: row.content_json, createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    };
  }
}
