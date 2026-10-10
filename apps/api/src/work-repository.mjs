import { withTransaction } from './database.mjs';
import { WorkError } from './work-service.mjs';

const publicWork = row => ({
  id: row.id, ownerUserId: row.owner_user_id, title: row.title, description: row.description,
  instructions: row.instructions, kind: row.kind, state: row.state, visibility: row.visibility,
  revision: String(row.revision), firstPublishedAt: row.first_published_at?.toISOString?.() ?? row.first_published_at ?? null,
  estimatedMinutes: row.estimated_minutes, tags: row.tags ?? [], agentLabel: row.agent_label,
  repositoryUrl: row.repository_url, licenseSpdx: row.license_spdx,
  creatorDisplayName: row.creator_display_name ?? null, creatorHandle: row.creator_handle ?? null, playCount: Number(row.play_count ?? 0), saveCount: Number(row.save_count ?? 0),
  coverUrl: row.cover_object_key && row.state === 'published' && row.visibility === 'public' ? `/v1/works/${row.id}/cover?v=${Buffer.from(row.cover_sha256).toString('hex').slice(0, 12)}` : null,
  targets: [],
});

const creatorWorks = rows => {
  const works = new Map();
  for (const row of rows) {
    if (!works.has(row.id)) works.set(row.id, publicWork(row));
    if (row.target_key) works.get(row.id).targets.push({
      targetKey: row.target_key, state: row.target_state,
      currentReleaseId: row.current_release_id, revision: String(row.target_revision),
    });
  }
  return [...works.values()];
};

const releaseView = row => ({
  id: row.id, targetKey: row.target_key, label: row.label, packageType: row.package_type,
  validationState: row.validation_state, servingState: row.serving_state,
  createdAt: new Date(row.created_at).toISOString(),
});

async function replayOrConflict(client, input, operation) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`idempotency:${input.actor.userId}:${operation}:${input.idempotencyKey}`]);
  const existing = (await client.query(
    'SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3',
    [input.actor.userId, operation, input.idempotencyKey],
  )).rows[0];
  if (!existing) return null;
  if (existing.request_hash !== input.requestHash) throw new WorkError('IDEMPOTENCY_CONFLICT', 409, 'The idempotency key was already used for another request.');
  return existing.result_json;
}

export class PostgresWorkRepository {
  constructor(pool, coverStore = null) { this.pool = pool; this.coverStore = coverStore; }

  async listMine(userId) {
    const rows = (await this.pool.query(
      `SELECT w.*,t.target_key,t.state AS target_state,t.current_release_id,t.revision AS target_revision
         FROM works w LEFT JOIN work_targets t ON t.work_id=w.id
        WHERE w.owner_user_id=$1 ORDER BY w.updated_at DESC,w.id,t.target_key`, [userId],
    )).rows;
    return creatorWorks(rows);
  }

  async listReleases(userId, workId) {
    const owner = (await this.pool.query('SELECT id FROM works WHERE id=$1 AND owner_user_id=$2', [workId, userId])).rows[0];
    if (!owner) throw new WorkError('NOT_FOUND', 404, 'Work not found.');
    const rows = (await this.pool.query(
      `SELECT r.id,r.target_key,r.label,r.package_type,r.validation_state,r.serving_state,r.created_at
         FROM releases r WHERE r.work_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 100`, [workId],
    )).rows;
    return rows.map(releaseView);
  }

