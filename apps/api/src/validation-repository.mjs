import { withTransaction } from './database.mjs';

export class ValidationError extends Error {
  constructor(code, message) { super(message); this.name = 'ValidationError'; this.code = code; }
}

const claimedView = row => ({
  jobId: row.job_id, uploadId: row.id, leaseToken: row.lease_token, leaseUntil: new Date(row.lease_until).toISOString(),
  attempt: row.attempt, releaseId: row.release_id, ownerUserId: row.owner_user_id, workId: row.work_id,
  targetKey: row.target_key, packageType: row.package_type, releaseLabel: row.release_label, fileName: row.file_name,
  objectKey: row.object_key, actualBytes: Number(row.actual_bytes), actualSha256: row.actual_sha256,
  autoPublish: row.auto_publish, publishGeneration: row.publish_generation == null ? null : Number(row.publish_generation),
});

export class PostgresValidationRepository {
  constructor(pool) { this.pool = pool; }

  async claimNext({ leaseToken, releaseId, targetUploadId = null }) {
    return withTransaction(this.pool, async client => {
      const candidate = (await client.query(
        `SELECT j.id
           FROM jobs j JOIN upload_jobs u ON u.id=j.target_id
          WHERE j.kind='validate' AND u.state IN ('queued','validating')
            AND ($1::uuid IS NULL OR u.id=$1)
            AND ((j.state='queued' AND j.available_at<=now()) OR (j.state='leased' AND j.lease_until<now()))
          ORDER BY j.available_at,j.created_at,j.id
          FOR UPDATE OF j SKIP LOCKED LIMIT 1`, [targetUploadId],
      )).rows[0];
      if (!candidate) return null;
      const lease = (await client.query(
        `UPDATE jobs SET state='leased',attempt=attempt+1,lease_token=$2,lease_until=now()+interval '30 seconds',updated_at=now()
          WHERE id=$1 RETURNING id AS job_id,attempt,lease_token,lease_until`, [candidate.id, leaseToken],
      )).rows[0];
      const upload = (await client.query(
        `UPDATE upload_jobs SET state='validating',release_id=COALESCE(release_id,$2),updated_at=now()
          WHERE id=(SELECT target_id FROM jobs WHERE id=$1) AND state IN ('queued','validating') RETURNING *`, [candidate.id, releaseId],
      )).rows[0];
      if (!upload) throw new ValidationError('JOB_STATE_CONFLICT', 'Upload is no longer validatable.');
      return claimedView({ ...upload, ...lease });
    });
  }

  async renewLease({ jobId, leaseToken }) {
    const row = (await this.pool.query(
      `UPDATE jobs SET lease_until=now()+interval '30 seconds',updated_at=now()
        WHERE id=$1 AND state='leased' AND lease_token=$2 AND lease_until>now() RETURNING lease_until`, [jobId, leaseToken],
    )).rows[0];
    return row ? new Date(row.lease_until).toISOString() : null;
  }

  async fail({ jobId, leaseToken, uploadId, errorCode }) {
    return withTransaction(this.pool, async client => {
      const job = (await client.query("SELECT id FROM jobs WHERE id=$1 AND state='leased' AND lease_token=$2 FOR UPDATE", [jobId, leaseToken])).rows[0];
      if (!job) return false;
      const upload = (await client.query("UPDATE upload_jobs SET state='failed',error_code=$2,updated_at=now() WHERE id=$1 AND state='validating' RETURNING owner_user_id,reserved_bytes", [uploadId, errorCode])).rows[0];
      if (upload) await client.query('UPDATE creator_usage SET reserved_bytes=GREATEST(reserved_bytes-$2,0),updated_at=now() WHERE user_id=$1', [upload.owner_user_id, upload.reserved_bytes]);
      await client.query("UPDATE build_jobs SET state='failed',error_code=$2,completed_at=now(),updated_at=now() WHERE upload_job_id=$1 AND state='validating'", [uploadId, errorCode]);
      await client.query("UPDATE jobs SET state='failed',lease_until=NULL,lease_token=NULL,last_error_code=$2,updated_at=now() WHERE id=$1", [jobId, errorCode]);
      return true;
    });
  }

  async retry({ jobId, leaseToken, uploadId, errorCode }) {
    return withTransaction(this.pool, async client => {
      const job = (await client.query("SELECT attempt FROM jobs WHERE id=$1 AND state='leased' AND lease_token=$2 FOR UPDATE", [jobId, leaseToken])).rows[0];
      if (!job) return false;
      if (job.attempt >= 3) {
        const upload = (await client.query("UPDATE upload_jobs SET state='failed',error_code=$2,updated_at=now() WHERE id=$1 AND state='validating' RETURNING owner_user_id,reserved_bytes", [uploadId, errorCode])).rows[0];
        if (upload) await client.query('UPDATE creator_usage SET reserved_bytes=GREATEST(reserved_bytes-$2,0),updated_at=now() WHERE user_id=$1', [upload.owner_user_id, upload.reserved_bytes]);
        await client.query("UPDATE build_jobs SET state='failed',error_code=$2,completed_at=now(),updated_at=now() WHERE upload_job_id=$1 AND state='validating'", [uploadId, errorCode]);
        await client.query("UPDATE jobs SET state='failed',lease_until=NULL,lease_token=NULL,last_error_code=$2,updated_at=now() WHERE id=$1", [jobId, errorCode]);
        return true;
      }
      await client.query("UPDATE upload_jobs SET state='queued',error_code=$2,updated_at=now() WHERE id=$1 AND state='validating'", [uploadId, errorCode]);
      await client.query("UPDATE jobs SET state='queued',available_at=now()+interval '5 seconds',lease_until=NULL,lease_token=NULL,last_error_code=$2,updated_at=now() WHERE id=$1", [jobId, errorCode]);
      return true;
    });
  }

