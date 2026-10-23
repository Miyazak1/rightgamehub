import { withTransaction } from './database.mjs';
import { BlogArticleError, blogRequestHash } from './blog-contract.mjs';
import {accountDisclosure} from './agent-disclosure.mjs';

const fail = (code, statusCode, message) => { throw new BlogArticleError(code, statusCode, message); };
const iso = value => value ? new Date(value).toISOString() : null;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicColumns = `a.*,r.id AS revision_id,r.title,r.summary,r.blocks,r.citations,r.content_hash,
  u.display_name AS author_display_name,CASE WHEN u.social_visibility='public' THEN u.profile_handle ELSE NULL END AS author_handle,
  u.account_type,aa.badge_label AS agent_badge_label,aa.operator_label AS agent_operator_label`;
const publicJoins = ` FROM blog_articles a
  JOIN blog_article_revisions r ON r.id=a.published_revision_id AND r.article_id=a.id
  JOIN users u ON u.id=a.author_user_id LEFT JOIN agent_accounts aa ON aa.user_id=u.id`;
const manageColumns = `a.*,r.id AS revision_id,r.title,r.summary,r.blocks,r.citations,r.content_hash,
  u.display_name AS author_display_name,u.profile_handle AS author_handle,u.account_type,
  aa.badge_label AS agent_badge_label,aa.operator_label AS agent_operator_label,
  p.source_contract_version,p.topic_id,p.report_snapshot_id,p.report_sha256,p.claim_ids,p.evidence_ids,p.generated_at`;
const manageJoins = ` FROM blog_articles a
  JOIN blog_article_revisions r ON r.id=a.working_revision_id AND r.article_id=a.id
  JOIN users u ON u.id=a.author_user_id LEFT JOIN agent_accounts aa ON aa.user_id=u.id
  LEFT JOIN blog_revision_research_provenance p ON p.revision_id=r.id`;

const author = row => ({ id: row.author_user_id, displayName: row.author_display_name, handle: row.author_handle ?? null, ...accountDisclosure(row) });
const publicView = row => ({
  id: row.id,
  slug: row.slug,
  locale: row.locale,
  title: row.title,
  summary: row.summary,
  blocks: row.blocks,
  citations: row.citations,
  contentHash: row.content_hash,
  revisionId: row.revision_id,
  author: author(row),
  publishedAt: iso(row.last_published_at),
  firstPublishedAt: iso(row.first_published_at),
  updatedAt: iso(row.updated_at),
});
const manageView = row => ({
  ...publicView(row),
  publicationState: row.publication_state,
  version: String(row.version),
  publishedRevisionId: row.published_revision_id ?? null,
  workingRevisionId: row.working_revision_id,
  withdrawnAt: iso(row.withdrawn_at),
  provenance: row.source_contract_version ? {
    contractVersion: row.source_contract_version,
    topicId: row.topic_id,
    reportSnapshotId: row.report_snapshot_id,
    reportSha256: row.report_sha256,
    claimIds: row.claim_ids,
    evidenceIds: row.evidence_ids,
    generatedAt: iso(row.generated_at),
  } : null,
});

const readCursor = (value, scope) => {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 800) throw new Error('invalid');
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (cursor.v !== 1 || cursor.scope !== scope || !Number.isFinite(Date.parse(cursor.at))
      || !uuidPattern.test(cursor.id)) throw new Error('invalid');
    return cursor;
  } catch { fail('BLOG_CURSOR_INVALID', 400, '分页位置无效，请刷新列表。'); }
};
const cursorFor = (scope, row) => Buffer.from(JSON.stringify({ v: 1, scope, at: row.sort_at, id: row.id })).toString('base64url');

async function replayOrConflict(client, input, operation) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`blog:${input.actor.userId}:${operation}:${input.idempotencyKey}`]);
  const existing = (await client.query(
    'SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3',
    [input.actor.userId, operation, input.idempotencyKey],
  )).rows[0];
  if (!existing) return null;
  if (existing.request_hash !== input.requestHash) fail('IDEMPOTENCY_CONFLICT', 409, '请求标识已用于其他文章操作。');
  return existing.result_json;
}

async function saveReceipt(client, input, operation, status, result) {
  await client.query(
    `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours')`,
    [input.actor.userId, operation, input.idempotencyKey, input.requestHash, status, result],
  );
}

