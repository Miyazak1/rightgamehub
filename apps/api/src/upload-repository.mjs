import { withTransaction } from './database.mjs';
import { UploadError } from './upload-service.mjs';

const FIVE_GIB = 5 * 1024 ** 3;
const WEB_EXPANDED_RESERVE = 300 * 1024 ** 2;
const view = row => ({
  id: row.id, workId: row.work_id, targetKey: row.target_key, packageType: row.package_type,
  state: row.state, publicationOutcome: row.publication_outcome, declaredBytes: String(row.declared_bytes),
  actualBytes: row.actual_bytes == null ? null : String(row.actual_bytes),
  createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), errorCode: row.error_code,
});

const expireStaleCreated = async (client, ownerUserId) => {
  const expired = (await client.query(
    `UPDATE upload_jobs SET state='expired',error_code='UPLOAD_EXPIRED',updated_at=now()
      WHERE owner_user_id=$1 AND state='created' AND expires_at<=now()
      RETURNING reserved_bytes`, [ownerUserId],
  )).rows;
  if (!expired.length) return;
  const reserved = expired.reduce((sum, row) => sum + Number(row.reserved_bytes), 0);
  await client.query(
    `UPDATE creator_usage SET reserved_bytes=GREATEST(reserved_bytes-$2,0),
       active_uploads=GREATEST(active_uploads-$3,0),updated_at=now() WHERE user_id=$1`,
    [ownerUserId, reserved, expired.length],
  );
};

export class PostgresUploadRepository {
  constructor(pool) { this.pool = pool; }

