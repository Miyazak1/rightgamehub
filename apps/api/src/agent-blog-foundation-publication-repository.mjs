import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { PostgresAgentBlogPublicationOwnershipRepository } from './agent-blog-publication-ownership.mjs';
import { recordAgentEditorialMemory } from './agent-editorial-memory-repository.mjs';

export class AgentBlogFoundationPublicationRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentBlogFoundationPublicationRepositoryError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentBlogFoundationPublicationRepositoryError(code); };
const json = value => JSON.stringify(value);

const view = row => row ? ({
  runId: row.run_id,
  actionId: row.action_id,
  agentUserId: row.agent_user_id,
  articleId: row.article_id,
  revisionId: row.revision_id,
  ownershipGeneration: Number(row.ownership_generation),
  contentSha256: row.content_sha256,
  publicationState: row.publication_state ?? 'published',
  publishedAt: row.published_at?.toISOString?.() ?? row.published_at,
}) : null;

async function appendActionEvent(client, action, eventType, payload) {
  await client.query(`INSERT INTO agent_run_events(
      run_id,stage_id,action_id,event_type,actor_kind,payload_json
    ) VALUES($1,$2,$3,$4,'system',$5)`,
  [action.run_id, action.stage_id, action.id, eventType, json(payload)]);
}

export class PostgresAgentBlogFoundationPublicationRepository {
  constructor(pool, { publicationOwnership, boundaryProbe, editorialMemoryRecorder } = {}) {
    this.pool = pool;
    this.publicationOwnership = publicationOwnership
      ?? new PostgresAgentBlogPublicationOwnershipRepository(pool);
    if (boundaryProbe != null && typeof boundaryProbe !== 'function') {
      fail('AGENT_BLOG_PUBLICATION_BOUNDARY_PROBE_INVALID');
    }
    this.boundaryProbe = boundaryProbe ?? (async () => {});
    this.editorialMemoryRecorder = editorialMemoryRecorder ?? recordAgentEditorialMemory;
  }

  async getByAction(actionId) {
    const row = (await this.pool.query(`SELECT publication.*,article.publication_state
      FROM agent_blog_foundation_publications publication
      JOIN blog_articles article ON article.id=publication.article_id
      WHERE publication.action_id=$1`, [actionId])).rows[0];
    return view(row);
  }