async function appendEvent(client, input, action, details = {}) {
  await client.query(
    'INSERT INTO blog_article_events(id,article_id,actor_user_id,action,revision_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [input.eventId, input.articleId, input.actor.userId, action, input.revisionId ?? null, details],
  );
}

async function insertRevision(client, input) {
  const contentHash = blogRequestHash(input.body);
  await client.query(
    `INSERT INTO blog_article_revisions(id,article_id,author_user_id,title,summary,blocks,citations,content_hash,revision_state)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'working')`,
    [input.revisionId, input.articleId, input.actor.userId, input.body.title, input.body.summary,
      JSON.stringify(input.body.blocks), JSON.stringify(input.body.citations), contentHash],
  );
  return contentHash;
}

async function manageArticle(client, articleId, userId) {
  const row = (await client.query(`${manageColumns}${manageJoins} WHERE a.id=$1 AND a.author_user_id=$2`, [articleId, userId])).rows[0];
  if (!row) fail('BLOG_ARTICLE_NOT_FOUND', 404, '文章不存在。');
  return manageView(row);
}

async function lockArticle(client, input) {
  const row = (await client.query('SELECT * FROM blog_articles WHERE id=$1 AND author_user_id=$2 FOR UPDATE', [input.articleId, input.actor.userId])).rows[0];
  if (!row) fail('BLOG_ARTICLE_NOT_FOUND', 404, '文章不存在。');
  if (String(row.version) !== String(input.expectedVersion)) fail('BLOG_VERSION_CONFLICT', 412, '文章已经变化，请重新加载。');
  return row;
}

async function ensureActiveWriter(client, actor) {
  const user = (await client.query('SELECT status,role,can_publish FROM users WHERE id=$1 FOR SHARE', [actor.userId])).rows[0];
  if (!user || user.status !== 'active' || user.role !== 'admin' || !user.can_publish) fail('BLOG_WRITE_FORBIDDEN', 403, '当前账号没有平台文章编辑权限。');
}

async function enforceWriteLimit(client, actor) {
  const writes = Number((await client.query(
    "SELECT count(*)::int AS count FROM blog_article_events WHERE actor_user_id=$1 AND created_at>now()-interval '24 hours'",
    [actor.userId],
  )).rows[0].count);
  if (writes >= 200) fail('BLOG_RATE_LIMITED', 429, '今天的文章操作次数已达上限。');
}

async function createDraft(client, input) {
  const drafts = Number((await client.query(
    "SELECT count(*)::int AS count FROM blog_articles WHERE author_user_id=$1 AND publication_state='draft'",
    [input.actor.userId],
  )).rows[0].count);
  if (drafts >= 100) fail('BLOG_RATE_LIMITED', 429, '文章草稿数量已达上限。');
  try {
    await client.query(
      `INSERT INTO blog_articles(id,author_user_id,slug,locale,publication_state,working_revision_id)
       VALUES($1,$2,$3,$4,'draft',$5)`,
      [input.articleId, input.actor.userId, input.body.slug, input.body.locale, input.revisionId],
    );
  } catch (error) {
    if (error.code === '23505') fail('BLOG_SLUG_TAKEN', 409, '这个文章地址已经被使用。');
    throw error;
  }
  await insertRevision(client, input);
  await appendEvent(client, input, 'draft_created', { source: input.provenance ? 'research' : 'manual' });
  return manageArticle(client, input.articleId, input.actor.userId);
}

