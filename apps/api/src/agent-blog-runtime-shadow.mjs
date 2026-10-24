import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { mapLegacyAgentBlogRun } from './agent-blog-shadow-contract.mjs';
import { BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW, ensureBlogShadowReplayWorkflow } from './agent-blog-foundation-workflows.mjs';

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
  replayRunStatus: row.runtime_run_status ?? null,
  replayArtifact: row.replay_artifact_id ? {
    id: row.replay_artifact_id,
    verdict: row.replay_verdict,
    report: row.replay_report_json,
    createdAt: iso(row.replay_artifact_created_at),
  } : null,
});

export class PostgresAgentBlogRuntimeShadowRepository {
  constructor(pool) { this.pool = pool; }

  async loadSource(runId) {
    return (await this.pool.query(`SELECT r.*,p.version AS behavior_profile_version,a.slug AS article_slug,
        account.operator_user_id,account.status AS agent_status,u.status AS user_status
      FROM agent_blog_runs r
      JOIN agent_behavior_profiles p ON p.id=r.behavior_profile_id AND p.agent_user_id=r.agent_user_id
      JOIN agent_accounts account ON account.user_id=r.agent_user_id
      JOIN users u ON u.id=r.agent_user_id
      LEFT JOIN blog_articles a ON a.id=r.article_id
      WHERE r.id=$1`, [runId])).rows[0] ?? null;
  }

  async listChangedRunIds(limit = 25, includeUnlinkedTerminal = false) {
    return (await this.pool.query(`SELECT r.id
      FROM agent_blog_runs r
      LEFT JOIN agent_blog_runtime_shadow_projections projection ON projection.legacy_run_id=r.id
      WHERE projection.legacy_run_id IS NULL OR projection.source_updated_at<r.updated_at
        OR ($2 AND r.status IN ('published','rejected','failed') AND projection.runtime_run_id IS NULL)
      ORDER BY r.updated_at,r.id LIMIT $1`, [boundedLimit(limit), includeUnlinkedTerminal])).rows.map(row => row.id);
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
    const rows = (await this.pool.query(`SELECT projection.*,run.status AS runtime_run_status,
        artifact.id AS replay_artifact_id,artifact.verdict AS replay_verdict,
        artifact.report_json AS replay_report_json,artifact.created_at AS replay_artifact_created_at
      FROM agent_blog_runtime_shadow_projections projection
      LEFT JOIN agent_runs run ON run.id=projection.runtime_run_id
      LEFT JOIN agent_blog_shadow_replay_artifacts artifact ON artifact.run_id=projection.runtime_run_id
      WHERE projection.agent_user_id=$1 ORDER BY projection.projected_at DESC,projection.legacy_run_id DESC LIMIT $2`,
    [agentUserId, boundedLimit(limit)])).rows;
    return rows.map(projectionView);
  }

  async attachRuntimeRun(legacyRunId, runtimeRunId) {
    const row = (await this.pool.query(`UPDATE agent_blog_runtime_shadow_projections
      SET projection_mode='shadow',runtime_run_id=$2,projected_at=now(),verified_at=now()
      WHERE legacy_run_id=$1 AND (runtime_run_id IS NULL OR runtime_run_id=$2)
      RETURNING *`, [legacyRunId, runtimeRunId])).rows[0];
    if (!row) throw Object.assign(new Error('AGENT_BLOG_SHADOW_RUNTIME_CONFLICT'), { code: 'AGENT_BLOG_SHADOW_RUNTIME_CONFLICT' });
    return projectionView(row);
  }
}
export function createAgentBlogRuntimeShadowProjector({ repository, runtimeRepository = null, mode = 'passive', logger = console } = {}) {
  if (!repository) throw new Error('AGENT_BLOG_SHADOW_REPOSITORY_REQUIRED');
  if (!['passive', 'shadow'].includes(mode)) throw new Error('AGENT_BLOG_FOUNDATION_MODE_INVALID');
  if (mode === 'shadow' && !runtimeRepository) throw new Error('AGENT_BLOG_SHADOW_RUNTIME_REPOSITORY_REQUIRED');
  let workflowReady = null;
  const ensureWorkflow = actorUserId => {
    if (!workflowReady) workflowReady = ensureBlogShadowReplayWorkflow(runtimeRepository, actorUserId).catch(error => {
      workflowReady = null;
      throw error;
    });
    return workflowReady;
  };
  const projectRun = async runId => {
    const source = await repository.loadSource(runId);
    if (!source) return null;
    const snapshot = sourceSnapshot(source);
    const mapping = mapLegacyAgentBlogRun(snapshot);
    const digest = stableHash(snapshot);
    const passive = await repository.saveProjection({ source, snapshot, digest, mapping });
    const selectionMode = snapshot.providerUsage?.selectionDecision?.mode;
    if (mode !== 'shadow' || !['published', 'rejected', 'failed'].includes(snapshot.status)
      || selectionMode !== 'single' || source.agent_status !== 'active' || source.user_status !== 'active') return passive;
    await ensureWorkflow(source.operator_user_id);
    const replay = await runtimeRepository.createRun({
      agentUserId: source.agent_user_id,
      workflowKey: BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.workflowKey,
      workflowVersion: BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.workflowVersion,
      triggerKind: source.trigger_kind,
      triggerRef: `legacy-blog:${source.id}`,
      idempotencyKey: `legacy-shadow:${source.id}`,
      input: { schemaVersion: 'blog-shadow-replay-input-v1', projectionMode: 'shadow', sourceSha256: digest, legacySnapshot: snapshot },
      config: { providerOwner: 'legacy', publishOwner: 'legacy', providerInvocation: false, publicationAttempt: false },
      budget: BLOG_SINGLE_SHADOW_REPLAY_WORKFLOW.defaultBudget,
    });
    const projection = await repository.attachRuntimeRun(source.id, replay.id);
    return { projection, changed: passive.changed || !replay.existing, replayRun: replay };
  };
  return {
    projectRun,
    async reconcileBatch(limit = 25) {
      const ids = await repository.listChangedRunIds(limit, mode === 'shadow');
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
