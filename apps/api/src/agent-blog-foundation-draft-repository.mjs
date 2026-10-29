import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { blogRequestHash } from './blog-contract.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentBlogFoundationDraftRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogFoundationDraftRepositoryError';
    this.code = code;
  }
}

const fail = code => { throw new AgentBlogFoundationDraftRepositoryError(code); };
const json = value => JSON.stringify(value);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ids = value => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32
    || value.some(item => typeof item !== 'string' || !uuidPattern.test(item))
    || new Set(value).size !== value.length) fail('AGENT_BLOG_DRAFT_SOURCE_ARTIFACTS_INVALID');
  return [...value];
};

const view = row => row ? ({
  runId: row.run_id,
  actionId: row.action_id,
  agentUserId: row.agent_user_id,
  articleId: row.article_id,
  revisionId: row.revision_id,
  verificationArtifactId: row.verification_artifact_id,
  compositionArtifactId: row.composition_artifact_id,
  sourceArtifactIds: row.source_artifact_ids,
  contentSha256: row.content_sha256,
  publicationState: row.publication_state ?? 'draft',
  createdAt: row.created_at?.toISOString?.() ?? row.created_at,
}) : null;

async function appendActionEvent(client, action, eventType, payload) {
  await client.query(`INSERT INTO agent_run_events(
      run_id,stage_id,action_id,event_type,actor_kind,payload_json
    ) VALUES($1,$2,$3,$4,'system',$5)`,
  [action.run_id, action.stage_id, action.id, eventType, json(payload)]);
}

export class PostgresAgentBlogFoundationDraftRepository {
  constructor(pool, { requireResearchEvidence = false } = {}) {
    this.pool = pool;
    this.requireResearchEvidence = requireResearchEvidence === true;
  }

  async getByAction(actionId) {
    const row = (await this.pool.query(`SELECT draft.*,article.publication_state
      FROM agent_blog_foundation_drafts draft
      JOIN blog_articles article ON article.id=draft.article_id
      WHERE draft.action_id=$1`, [actionId])).rows[0];
    return view(row);
  }

