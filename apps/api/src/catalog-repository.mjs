const targetView = row => ({ targetKey: row.target_key, state: row.target_state, currentReleaseId: row.current_release_id, revision: String(row.target_revision), packageType: row.package_type, releaseLabel: row.release_label, os: row.release_os, arch: row.release_arch, fileName: row.release_file_name ?? null, sizeBytes: row.release_size_bytes == null ? null : Number(row.release_size_bytes), sha256: row.release_sha256 ?? null });
const workView = rows => ({
  id: rows[0].id, ownerUserId: rows[0].owner_user_id, title: rows[0].title, description: rows[0].description,
  instructions: rows[0].instructions, kind: rows[0].kind, state: rows[0].state, visibility: rows[0].visibility,
  revision: String(rows[0].revision), firstPublishedAt: new Date(rows[0].first_published_at).toISOString(),
  estimatedMinutes: rows[0].estimated_minutes, tags: rows[0].tags ?? [], agentLabel: rows[0].agent_label,
  repositoryUrl: rows[0].repository_url, licenseSpdx: rows[0].license_spdx,
  creatorDisplayName: rows[0].creator_display_name ?? null, creatorHandle: rows[0].creator_handle ?? null,
  playCount: Number(rows[0].play_count ?? 0), saveCount: Number(rows[0].save_count ?? 0),
  coverUrl: rows[0].cover_object_key ? `/v1/works/${rows[0].id}/cover?v=${Buffer.from(rows[0].cover_sha256).toString('hex').slice(0, 12)}` : null,
  targets: rows.map(targetView),
});

export class PostgresCatalogRepository {
  constructor(pool) { this.pool = pool; }

  async list({ limit, kind }) {
    const result = await this.pool.query(
      `SELECT w.*,u.display_name AS creator_display_name,u.profile_handle AS creator_handle,COALESCE(e.play_count,0) AS play_count,COALESCE(e.save_count,0) AS save_count,
              t.target_key,t.state AS target_state,t.current_release_id,t.revision AS target_revision,
              r.package_type,r.label AS release_label,r.os AS release_os,r.arch AS release_arch,
              r.artifact_sha256 AS release_sha256,ru.file_name AS release_file_name,ru.actual_bytes AS release_size_bytes
         FROM works w JOIN work_targets t ON t.work_id=w.id
         JOIN users u ON u.id=w.owner_user_id
         LEFT JOIN LATERAL (SELECT COALESCE(SUM(play_count),0)::integer AS play_count,COUNT(*) FILTER (WHERE saved_at IS NOT NULL)::integer AS save_count FROM user_library WHERE work_key=w.id::text) e ON true
         JOIN releases r ON r.id=t.current_release_id AND r.work_id=t.work_id AND r.target_key=t.target_key
         JOIN upload_jobs ru ON ru.id=r.upload_job_id
        WHERE w.state='published' AND w.visibility='public' AND t.state='published'
          AND r.validation_state='ready' AND r.serving_state='enabled'
          AND ($1::text IS NULL OR w.kind=$1)
          AND w.id IN (
            SELECT visible.id FROM works visible JOIN work_targets visible_target ON visible_target.work_id=visible.id
             WHERE visible.state='published' AND visible.visibility='public' AND visible_target.current_release_id IS NOT NULL
             ORDER BY visible.first_published_at DESC,visible.id LIMIT $2
          )
        ORDER BY w.first_published_at DESC,w.id,t.target_key`, [kind, limit],
    );
    const groups = new Map();
    for (const row of result.rows) { if (!groups.has(row.id)) groups.set(row.id, []); groups.get(row.id).push(row); }
    return [...groups.values()].map(workView);
  }

  async get(workId) {
    const rows = (await this.pool.query(
      `SELECT w.*,u.display_name AS creator_display_name,u.profile_handle AS creator_handle,COALESCE(e.play_count,0) AS play_count,COALESCE(e.save_count,0) AS save_count,
              t.target_key,t.state AS target_state,t.current_release_id,t.revision AS target_revision,
              r.package_type,r.label AS release_label,r.os AS release_os,r.arch AS release_arch,
              r.artifact_sha256 AS release_sha256,ru.file_name AS release_file_name,ru.actual_bytes AS release_size_bytes
         FROM works w JOIN work_targets t ON t.work_id=w.id
         JOIN users u ON u.id=w.owner_user_id
         LEFT JOIN LATERAL (SELECT COALESCE(SUM(play_count),0)::integer AS play_count,COUNT(*) FILTER (WHERE saved_at IS NOT NULL)::integer AS save_count FROM user_library WHERE work_key=w.id::text) e ON true
         JOIN releases r ON r.id=t.current_release_id AND r.work_id=t.work_id AND r.target_key=t.target_key
         JOIN upload_jobs ru ON ru.id=r.upload_job_id
        WHERE w.id=$1 AND w.state='published' AND w.visibility='public' AND t.state='published'
          AND r.validation_state='ready' AND r.serving_state='enabled'
        ORDER BY t.target_key`, [workId],
    )).rows;
    return rows.length ? workView(rows) : null;
  }

  async getDownload(workId, releaseId) {
    return (await this.pool.query(
      `SELECT r.id,r.work_id,r.target_key,r.package_type,r.os,r.arch,r.entry_path,r.artifact_sha256,
              u.object_key,u.file_name,u.actual_bytes
         FROM releases r
         JOIN works w ON w.id=r.work_id
         JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key AND t.current_release_id=r.id
         JOIN upload_jobs u ON u.id=r.upload_job_id
        WHERE r.work_id=$1 AND r.id=$2 AND r.target_key LIKE 'windows-%'
          AND r.validation_state='ready' AND r.serving_state='enabled'
          AND w.state='published' AND w.visibility='public' AND t.state='published'`,
      [workId, releaseId],
    )).rows[0] ?? null;
  }

  async getLaunch(workId, releaseId = null) {
    return (await this.pool.query(
      `SELECT r.*,t.current_release_id,r.approved_capabilities
         FROM releases r JOIN works w ON w.id=r.work_id
         JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key
        WHERE r.work_id=$1 AND r.target_key='web'
          AND ($2::uuid IS NULL AND r.id=t.current_release_id OR $2::uuid IS NOT NULL AND r.id=$2)
          AND w.state='published' AND w.visibility='public' AND t.state='published'
          AND r.validation_state='ready' AND r.serving_state='enabled'`, [workId, releaseId],
    )).rows[0] ?? null;
  }
}