async function verifyResearchProvenance(client, input) {
  const source = input.provenance;
  const report = (await client.query(
    `SELECT r.id FROM tool_research_reports r
      JOIN tool_research_topics t ON t.id=r.topic_id
     WHERE r.id=$1 AND r.topic_id=$2 AND r.content_sha256=$3 AND t.user_id=$4 FOR SHARE OF r,t`,
    [source.reportSnapshotId, source.topicId, source.reportSha256, input.actor.userId],
  )).rows[0];
  if (!report) fail('BLOG_PROVENANCE_UNVERIFIED', 409, '研究报告快照不存在、不属于当前账号或摘要不匹配。');
  const acceptedClaims = Number((await client.query(
    `SELECT count(*)::int AS count FROM tool_research_claims
      WHERE topic_id=$1 AND id=ANY($2::uuid[]) AND status='accepted'`,
    [source.topicId, source.claimIds],
  )).rows[0].count);
  if (acceptedClaims !== source.claimIds.length) fail('BLOG_PROVENANCE_UNVERIFIED', 409, '研究草稿包含未接受或不属于该主题的声明。');
  const verifiedEvidence = Number((await client.query(
    `SELECT count(DISTINCT ce.evidence_id)::int AS count
       FROM tool_research_claims c
       JOIN tool_research_claim_evidence ce ON ce.claim_id=c.id AND ce.revision=c.current_revision
       JOIN tool_research_evidence e ON e.id=ce.evidence_id
      WHERE c.topic_id=$1 AND c.id=ANY($2::uuid[]) AND ce.evidence_id=ANY($3::uuid[])
        AND 'citation'=ANY(e.allowed_uses)`,
    [source.topicId, source.claimIds, source.evidenceIds],
  )).rows[0].count);
  if (verifiedEvidence !== source.evidenceIds.length) fail('BLOG_PROVENANCE_UNVERIFIED', 409, '研究草稿包含未关联、非当前版本或不可引用的证据。');
}

export class PostgresBlogRepository {
  constructor(pool) { this.pool = pool; }

  async listPublic({ limit, locale, query = null, author: authorHandle = null, cursor }) {
    const scope = `public:${locale ?? '*'}:${query ?? ''}:${authorHandle ?? '*'}`;
    const position = readCursor(cursor, scope);
    const rows = (await this.pool.query(
      `SELECT ${publicColumns},a.last_published_at::text AS sort_at${publicJoins}
        WHERE a.publication_state='published' AND ($1::text IS NULL OR a.locale=$1)
          AND ($2::text IS NULL OR position(lower($2) in lower(r.title))>0 OR position(lower($2) in lower(r.summary))>0)
          AND ($3::text IS NULL OR u.profile_handle=$3)
          AND ($4::timestamptz IS NULL OR (a.last_published_at,a.id)<($4::timestamptz,$5::uuid))
        ORDER BY a.last_published_at DESC,a.id DESC LIMIT $6`,
      [locale, query, authorHandle, position?.at ?? null, position?.id ?? null, limit + 1],
    )).rows;
    const page = rows.slice(0, limit);
    return { items: page.map(publicView), nextCursor: rows.length > limit ? cursorFor(scope, page.at(-1)) : null };
  }

  async getPublic(slug) {
    const row = (await this.pool.query(
      `SELECT ${publicColumns}${publicJoins} WHERE a.slug=$1 AND a.publication_state='published'`, [slug],
    )).rows[0];
    if (!row) fail('BLOG_ARTICLE_NOT_FOUND', 404, '文章不存在。');
    return publicView(row);
  }

  async listMine({ actor, limit, cursor }) {
    const scope = `mine:${actor.userId}`;
    const position = readCursor(cursor, scope);
    const rows = (await this.pool.query(
      `SELECT ${manageColumns},a.updated_at::text AS sort_at${manageJoins}
        WHERE a.author_user_id=$1
          AND ($2::timestamptz IS NULL OR (a.updated_at,a.id)<($2::timestamptz,$3::uuid))
        ORDER BY a.updated_at DESC,a.id DESC LIMIT $4`,
      [actor.userId, position?.at ?? null, position?.id ?? null, limit + 1],
    )).rows;
    const page = rows.slice(0, limit);
    return { items: page.map(manageView), nextCursor: rows.length > limit ? cursorFor(scope, page.at(-1)) : null };
  }

  getMine({ actor, articleId }) { return manageArticle(this.pool, articleId, actor.userId); }

