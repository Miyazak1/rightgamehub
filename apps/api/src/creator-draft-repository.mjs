import { withTransaction } from './database.mjs';
import { CreatorDraftError } from './creator-draft-service.mjs';

const view = row => ({
  id: row.id, studio: row.studio_key, schemaVersion: row.schema_version, title: row.title,
  status: row.work_state === 'published' ? 'published' : row.status, content: row.content, workId: row.work_id, revision: String(row.revision),
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
});
const summary = row => ({
  id: row.id, studio: row.studio_key, schemaVersion: row.schema_version, title: row.title,
  status: row.work_state === 'published' ? 'published' : row.status, workId: row.work_id, revision: String(row.revision),
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
});
async function replayOrConflict(client, input, operation) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`idempotency:${input.actor.userId}:${operation}:${input.idempotencyKey}`]);
  const existing = (await client.query('SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3', [input.actor.userId, operation, input.idempotencyKey])).rows[0];
  if (!existing) return null;
  if (existing.request_hash !== input.requestHash) throw new CreatorDraftError('IDEMPOTENCY_CONFLICT', 409, '这个幂等键已经用于其他草稿请求。');
  return existing.result_json;
}

export class PostgresCreatorDraftRepository {
  constructor(pool) { this.pool = pool; }

  async list(userId, studio = null) {
    const rows = (await this.pool.query(
      `SELECT d.id,d.studio_key,d.schema_version,d.title,d.status,d.work_id,d.revision,d.created_at,d.updated_at,w.state AS work_state
         FROM creator_drafts d LEFT JOIN works w ON w.id=d.work_id
        WHERE d.owner_user_id=$1 AND ($2::text IS NULL OR d.studio_key=$2)
        ORDER BY d.updated_at DESC,d.id LIMIT 100`, [userId, studio],
    )).rows;
    return rows.map(summary);
  }

  async get(userId, draftId) {
    const row = (await this.pool.query('SELECT d.*,w.state AS work_state FROM creator_drafts d LEFT JOIN works w ON w.id=d.work_id WHERE d.id=$1 AND d.owner_user_id=$2', [draftId, userId])).rows[0];
    return row ? view(row) : null;
  }

  async bindWork(userId, draftId, workId) {
    return withTransaction(this.pool, async client => {
      const current = (await client.query('SELECT * FROM creator_drafts WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [draftId, userId])).rows[0];
      if (!current) throw new CreatorDraftError('DRAFT_NOT_FOUND', 404, '找不到这个创作草稿。');
      if (current.work_id && current.work_id !== workId) throw new CreatorDraftError('DRAFT_WORK_CONFLICT', 409, '这个草稿已经绑定了其他作品。');
      if (!current.work_id) {
        const row = (await client.query('UPDATE creator_drafts SET work_id=$3,updated_at=now() WHERE id=$1 AND owner_user_id=$2 RETURNING *', [draftId, userId, workId])).rows[0];
        return view(row);
      }
      return view(current);
    });
  }

  async createIdempotent(input) {
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input, 'creator-draft.create');
      if (replay) return replay;
      const user = (await client.query('SELECT status,can_publish FROM users WHERE id=$1 FOR UPDATE', [input.actor.userId])).rows[0];
      if (!user || user.status !== 'active' || !user.can_publish) throw new CreatorDraftError('PUBLISH_NOT_ENABLED', 403, '当前账号尚未开通创作权限。');
      const row = (await client.query(
        `INSERT INTO creator_drafts(id,owner_user_id,studio_key,schema_version,title,content)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.draftId, input.actor.userId, input.body.studio, input.body.schemaVersion, input.body.title, input.body.content],
      )).rows[0];
      await client.query(
        `INSERT INTO creator_draft_revisions(id,draft_id,revision,schema_version,title,content)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.revisionId, row.id, row.revision, row.schema_version, row.title, row.content],
      );
      const result = view(row);
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'creator-draft.create',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.actor.userId, input.idempotencyKey, input.requestHash, result],
      );
      return result;
    });
  }

  async updateIdempotent(input) {
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input, 'creator-draft.update');
      if (replay) return replay;
      const current = (await client.query('SELECT * FROM creator_drafts WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.draftId, input.actor.userId])).rows[0];
      if (!current) throw new CreatorDraftError('DRAFT_NOT_FOUND', 404, '找不到这个创作草稿。');
      if (String(current.revision) !== String(input.expectedRevision)) throw new CreatorDraftError('DRAFT_REVISION_CONFLICT', 412, '草稿已在其他位置更新，请刷新后继续。');
      const row = (await client.query(
        `UPDATE creator_drafts SET title=$3,content=$4,schema_version=$5,revision=revision+1,updated_at=now()
          WHERE id=$1 AND owner_user_id=$2 RETURNING *`,
        [input.draftId, input.actor.userId, input.body.title ?? current.title, input.body.content ?? current.content, input.body.schemaVersion ?? current.schema_version],
      )).rows[0];
      await client.query(
        `INSERT INTO creator_draft_revisions(id,draft_id,revision,schema_version,title,content)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.revisionId, row.id, row.revision, row.schema_version, row.title, row.content],
      );
      const result = view(row);
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'creator-draft.update',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.actor.userId, input.idempotencyKey, input.requestHash, result],
      );
      return result;
    });
  }
}