  async complete({ claim, published }) {
    return withTransaction(this.pool, async client => {
      const job = (await client.query("SELECT * FROM jobs WHERE id=$1 AND state='leased' AND lease_token=$2 AND lease_until>now() FOR UPDATE", [claim.jobId, claim.leaseToken])).rows[0];
      if (!job) throw new ValidationError('LEASE_LOST', 'Validation lease was lost before commit.');
      const upload = (await client.query("SELECT * FROM upload_jobs WHERE id=$1 AND state='validating' FOR UPDATE", [claim.uploadId])).rows[0];
      if (!upload || upload.release_id !== claim.releaseId) throw new ValidationError('JOB_STATE_CONFLICT', 'Upload validation state changed.');
      const work = (await client.query('SELECT * FROM works WHERE id=$1 FOR UPDATE', [upload.work_id])).rows[0];
      const target = (await client.query('SELECT * FROM work_targets WHERE work_id=$1 AND target_key=$2 FOR UPDATE', [upload.work_id, upload.target_key])).rows[0];
      await client.query('SELECT user_id FROM creator_usage WHERE user_id=$1 FOR UPDATE', [upload.owner_user_id]);

      let outcome = 'draft';
      if (upload.auto_publish) {
        if (work.state === 'suspended' || target.state === 'suspended') outcome = 'blocked';
        else if (Number(target.publish_generation) !== Number(upload.publish_generation)) outcome = 'skipped_newer_intent';
        else outcome = 'published';
      }
      const servingState = outcome === 'published' ? 'enabled' : 'disabled';
      const manifestSummary = { policyVersion: published.manifest.policyVersion, entry: published.manifest.entry, fileCount: published.manifest.fileCount, totalBytes: published.manifest.totalBytes, ...(published.manifest.native ? { native: published.manifest.native } : {}) };
      const native = published.manifest.native ?? null;
      await client.query(
        `INSERT INTO releases(id,work_id,target_key,label,package_type,os,arch,entry_path,validation_state,serving_state,manifest,approved_capabilities,artifact_sha256,asset_prefix,asset_manifest_sha256,asset_count,expanded_bytes,upload_job_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ready',$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (upload_job_id) DO NOTHING`,
        [upload.release_id, upload.work_id, upload.target_key, upload.release_label, upload.package_type, native?.os ?? null, native?.arch ?? null, published.manifest.entry, servingState, JSON.stringify(manifestSummary), JSON.stringify(published.manifest.approvedCapabilities), upload.actual_sha256, published.prefix, published.manifestSha256, published.manifest.fileCount, published.manifest.totalBytes, upload.id],
      );
      const release = (await client.query('SELECT * FROM releases WHERE upload_job_id=$1', [upload.id])).rows[0];
      if (!release || release.id !== upload.release_id) throw new ValidationError('RELEASE_ID_CONFLICT', 'Upload already produced a different release.');
      const sourceBuild = (await client.query("UPDATE build_jobs SET state=CASE WHEN state='validating' THEN 'ready' ELSE state END,release_id=$2,error_code=CASE WHEN state='validating' THEN NULL ELSE error_code END,completed_at=now(),updated_at=now() WHERE upload_job_id=$1 AND state IN('validating','superseded') RETURNING *", [upload.id, release.id])).rows[0];
      if (sourceBuild) {
        await client.query(
          `INSERT INTO release_provenance(release_id,source_revision_id,build_job_id,config_sha256,artifact_sha256,builder_image_digest)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(release_id) DO NOTHING`,
          [release.id, sourceBuild.source_revision_id, sourceBuild.id, sourceBuild.config_sha256, sourceBuild.artifact_sha256, sourceBuild.builder_image_digest],
        );
      }
      if (outcome === 'published') {
        await client.query("UPDATE work_targets SET current_release_id=$3,state='published',revision=revision+1,updated_at=now() WHERE work_id=$1 AND target_key=$2", [upload.work_id, upload.target_key, release.id]);
        await client.query("UPDATE works SET state='published',visibility='public',first_published_at=COALESCE(first_published_at,now()),revision=revision+1,updated_at=now() WHERE id=$1", [upload.work_id]);
      }
      const storedBytes = Number(upload.actual_bytes) + (upload.package_type === 'web_zip' ? Number(published.manifest.totalBytes) : 0);
      await client.query('UPDATE creator_usage SET stored_bytes=stored_bytes+$2,reserved_bytes=GREATEST(reserved_bytes-$3,0),updated_at=now() WHERE user_id=$1', [upload.owner_user_id, storedBytes, upload.reserved_bytes]);
      await client.query("UPDATE upload_jobs SET state='succeeded',publication_outcome=$2,error_code=NULL,updated_at=now() WHERE id=$1", [upload.id, outcome]);
      await client.query("UPDATE jobs SET state='succeeded',lease_until=NULL,lease_token=NULL,last_error_code=NULL,updated_at=now() WHERE id=$1", [job.id]);
      return { uploadId: upload.id, releaseId: release.id, outcome, servingState, prefix: release.asset_prefix };
    });
  }
}