  async persist({ actionId, content, contentSha256, sourceArtifactIds, verificationArtifactId }) {
    const artifacts = ids(sourceArtifactIds);
    if (typeof verificationArtifactId !== 'string' || !uuidPattern.test(verificationArtifactId)) {
      fail('AGENT_BLOG_DRAFT_VERIFICATION_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const action = (await client.query(`SELECT action.*,run.agent_user_id,run.status AS run_status,
          stage.status AS stage_status,account.status AS agent_status,author.status AS user_status
        FROM agent_run_actions action
        JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_run_stages stage ON stage.id=action.stage_id AND stage.run_id=action.run_id
        JOIN agent_accounts account ON account.user_id=run.agent_user_id
        JOIN users author ON author.id=run.agent_user_id
        WHERE action.id=$1 FOR UPDATE OF action,run,stage`, [actionId])).rows[0];
      if (!action || action.action_kind !== 'domain-write' || action.capability_key !== 'blog.article.draft'
        || action.contract_version !== 1 || action.risk_level !== 'L2') fail('AGENT_BLOG_DRAFT_ACTION_INVALID');
      const existing = (await client.query(`SELECT draft.*,article.publication_state
        FROM agent_blog_foundation_drafts draft JOIN blog_articles article ON article.id=draft.article_id
        WHERE draft.action_id=$1`, [actionId])).rows[0];
      if (existing) {
        if (existing.content_sha256 !== contentSha256
          || existing.verification_artifact_id !== verificationArtifactId
          || existing.source_artifact_ids.length !== artifacts.length
          || existing.source_artifact_ids.some((id, index) => id !== artifacts[index])) {
          fail('AGENT_BLOG_DRAFT_IDEMPOTENCY_CONFLICT');
        }
        return { ...view(existing), existing: true };
      }
      if (action.status !== 'authorized' || action.run_status !== 'running' || action.stage_status !== 'running'
        || action.agent_status !== 'active' || action.user_status !== 'active') fail('AGENT_BLOG_DRAFT_ACTION_NOT_AUTHORIZED');
      const verified = Number((await client.query(`SELECT count(*)::int AS n
        FROM agent_tool_artifacts artifact
        JOIN agent_run_actions source_action ON source_action.id=artifact.action_id
        JOIN agent_tool_calls source_call ON source_call.id=artifact.tool_call_id
        WHERE source_action.run_id=$1 AND source_action.status='succeeded'
          AND source_action.capability_key LIKE 'research.%' AND source_call.status='succeeded'
          AND artifact.id=ANY($2::uuid[])`,
      [action.run_id, artifacts])).rows[0].n);
      if (verified !== artifacts.length) fail('AGENT_BLOG_DRAFT_SOURCE_ARTIFACTS_UNVERIFIED');
      const lineage = (await client.query(`SELECT verification.*,composition.id AS composition_id,
          composition.run_id AS composition_run_id,composition.stage_id AS composition_stage_id,
          composition.artifact_key AS composition_artifact_key,
          composition.artifact_kind AS composition_artifact_kind,
          composition.schema_key AS composition_schema_key,
          composition.schema_version AS composition_schema_version,
          composition.content_json AS composition_content_json,
          composition.content_sha256 AS composition_content_sha256,
          composition.source_tool_artifact_ids AS composition_source_tool_artifact_ids
        FROM agent_runtime_stage_artifacts verification
        JOIN agent_runtime_stage_artifacts composition
          ON composition.id::text=verification.content_json->>'compositionArtifactId'
        WHERE verification.id=$1 AND verification.run_id=$2`, [verificationArtifactId, action.run_id])).rows[0];
      const proof = lineage?.content_json;
      const compositionPackage = lineage?.composition_content_json;
      if (!lineage || lineage.artifact_key !== 'blog.verification' || lineage.artifact_kind !== 'verification'
        || lineage.schema_key !== 'blog.article.verification' || lineage.schema_version !== 1
        || proof?.schemaVersion !== 'blog-article-verification-v1' || proof.approved !== true
        || proof.compositionArtifactId !== lineage.composition_id
        || proof.contentSha256 !== lineage.composition_content_sha256
        || !lineage.source_stage_artifact_ids.includes(lineage.composition_id)
        || lineage.composition_run_id !== action.run_id
        || lineage.composition_artifact_key !== 'blog.composition'
        || lineage.composition_artifact_kind !== 'validated-output'
        || lineage.composition_schema_key !== 'blog.article.normalized'
        || lineage.composition_schema_version !== 1
        || compositionPackage?.schemaVersion !== 'blog-article-composition-v1'
        || blogRequestHash(compositionPackage.content) !== contentSha256
        || stableHash(compositionPackage.content) !== stableHash(content)
        || stableHash(compositionPackage.sourceToolArtifactIds) !== stableHash(artifacts)
        || stableHash(lineage.composition_source_tool_artifact_ids) !== stableHash(artifacts)
        || stableHash(proof.sourceToolArtifactIds) !== stableHash(artifacts)) {
        fail('AGENT_BLOG_DRAFT_VERIFICATION_INVALID');
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-blog-draft:${action.agent_user_id}`]);
      const draftCount = Number((await client.query(`SELECT count(*)::int AS n FROM blog_articles
        WHERE author_user_id=$1 AND publication_state='draft'`, [action.agent_user_id])).rows[0].n);
      if (draftCount >= 100) fail('AGENT_BLOG_DRAFT_LIMIT_EXCEEDED');
      const articleId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const responseRef = {
        type: 'blog.private-draft', articleId, revisionId, publicationState: 'draft',
        sourceArtifactIds: artifacts, contentSha256,
      };
      await client.query(`UPDATE agent_run_actions SET status='reserved',reservation_ref=$2,updated_at=now()
        WHERE id=$1 AND status='authorized'`, [action.id, `database:blog-draft:${articleId}`]);
      await appendActionEvent(client, action, 'action.reserved', { boundary: 'database-transaction', articleId });
      await client.query("UPDATE agent_run_actions SET status='sending',updated_at=now() WHERE id=$1 AND status='reserved'", [action.id]);
      await appendActionEvent(client, action, 'action.sending', { boundary: 'database-transaction', articleId });
      try {
        await client.query(`INSERT INTO blog_articles(
            id,author_user_id,slug,locale,publication_state,working_revision_id
          ) VALUES($1,$2,$3,$4,'draft',$5)`,
        [articleId, action.agent_user_id, content.slug, content.locale, revisionId]);
      } catch (error) {
        if (error.code === '23505') fail('AGENT_BLOG_DRAFT_SLUG_TAKEN');
        throw error;
      }
      await client.query(`INSERT INTO blog_article_revisions(
          id,article_id,author_user_id,title,summary,blocks,citations,content_hash,revision_state
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'working')`,
      [revisionId, articleId, action.agent_user_id, content.title, content.summary,
        json(content.blocks), json(content.citations), contentSha256]);
      if (this.requireResearchEvidence) {
        if (content.citations.length !== artifacts.length
          || content.citations.some(citation => !uuidPattern.test(citation.id))) {
          fail('AGENT_BLOG_DRAFT_EVIDENCE_COVERAGE_INVALID');
        }
        const evidenceRows = (await client.query(`SELECT binding.tool_artifact_id,
            binding.id AS artifact_binding_id,link.evidence_id
          FROM agent_research_artifact_bindings binding
          JOIN agent_research_evidence_bindings link ON link.artifact_binding_id=binding.id
          WHERE binding.tool_artifact_id=ANY($1::uuid[])
          ORDER BY binding.tool_artifact_id,link.created_at,link.evidence_id`, [artifacts])).rows;
        const byArtifact = new Map();
        for (const row of evidenceRows) {
          const values = byArtifact.get(row.tool_artifact_id) ?? [];
          values.push(row);
          byArtifact.set(row.tool_artifact_id, values);
        }
        if (artifacts.some(artifactId => !(byArtifact.get(artifactId)?.length > 0))) {
          fail('AGENT_BLOG_DRAFT_EVIDENCE_COVERAGE_INVALID');
        }
        for (const [index, artifactId] of artifacts.entries()) {
          for (const row of byArtifact.get(artifactId)) {
            await client.query(`INSERT INTO blog_revision_citation_evidence(
                revision_id,citation_id,tool_artifact_id,artifact_binding_id,evidence_id
              ) VALUES($1,$2,$3,$4,$5)`, [revisionId, content.citations[index].id,
              artifactId, row.artifact_binding_id, row.evidence_id]);
          }
        }
      }
      await client.query(`INSERT INTO blog_article_events(
          id,article_id,actor_user_id,action,revision_id,details
        ) VALUES($1,$2,$3,'draft_created',$4,$5)`,
      [crypto.randomUUID(), articleId, action.agent_user_id, revisionId,
        json({ source: 'agent_foundation_shadow', runId: action.run_id, actionId: action.id, sourceArtifactIds: artifacts })]);
      await client.query(`INSERT INTO agent_blog_foundation_drafts(
          run_id,agent_user_id,action_id,article_id,revision_id,source_artifact_ids,content_sha256,
          verification_artifact_id,composition_artifact_id
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [action.run_id, action.agent_user_id, action.id, articleId, revisionId, artifacts, contentSha256,
        verificationArtifactId, lineage.composition_id]);
      await client.query(`UPDATE agent_run_actions SET status='sent',provider_request_id=$2,sent_at=now(),updated_at=now()
        WHERE id=$1 AND status='sending'`, [action.id, `database:blog-draft:${articleId}`]);
      const acknowledged = (await client.query(`UPDATE agent_run_actions SET status='acknowledged',response_ref_json=$2,
        acknowledged_at=now(),updated_at=now() WHERE id=$1 AND status='sent' RETURNING *`,
      [action.id, json(responseRef)])).rows[0];
      if (!acknowledged) fail('AGENT_BLOG_DRAFT_ACTION_STATE');
      await appendActionEvent(client, action, 'action.acknowledged', { boundary: 'database-commit', articleId });
      const succeeded = (await client.query(`UPDATE agent_run_actions SET status='succeeded',response_ref_json=$2,
        response_sha256=$3,usage_json='{}'::jsonb,finished_at=now(),updated_at=now()
        WHERE id=$1 AND status='acknowledged' RETURNING *`, [action.id, json(responseRef), contentSha256])).rows[0];
      if (!succeeded) fail('AGENT_BLOG_DRAFT_ACTION_STATE');
      await appendActionEvent(client, action, 'action.succeeded', { articleId, revisionId, publicationState: 'draft' });
      return { runId: action.run_id, actionId: action.id, agentUserId: action.agent_user_id,
        articleId, revisionId, sourceArtifactIds: artifacts, contentSha256,
        verificationArtifactId, compositionArtifactId: lineage.composition_id,
        publicationState: 'draft', createdAt: new Date().toISOString(), existing: false };
    });
  }
}
