const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Read immutable receipts before taking a new snapshot or applying admission to
// a replay. An existing committed request does not consume a second daily slot.
export class PostgresAgentBlogPublicRequestRepository {
  constructor(pool) { this.pool = pool; }

  async findCompleted({ agentUserId, requestId }) {
    if (!UUID.test(agentUserId ?? '') || !UUID.test(requestId ?? '')) {
      throw new Error('AGENT_BLOG_PUBLIC_RUNTIME_REQUEST_ID_INVALID');
    }
    const row = (await this.pool.query(`SELECT publication.id,publication.output_type,publication.output_id,
        profile.version AS behavior_profile_version,discovery.id AS discovery_run_id,
        discovery.output_id AS discovery_artifact_id
      FROM agent_runs publication
      JOIN agent_run_handoffs handoff ON handoff.target_run_id=publication.id
        AND handoff.agent_user_id=publication.agent_user_id
        AND handoff.handoff_kind='blog.candidate-set-to-public-article'
      JOIN agent_runs discovery ON discovery.id=handoff.source_run_id
        AND discovery.agent_user_id=publication.agent_user_id
        AND discovery.workflow_key='blog.project.discovery-shadow' AND discovery.status='succeeded'
        AND discovery.output_type='blog.candidate-set' AND discovery.output_id=handoff.source_artifact_id
      JOIN agent_behavior_profiles profile ON profile.id=publication.behavior_profile_id
        AND profile.agent_user_id=publication.agent_user_id
      WHERE publication.agent_user_id=$1 AND publication.workflow_key='blog.project.single'
        AND publication.idempotency_key=$2 AND discovery.idempotency_key=$3
        AND publication.status='succeeded' AND (
          (publication.output_type='blog.article' AND EXISTS (
            SELECT 1 FROM agent_blog_foundation_publications receipt WHERE receipt.run_id=publication.id
              AND receipt.agent_user_id=$1 AND receipt.article_id=publication.output_id))
          OR (publication.output_type='blog.publication-skipped' AND EXISTS (
            SELECT 1 FROM agent_runtime_stage_artifacts artifact
            JOIN agent_run_stages stage ON stage.id=artifact.stage_id AND stage.run_id=publication.id
              AND stage.stage_key='select-subject' AND stage.status='succeeded'
            WHERE artifact.id=publication.output_id AND artifact.run_id=publication.id
              AND artifact.artifact_key='blog.selection-skip'
              AND artifact.content_json->>'schemaVersion'='blog-selection-skip-v1'
              AND artifact.content_json->>'reason' IN ('NO_ELIGIBLE_SUBJECT','EDITORIAL_COOLDOWN_EXHAUSTED')))
        )`, [agentUserId, `public-runtime:${requestId}:article`, `public-runtime:${requestId}:discovery`])).rows[0];
    if (!row) return null;
    const published = row.output_type === 'blog.article';
    return Object.freeze({ schemaVersion:'agent-blog-public-runtime-result-v1', requestId, agentUserId,
      preflight:'passed', behaviorProfileVersion:Number(row.behavior_profile_version),
      discovery:{runId:row.discovery_run_id,artifactId:row.discovery_artifact_id},
      publication:{runId:row.id,articleId:published?row.output_id:null,publicationState:published?'published':'skipped'},
      publicationAttempted:published });
  }
}
