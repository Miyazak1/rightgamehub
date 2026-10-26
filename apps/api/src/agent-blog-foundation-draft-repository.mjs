import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

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
  constructor(pool) { this.pool = pool; }

  async getByAction(actionId) {
    const row = (await this.pool.query(`SELECT draft.*,article.publication_state
      FROM agent_blog_foundation_drafts draft
      JOIN blog_articles article ON article.id=draft.article_id
      WHERE draft.action_id=$1`, [actionId])).rows[0];
    return view(row);
  }

  async persist({ actionId, content, contentSha256, sourceArtifactIds }) {
    const artifacts = ids(sourceArtifactIds);
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
      await client.query(`INSERT INTO blog_article_events(
          id,article_id,actor_user_id,action,revision_id,details
        ) VALUES($1,$2,$3,'draft_created',$4,$5)`,
      [crypto.randomUUID(), articleId, action.agent_user_id, revisionId,
        json({ source: 'agent_foundation_shadow', runId: action.run_id, actionId: action.id, sourceArtifactIds: artifacts })]);
      await client.query(`INSERT INTO agent_blog_foundation_drafts(
          run_id,agent_user_id,action_id,article_id,revision_id,source_artifact_ids,content_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [action.run_id, action.agent_user_id, action.id, articleId, revisionId, artifacts, contentSha256]);
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
        publicationState: 'draft', createdAt: new Date().toISOString(), existing: false };
    });
  }
}