  async publish({ actionId, workerId, leaseToken, articleId, revisionId, contentSha256 }) {
    const publication = await withTransaction(this.pool, async client => {
      const action = (await client.query(`SELECT action.*,run.agent_user_id,run.workflow_key,
          run.status AS run_status,stage.status AS stage_status,
          stage.leased_by AS stage_leased_by,stage.lease_token AS stage_lease_token,
          stage.lease_until>now() AS stage_lease_valid,
          account.status AS agent_status,author.status AS user_status
        FROM agent_run_actions action
        JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_run_stages stage ON stage.id=action.stage_id AND stage.run_id=action.run_id
        JOIN agent_accounts account ON account.user_id=run.agent_user_id
        JOIN users author ON author.id=run.agent_user_id
        WHERE action.id=$1 FOR UPDATE OF action,run,stage`, [actionId])).rows[0];
      if (!action || action.action_kind !== 'domain-write'
        || action.capability_key !== 'blog.article.publish' || action.contract_version !== 1
        || action.risk_level !== 'L3' || action.workflow_key !== 'blog.project.single') {
        fail('AGENT_BLOG_PUBLICATION_ACTION_INVALID');
      }
      const existing = (await client.query(`SELECT publication.*,article.publication_state
        FROM agent_blog_foundation_publications publication
        JOIN blog_articles article ON article.id=publication.article_id
        WHERE publication.action_id=$1`, [actionId])).rows[0];
      if (existing) {
        if (existing.article_id !== articleId || existing.revision_id !== revisionId
          || existing.content_sha256 !== contentSha256
          || existing.publication_state !== 'published') {
          fail('AGENT_BLOG_PUBLICATION_IDEMPOTENCY_CONFLICT');
        }
        return { ...view(existing), existing: true };
      }
      if (action.stage_leased_by !== workerId || action.stage_lease_token !== leaseToken
        || action.stage_lease_valid !== true) fail('AGENT_RUNTIME_LEASE_LOST');
      if (action.status !== 'authorized' || action.run_status !== 'running'
        || action.stage_status !== 'running' || action.agent_status !== 'active'
        || action.user_status !== 'active') fail('AGENT_BLOG_PUBLICATION_ACTION_NOT_AUTHORIZED');

      const ownership = await this.publicationOwnership.assertPublisher(
        client, action.agent_user_id, 'foundation');
      const draft = (await client.query(`SELECT mapping.*,article.publication_state,
          article.working_revision_id,article.published_revision_id,
          revision.revision_state,revision.content_hash
        FROM agent_blog_foundation_drafts mapping
        JOIN blog_articles article ON article.id=mapping.article_id
        JOIN blog_article_revisions revision
          ON revision.article_id=mapping.article_id AND revision.id=mapping.revision_id
        WHERE mapping.run_id=$1 AND mapping.agent_user_id=$2
          AND mapping.article_id=$3 AND mapping.revision_id=$4
        FOR UPDATE OF article,revision`,
      [action.run_id, action.agent_user_id, articleId, revisionId])).rows[0];
      if (!draft || draft.verification_artifact_id == null || draft.composition_artifact_id == null
        || draft.content_sha256 !== contentSha256 || draft.content_hash !== contentSha256
        || draft.publication_state !== 'draft' || draft.revision_state !== 'working'
        || draft.working_revision_id !== revisionId || draft.published_revision_id !== null) {
        fail('AGENT_BLOG_PUBLICATION_DRAFT_INVALID');
      }

      const responseRef = {
        type: 'blog.article', articleId, revisionId, publicationState: 'published',
        ownershipGeneration: ownership.generation, contentSha256,
      };
      await client.query(`UPDATE agent_run_actions SET status='reserved',reservation_ref=$2,updated_at=now()
        WHERE id=$1 AND status='authorized'`, [action.id, `database:blog-publish:${articleId}`]);
      await appendActionEvent(client, action, 'action.reserved', {
        boundary: 'database-transaction', articleId, ownershipGeneration: ownership.generation,
      });
      await client.query("UPDATE agent_run_actions SET status='sending',updated_at=now() WHERE id=$1 AND status='reserved'", [action.id]);
      await appendActionEvent(client, action, 'action.sending', {
        boundary: 'database-transaction', articleId,
      });
      await client.query("UPDATE blog_article_revisions SET revision_state='published' WHERE id=$1 AND revision_state='working'", [revisionId]);
      const published = (await client.query(`UPDATE blog_articles SET
          published_revision_id=working_revision_id,publication_state='published',
          first_published_at=now(),last_published_at=now(),version=version+1,updated_at=now()
        WHERE id=$1 AND publication_state='draft' AND working_revision_id=$2
          AND published_revision_id IS NULL RETURNING first_published_at`, [articleId, revisionId])).rows[0];
      if (!published) fail('AGENT_BLOG_PUBLICATION_DRAFT_STATE_CHANGED');
      await client.query(`INSERT INTO blog_article_events(
          id,article_id,actor_user_id,action,revision_id,details
        ) VALUES($1,$2,$3,'published',$4,$5)`,
      [crypto.randomUUID(), articleId, action.agent_user_id, revisionId, json({
        source: 'agent_foundation', runId: action.run_id, actionId: action.id,
        ownershipGeneration: ownership.generation, automatedChecks: 'passed',
        verificationArtifactId: draft.verification_artifact_id,
      })]);
      await client.query(`INSERT INTO agent_blog_foundation_publications(
          run_id,agent_user_id,action_id,article_id,revision_id,ownership_generation,
          content_sha256,published_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [action.run_id, action.agent_user_id, action.id, articleId, revisionId,
        ownership.generation, contentSha256, published.first_published_at]);
      await this.editorialMemoryRecorder(client, {
        agentUserId: action.agent_user_id, runId: action.run_id, articleId, revisionId,
        compositionArtifactId: draft.composition_artifact_id,
        publishedAt: published.first_published_at,
      });
      await client.query(`UPDATE agent_run_actions SET status='sent',provider_request_id=$2,
        sent_at=now(),updated_at=now() WHERE id=$1 AND status='sending'`,
      [action.id, `database:blog-publish:${articleId}`]);
      const acknowledged = (await client.query(`UPDATE agent_run_actions SET status='acknowledged',
        response_ref_json=$2,acknowledged_at=now(),updated_at=now()
        WHERE id=$1 AND status='sent' RETURNING id`, [action.id, json(responseRef)])).rows[0];
      if (!acknowledged) fail('AGENT_BLOG_PUBLICATION_ACTION_STATE');
      await appendActionEvent(client, action, 'action.acknowledged', {
        boundary: 'database-commit', articleId,
      });
      const succeeded = (await client.query(`UPDATE agent_run_actions SET status='succeeded',
        response_ref_json=$2,response_sha256=$3,usage_json='{}'::jsonb,
        finished_at=now(),updated_at=now()
        WHERE id=$1 AND status='acknowledged' RETURNING id`,
      [action.id, json(responseRef), contentSha256])).rows[0];
      if (!succeeded) fail('AGENT_BLOG_PUBLICATION_ACTION_STATE');
      await appendActionEvent(client, action, 'action.succeeded', {
        articleId, revisionId, publicationState: 'published', ownershipGeneration: ownership.generation,
      });
      const result = {
        runId: action.run_id, actionId: action.id, agentUserId: action.agent_user_id,
        articleId, revisionId, ownershipGeneration: ownership.generation, contentSha256,
        publicationState: 'published', publishedAt: published.first_published_at, existing: false,
      };
      await this.boundaryProbe({ boundary: 'before-commit', publication: structuredClone(result) });
      return result;
    });
    await this.boundaryProbe({ boundary: 'after-commit', publication: structuredClone(publication) });
    return publication;
  }
}