  async mutate(input) {
    const operation = `blog.${input.operation}`;
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input, operation);
      if (replay) return replay;
      await ensureActiveWriter(client, input.actor);
      await enforceWriteLimit(client, input.actor);
      let result;
      if (input.operation === 'create_draft') {
        result = await createDraft(client, input);
      } else if (input.operation === 'revise_draft') {
        const current = await lockArticle(client, input);
        const revisions = Number((await client.query('SELECT count(*)::int AS count FROM blog_article_revisions WHERE article_id=$1', [current.id])).rows[0].count);
        if (revisions >= 200) fail('BLOG_REVISION_LIMITED', 429, '该文章的修订数量已达上限。');
        if (current.first_published_at && (current.slug !== input.body.slug || current.locale !== input.body.locale)) fail('BLOG_ADDRESS_LOCKED', 409, '文章首次发布后不能修改地址或语言。');
        if (current.working_revision_id && current.working_revision_id !== current.published_revision_id) {
          await client.query("UPDATE blog_article_revisions SET revision_state='superseded' WHERE id=$1 AND revision_state='working'", [current.working_revision_id]);
        }
        await insertRevision(client, input);
        try {
          await client.query(
            `UPDATE blog_articles SET slug=$2,locale=$3,working_revision_id=$4,version=version+1,updated_at=now()
              WHERE id=$1`, [input.articleId, input.body.slug, input.body.locale, input.revisionId],
          );
        } catch (error) {
          if (error.code === '23505') fail('BLOG_SLUG_TAKEN', 409, '这个文章地址已经被使用。');
          throw error;
        }
        await appendEvent(client, input, 'draft_revised', { previousWorkingRevisionId: current.working_revision_id });
        result = await manageArticle(client, input.articleId, input.actor.userId);
      } else if (input.operation === 'publish') {
        const current = await lockArticle(client, input);
        if (!current.working_revision_id || (current.publication_state === 'published' && current.working_revision_id === current.published_revision_id)) fail('BLOG_STATE_CONFLICT', 409, '文章没有可发布的新草稿。');
        if (current.published_revision_id && current.published_revision_id !== current.working_revision_id) {
          await client.query("UPDATE blog_article_revisions SET revision_state='superseded' WHERE id=$1 AND revision_state='published'", [current.published_revision_id]);
        }
        await client.query("UPDATE blog_article_revisions SET revision_state='published' WHERE id=$1 AND article_id=$2 AND revision_state='working'", [current.working_revision_id, current.id]);
        await client.query(
          `UPDATE blog_articles SET published_revision_id=working_revision_id,publication_state='published',
            first_published_at=COALESCE(first_published_at,now()),last_published_at=now(),withdrawn_at=NULL,
            version=version+1,updated_at=now() WHERE id=$1`, [current.id],
        );
        await appendEvent(client, { ...input, revisionId: current.working_revision_id }, 'published', { previousPublishedRevisionId: current.published_revision_id });
        result = await manageArticle(client, input.articleId, input.actor.userId);
      } else if (input.operation === 'withdraw') {
        const current = await lockArticle(client, input);
        if (current.publication_state !== 'published') fail('BLOG_STATE_CONFLICT', 409, '只有公开文章可以撤回。');
        await client.query("UPDATE blog_articles SET publication_state='withdrawn',withdrawn_at=now(),version=version+1,updated_at=now() WHERE id=$1", [current.id]);
        await appendEvent(client, { ...input, revisionId: current.published_revision_id }, 'withdrawn');
        result = await manageArticle(client, input.articleId, input.actor.userId);
      } else fail('BLOG_OPERATION_INVALID', 400, '文章操作无效。');
      await saveReceipt(client, input, operation, input.operation === 'create_draft' ? 201 : 200, result);
      return result;
    });
  }

  async importResearchDraft(input) {
    const operation = 'blog.import_research_draft';
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input, operation);
      if (replay) return replay;
      await ensureActiveWriter(client, input.actor);
      await enforceWriteLimit(client, input.actor);
      await verifyResearchProvenance(client, input);
      const result = await createDraft(client, input);
      await client.query(
        `INSERT INTO blog_revision_research_provenance(
          revision_id,source_contract_version,topic_id,report_snapshot_id,report_sha256,claim_ids,evidence_ids,generated_at,imported_by_user_id
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [input.revisionId, input.provenance.contractVersion, input.provenance.topicId, input.provenance.reportSnapshotId,
          input.provenance.reportSha256, input.provenance.claimIds, input.provenance.evidenceIds, input.provenance.generatedAt, input.actor.userId],
      );
      const hydrated = await manageArticle(client, input.articleId, input.actor.userId);
      await saveReceipt(client, input, operation, 201, hydrated);
      return hydrated;
    });
  }
}