  async createIdempotent(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`upload:${input.actor.userId}:${input.idempotencyKey}`]);
      const previous = (await client.query("SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation='upload.create' AND key=$2", [input.actor.userId, input.idempotencyKey])).rows[0];
      if (previous) {
        if (previous.request_hash !== input.requestHash) throw new UploadError('IDEMPOTENCY_CONFLICT', 409, 'The idempotency key was used for another request.');
        return previous.result_json;
      }
      const work = (await client.query('SELECT id,state FROM works WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.workId, input.actor.userId])).rows[0];
      if (!work) throw new UploadError('NOT_FOUND', 404, 'Work not found.');
      if (work.state === 'suspended') throw new UploadError('STATE_CONFLICT', 409, 'The work is suspended.');
      await expireStaleCreated(client, input.actor.userId);
      const usage = (await client.query('SELECT * FROM creator_usage WHERE user_id=$1 FOR UPDATE', [input.actor.userId])).rows[0];
      const reserve = input.declaredBytes + WEB_EXPANDED_RESERVE;
      if (usage.active_uploads >= 1) throw new UploadError('UPLOAD_BUSY', 409, 'Another upload is active.');
      if (Number(usage.stored_bytes) + Number(usage.reserved_bytes) + reserve > FIVE_GIB) throw new UploadError('QUOTA_EXCEEDED', 429, 'Storage quota would be exceeded.');
      await client.query("INSERT INTO work_targets(work_id,target_key) VALUES ($1,$2) ON CONFLICT DO NOTHING", [input.workId, input.body.targetKey]);
      const target = (await client.query('SELECT publish_generation FROM work_targets WHERE work_id=$1 AND target_key=$2 FOR UPDATE', [input.workId, input.body.targetKey])).rows[0];
      const generation = input.body.autoPublish ? Number(target.publish_generation) + 1 : null;
      if (input.body.autoPublish) await client.query('UPDATE work_targets SET publish_generation=$3,updated_at=now() WHERE work_id=$1 AND target_key=$2', [input.workId, input.body.targetKey, generation]);
      const row = (await client.query(
        `INSERT INTO upload_jobs(id,owner_user_id,work_id,target_key,package_type,file_name,release_label,state,declared_bytes,declared_sha256,object_key,auto_publish,publish_generation,reserved_bytes,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'created',$8,$9,$10,$11,$12,$13,now()+interval '30 minutes') RETURNING *`,
        [input.uploadId, input.actor.userId, input.workId, input.body.targetKey, input.body.packageType, input.body.fileName, input.body.releaseLabel, input.declaredBytes, input.body.sha256, input.objectKey, input.body.autoPublish, generation, reserve],
      )).rows[0];
      await client.query('UPDATE creator_usage SET reserved_bytes=reserved_bytes+$2,active_uploads=active_uploads+1,updated_at=now() WHERE user_id=$1', [input.actor.userId, reserve]);
      const result = view(row);
      await client.query(`INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at) VALUES ($1,'upload.create',$2,$3,200,$4,now()+interval '24 hours')`, [input.actor.userId, input.idempotencyKey, input.requestHash, result]);
      return result;
    });
  }

  async createGrant(input) {
    return withTransaction(this.pool, async client => {
      await expireStaleCreated(client, input.actor.userId);
      const row = (await client.query('SELECT * FROM upload_jobs WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.uploadId, input.actor.userId])).rows[0];
      if (!row) throw new UploadError('NOT_FOUND', 404, 'Upload not found.');
      if (row.state !== 'created' || new Date(row.expires_at) <= new Date()) throw new UploadError('STATE_CONFLICT', 409, 'Upload cannot accept content.');
      const expiresAt = new Date(Math.min(new Date(row.expires_at).getTime() + 5 * 60_000, Date.now() + 35 * 60_000));
      await client.query(`INSERT INTO upload_grants(id,token_hash,owner_user_id,upload_id,declared_bytes,sha256,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [input.grantId, input.tokenHash, input.actor.userId, input.uploadId, row.declared_bytes, row.declared_sha256, expiresAt]);
      return { expiresAt };
    });
  }

  async beginReceive(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `SELECT u.*,g.id AS grant_id,g.expires_at AS grant_expires_at,g.consumed_at,g.revoked_at
           FROM upload_grants g JOIN upload_jobs u ON u.id=g.upload_id
          WHERE g.token_hash=$1 AND g.upload_id=$2 FOR UPDATE OF g,u`, [input.tokenHash, input.uploadId],
      )).rows[0];
      if (!row || row.consumed_at || row.revoked_at || new Date(row.grant_expires_at) <= new Date()) throw new UploadError('UPLOAD_GRANT_INVALID', 401, 'Upload grant is invalid.');
      if (row.state !== 'created') throw new UploadError('UPLOAD_BUSY', 409, 'Upload is not ready to receive content.');
      await client.query('UPDATE upload_grants SET consumed_at=now() WHERE id=$1', [row.grant_id]);
      await client.query("UPDATE upload_jobs SET state='receiving',updated_at=now() WHERE id=$1", [input.uploadId]);
      return { objectKey: row.object_key, declaredBytes: Number(row.declared_bytes), declaredSha256: row.declared_sha256 };
    });
  }

  async finishReceive(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query("UPDATE upload_jobs SET state='uploaded',actual_bytes=$2,actual_sha256=$3,updated_at=now() WHERE id=$1 AND state='receiving' RETURNING *", [input.uploadId, input.actualBytes, input.actualSha256])).rows[0];
      if (!row) throw new UploadError('STATE_CONFLICT', 409, 'Upload receive state changed.');
      await client.query('UPDATE creator_usage SET active_uploads=GREATEST(active_uploads-1,0),updated_at=now() WHERE user_id=$1', [row.owner_user_id]);
      return view(row);
    });
  }

  async failReceive(input) {
    await withTransaction(this.pool, async client => {
      const row = (await client.query("UPDATE upload_jobs SET state='failed',error_code=$2,updated_at=now() WHERE id=$1 AND state='receiving' RETURNING owner_user_id,reserved_bytes", [input.uploadId, input.errorCode])).rows[0];
      if (row) await client.query('UPDATE creator_usage SET reserved_bytes=GREATEST(reserved_bytes-$2,0),active_uploads=GREATEST(active_uploads-1,0),updated_at=now() WHERE user_id=$1', [row.owner_user_id, row.reserved_bytes]);
    });
  }

  async complete(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query('SELECT * FROM upload_jobs WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.uploadId, input.actor.userId])).rows[0];
      if (!row) throw new UploadError('NOT_FOUND', 404, 'Upload not found.');
      if (row.state === 'queued' || row.state === 'validating') return view(row);
      if (row.state !== 'uploaded') throw new UploadError('STATE_CONFLICT', 409, 'Upload content is not complete.');
      const updated = (await client.query("UPDATE upload_jobs SET state='queued',updated_at=now() WHERE id=$1 RETURNING *", [input.uploadId])).rows[0];
      await client.query("INSERT INTO jobs(id,kind,target_id,state) VALUES ($1,'validate',$2,'queued') ON CONFLICT (kind,target_id) DO NOTHING", [input.jobId, input.uploadId]);
      return view(updated);
    });
  }

  async get(input) {
    return withTransaction(this.pool, async client => {
      await expireStaleCreated(client, input.actor.userId);
      const row = (await client.query('SELECT * FROM upload_jobs WHERE id=$1 AND owner_user_id=$2', [input.uploadId, input.actor.userId])).rows[0];
      if (!row) throw new UploadError('NOT_FOUND', 404, 'Upload not found.');
      return view(row);
    });
  }
}