  async setCover(input) {
    if (!this.coverStore) throw new WorkError('COVER_STORE_UNAVAILABLE', 503, 'Cover storage is unavailable.');
    const objectKey = await this.coverStore.put({ workId: input.workId, body: input.body, sha256: input.sha256 });
    let oldKey = null; let committed = false;
    try {
      const result = await withTransaction(this.pool, async client => {
        const current = (await client.query('SELECT * FROM works WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.workId, input.actor.userId])).rows[0];
        if (!current) throw new WorkError('NOT_FOUND', 404, 'Work not found.');
        oldKey = current.cover_object_key;
        const row = (await client.query(
          `UPDATE works SET cover_object_key=$3,cover_sha256=$4,cover_media_type=$5,cover_byte_length=$6,cover_width=$7,cover_height=$8,
            revision=revision+1,updated_at=now() WHERE id=$1 AND owner_user_id=$2 RETURNING *`,
          [input.workId, input.actor.userId, objectKey, Buffer.from(input.sha256, 'hex'), input.mediaType, input.body.length, input.width, input.height],
        )).rows[0];
        return publicWork(row);
      });
      committed = true;
      if (oldKey && oldKey !== objectKey) await this.coverStore.remove(oldKey).catch(() => {});
      return result;
    } finally {
      if (!committed && objectKey !== oldKey) await this.coverStore.remove(objectKey).catch(() => {});
    }
  }

  async getPublicCover(workId) {
    if (!this.coverStore) return null;
    const row = (await this.pool.query("SELECT cover_object_key,cover_media_type FROM works WHERE id=$1 AND state='published' AND visibility='public' AND cover_object_key IS NOT NULL", [workId])).rows[0];
    if (!row) return null;
    return { mediaType: row.cover_media_type, body: await this.coverStore.get(row.cover_object_key) };
  }

  async createIdempotent(input) {
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input, 'work.create');
      if (replay) return replay;
      const user = (await client.query('SELECT status,can_publish FROM users WHERE id=$1 FOR UPDATE', [input.actor.userId])).rows[0];
      if (!user || user.status !== 'active' || !user.can_publish) throw new WorkError('PUBLISH_NOT_ENABLED', 403, 'Publishing is not enabled for this account.');
      const row = (await client.query(
        `INSERT INTO works(id,owner_user_id,title,description,instructions,kind,estimated_minutes,tags,agent_label,repository_url,license_spdx,attribution_kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [input.workId, input.actor.userId, input.body.title, input.body.description, input.body.instructions ?? '', input.body.kind,
          input.body.estimatedMinutes ?? 3, input.body.tags ?? [], input.body.agentLabel ?? null, input.body.repositoryUrl ?? null, input.body.licenseSpdx ?? null,input.body.attributionKind],
      )).rows[0];
      await client.query('UPDATE creator_usage SET work_count=work_count+1,updated_at=now() WHERE user_id=$1', [input.actor.userId]);
      const result = publicWork(row);
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'work.create',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.actor.userId, input.idempotencyKey, input.requestHash, result],
      );
      return result;
    });
  }

  async updateIdempotent(input) {
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input, 'work.update');
      if (replay) return replay;
      const current = (await client.query('SELECT * FROM works WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.workId, input.actor.userId])).rows[0];
      if (!current) throw new WorkError('NOT_FOUND', 404, 'Work not found.');
      if (String(current.revision) !== String(input.expectedRevision)) throw new WorkError('REVISION_CONFLICT', 412, 'The work changed; reload before editing.');
      const nextRepositoryUrl = input.body.repositoryUrl === undefined ? current.repository_url : input.body.repositoryUrl;
      const nextLicenseSpdx = input.body.licenseSpdx === undefined ? current.license_spdx : input.body.licenseSpdx;
      if (Boolean(nextRepositoryUrl) !== Boolean(nextLicenseSpdx)) throw new WorkError('SCHEMA_INVALID', 400, 'GitHub repository and SPDX license must be provided together.');
      const row = (await client.query(
        `UPDATE works SET title=$3,description=$4,instructions=$5,estimated_minutes=$6,tags=$7,agent_label=$8,repository_url=$9,license_spdx=$10,revision=revision+1,updated_at=now()
          WHERE id=$1 AND owner_user_id=$2 RETURNING *`,
        [input.workId, input.actor.userId, input.body.title ?? current.title, input.body.description ?? current.description, input.body.instructions ?? current.instructions,
          input.body.estimatedMinutes ?? current.estimated_minutes, input.body.tags ?? current.tags, input.body.agentLabel === undefined ? current.agent_label : input.body.agentLabel,
          nextRepositoryUrl, nextLicenseSpdx],
      )).rows[0];
      const result = publicWork(row);
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'work.update',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.actor.userId, input.idempotencyKey, input.requestHash, result],
      );
      return result;
    });
  }

  async withdrawIdempotent(input) {
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input, 'work.withdraw');
      if (replay) return replay;
      const current = (await client.query('SELECT * FROM works WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.workId, input.actor.userId])).rows[0];
      if (!current) throw new WorkError('NOT_FOUND', 404, 'Work not found.');
      if (String(current.revision) !== String(input.expectedRevision)) throw new WorkError('REVISION_CONFLICT', 412, 'The work changed; reload before withdrawing.');
      await client.query(
        `UPDATE work_targets SET current_release_id=NULL,state='withdrawn',publish_generation=publish_generation+1,
          revision=revision+1,updated_at=now() WHERE work_id=$1`, [input.workId],
      );
      await client.query("UPDATE releases SET serving_state='disabled' WHERE work_id=$1 AND serving_state='enabled'", [input.workId]);
      const row = (await client.query(
        `UPDATE works SET state='withdrawn',visibility='private',revision=revision+1,updated_at=now()
          WHERE id=$1 RETURNING *`, [input.workId],
      )).rows[0];
      const result = publicWork(row);
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'work.withdraw',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.actor.userId, input.idempotencyKey, input.requestHash, result],
      );
      return result;
    });
  }
}
