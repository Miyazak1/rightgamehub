import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const TERMINAL = new Set(['published', 'rejected', 'failed']);
const STATUS_MAP = Object.freeze({
  queued: { run: 'queued', stage: 'queued' },
  generating: { run: 'running', stage: 'running' },
  checking: { run: 'running', stage: 'running' },
  published: { run: 'succeeded', stage: 'succeeded' },
  rejected: { run: 'rejected', stage: 'failed' },
  failed: { run: 'failed', stage: 'failed' },
});

const iso = value => value?.toISOString?.() ?? value ?? null;
const boundedLimit = value => Math.min(100, Math.max(1, Number(value) || 25));

function sourceSnapshot(row) {
  return {
    schemaVersion: 'agent-blog-legacy-run-v1',
    legacyRunId: row.id,
    agentUserId: row.agent_user_id,
    requestedByUserId: row.requested_by_user_id ?? null,
    triggerKind: row.trigger_kind,
    status: row.status,
    model: row.model,
    topicScope: row.topic_scope,
    behaviorProfileId: row.behavior_profile_id,
    behaviorProfileVersion: Number(row.behavior_profile_version),
    article: row.article_id ? {
      id: row.article_id,
      slug: row.article_slug ?? null,
      title: row.article_title,
      withdrawnAt: iso(row.withdrawn_at),
      withdrawnByUserId: row.withdrawn_by_user_id ?? null,
    } : null,
    reasonCodes: row.reason_codes ?? [],
    providerUsage: row.provider_usage ?? {},
    error: row.error_code ? { code: row.error_code, message: row.error_message ?? null } : null,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSnapshot(snapshot) {
  const mapped = STATUS_MAP[snapshot.status];
  const mismatchCodes = [];
  if (!mapped) mismatchCodes.push('SOURCE_STATUS_UNSUPPORTED');
  if (TERMINAL.has(snapshot.status) !== Boolean(snapshot.finishedAt)) mismatchCodes.push('FINISHED_AT_MISMATCH');
  if (['generating', 'checking'].includes(snapshot.status) && !snapshot.startedAt) mismatchCodes.push('STARTED_AT_MISSING');
  if (snapshot.status === 'published' && (!snapshot.article?.id || !snapshot.article?.title)) mismatchCodes.push('PUBLISHED_OUTPUT_MISSING');
  if (snapshot.article?.withdrawnAt && !snapshot.article?.withdrawnByUserId) mismatchCodes.push('WITHDRAW_ACTOR_MISSING');
  if (!Number.isInteger(snapshot.behaviorProfileVersion) || snapshot.behaviorProfileVersion < 1) mismatchCodes.push('BEHAVIOR_PROFILE_VERSION_MISSING');
  return {
    mappedRunStatus: mapped?.run ?? 'failed',
    mappedStageStatus: mapped?.stage ?? 'failed',
    parityStatus: mismatchCodes.length ? 'invalid' : 'exact',
    mismatchCodes,
  };
}

const projectionView = row => ({
  legacyRunId: row.legacy_run_id,
  agentUserId: row.agent_user_id,
  projectionMode: row.projection_mode,
  runtimeRunId: row.runtime_run_id ?? null,
  sourceStatus: row.source_status,
  mappedRunStatus: row.mapped_run_status,
  mappedStageStatus: row.mapped_stage_status,
  providerOwner: row.provider_owner,
  publishOwner: row.publish_owner,
  parityStatus: row.parity_status,
  mismatchCodes: row.mismatch_codes ?? [],
  sourceSha256: row.source_sha256,
  sourceUpdatedAt: iso(row.source_updated_at),
  projectedAt: iso(row.projected_at),
  verifiedAt: iso(row.verified_at),
});

export class PostgresAgentBlogRuntimeShadowRepository {
  constructor(pool) { this.pool = pool; }

  async loadSource(runId) {
    return (await this.pool.query(`SELECT r.*,p.version AS behavior_profile_version,a.slug AS article_slug
      FROM agent_blog_runs r
      JOIN agent_behavior_profiles p ON p.id=r.behavior_profile_id AND p.agent_user_id=r.agent_user_id
      LEFT JOIN blog_articles a ON a.id=r.article_id
      WHERE r.id=$1`, [runId])).rows[0] ?? null;
  }

  async listChangedRunIds(limit = 25) {
    return (await this.pool.query(`SELECT r.id
      FROM agent_blog_runs r
      LEFT JOIN agent_blog_runtime_shadow_projections projection ON projection.legacy_run_id=r.id
      WHERE projection.legacy_run_id IS NULL OR projection.source_updated_at<r.updated_at
      ORDER BY r.updated_at,r.id LIMIT $1`, [boundedLimit(limit)])).rows.map(row => row.id);
  }

  async saveProjection({ source, snapshot, digest, mapping }) {
    return withTransaction(this.pool, async client => {
      const existing = (await client.query(`SELECT * FROM agent_blog_runtime_shadow_projections
        WHERE legacy_run_id=$1 FOR UPDATE`, [source.id])).rows[0];
      if (existing?.source_sha256 === digest) {
        const verified = (await client.query(`UPDATE agent_blog_runtime_shadow_projections SET verified_at=now()
          WHERE legacy_run_id=$1 RETURNING *`, [source.id])).rows[0];
        return { projection: projectionView(verified), changed: false };
      }
      const row = (await client.query(`INSERT INTO agent_blog_runtime_shadow_projections(
          legacy_run_id,agent_user_id,source_status,mapped_run_status,mapped_stage_status,parity_status,mismatch_codes,
          source_sha256,source_snapshot,source_updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(legacy_run_id) DO UPDATE SET
          source_status=EXCLUDED.source_status,mapped_run_status=EXCLUDED.mapped_run_status,
          mapped_stage_status=EXCLUDED.mapped_stage_status,parity_status=EXCLUDED.parity_status,
          mismatch_codes=EXCLUDED.mismatch_codes,source_sha256=EXCLUDED.source_sha256,
          source_snapshot=EXCLUDED.source_snapshot,source_updated_at=EXCLUDED.source_updated_at,
          projected_at=now(),verified_at=now()
        RETURNING *`, [source.id, source.agent_user_id, source.status, mapping.mappedRunStatus,
        mapping.mappedStageStatus, mapping.parityStatus, mapping.mismatchCodes, digest,
        JSON.stringify(snapshot), source.updated_at])).rows[0];
      await client.query(`INSERT INTO agent_blog_runtime_shadow_events(
          legacy_run_id,source_sha256,source_status,mapped_run_status,parity_status,payload_json
        ) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [source.id, digest, source.status,
        mapping.mappedRunStatus, mapping.parityStatus, JSON.stringify({
          schemaVersion: 'agent-blog-shadow-observation-v1',
          mappedStageStatus: mapping.mappedStageStatus,
          mismatchCodes: mapping.mismatchCodes,
          providerOwner: 'legacy',
          publishOwner: 'legacy',
          providerInvocation: false,
          publicationAttempt: false,
        })]);
      return { projection: projectionView(row), changed: true };
    });
  }

  async listForAgent(agentUserId, limit = 30) {
    const rows = (await this.pool.query(`SELECT * FROM agent_blog_runtime_shadow_projections
      WHERE agent_user_id=$1 ORDER BY projected_at DESC,legacy_run_id DESC LIMIT $2`,
    [agentUserId, boundedLimit(limit)])).rows;
    return rows.map(projectionView);
  }
}

export function createAgentBlogRuntimeShadowProjector({ repository, logger = console } = {}) {
  if (!repository) throw new Error('AGENT_BLOG_SHADOW_REPOSITORY_REQUIRED');
  const projectRun = async runId => {
    const source = await repository.loadSource(runId);
    if (!source) return null;
    const snapshot = sourceSnapshot(source);
    const mapping = mapSnapshot(snapshot);
    return repository.saveProjection({ source, snapshot, digest: stableHash(snapshot), mapping });
  };
  return {
    projectRun,
    async reconcileBatch(limit = 25) {
      const ids = await repository.listChangedRunIds(limit);
      const result = { examined: ids.length, projected: 0, unchanged: 0, failed: 0 };
      for (const id of ids) {
        try {
          const projected = await projectRun(id);
          if (projected?.changed) result.projected += 1;
          else result.unchanged += 1;
        } catch (error) {
          result.failed += 1;
          logger.warn?.({ service: 'agent-blog-runtime-shadow', legacyRunId: id,
            code: error?.code ?? 'AGENT_BLOG_SHADOW_FAILED', message: String(error?.message ?? error).slice(0, 300) },
          'Agent blog passive shadow projection failed');
        }
      }
      return result;
    },
    listForAgent(agentUserId, limit) { return repository.listForAgent(agentUserId, limit); },
  };
}

export const mapLegacyAgentBlogRun = snapshot => mapSnapshot(structuredClone(snapshot));
