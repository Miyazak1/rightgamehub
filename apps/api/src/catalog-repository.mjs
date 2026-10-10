import { OPEN_SOURCE_LICENSES, REMIXABLE_LICENSES, isOpenSourceLicense, isRemixableLicense } from './catalog-policy.mjs';

const targetView = row => ({ targetKey: row.target_key, state: row.target_state, currentReleaseId: row.current_release_id, revision: String(row.target_revision), packageType: row.package_type, releaseLabel: row.release_label, os: row.release_os, arch: row.release_arch, fileName: row.release_file_name ?? null, sizeBytes: row.release_size_bytes == null ? null : Number(row.release_size_bytes), sha256: row.release_sha256 ?? null });
const workView = rows => ({
  id: rows[0].id, ownerUserId: rows[0].owner_user_id, title: rows[0].title, description: rows[0].description,
  instructions: rows[0].instructions, kind: rows[0].kind, state: rows[0].state, visibility: rows[0].visibility,
  revision: String(rows[0].revision), firstPublishedAt: new Date(rows[0].first_published_at).toISOString(),
  estimatedMinutes: rows[0].estimated_minutes, tags: rows[0].tags ?? [], agentLabel: rows[0].agent_label,
  repositoryUrl: rows[0].repository_url, licenseSpdx: rows[0].license_spdx,
  ingestionMethod: rows[0].ingestion_method, attributionKind: rows[0].attribution_kind,
  sourceCommitSha: rows.find(row=>row.source_commit_sha)?.source_commit_sha ?? null,
  openSource: Boolean(rows[0].repository_url && isOpenSourceLicense(rows[0].license_spdx)), remixable: Boolean(rows[0].repository_url && isRemixableLicense(rows[0].license_spdx)),
  claimStatus: rows[0].claim_status ?? (rows[0].attribution_kind === 'community_catalog' ? 'unclaimed' : 'publisher'),
  claimEligible: rows[0].attribution_kind === 'community_catalog' && !rows[0].claim_status,
  creatorDisplayName: rows[0].creator_display_name ?? null, creatorHandle: rows[0].creator_handle ?? null,
  playCount: Number(rows[0].play_count ?? 0), saveCount: Number(rows[0].save_count ?? 0),
  coverUrl: rows[0].cover_object_key ? `/v1/works/${rows[0].id}/cover?v=${Buffer.from(rows[0].cover_sha256).toString('hex').slice(0, 12)}` : null,
  targets: rows.map(targetView),
});

export class PostgresCatalogRepository {
  constructor(pool) { this.pool = pool; }

  async list({ limit, kind, q='', offset=0, editorialIds=[], runtime=null, source=null, openSource=false, remixable=false, claimable=false }) {
    const result = await this.pool.query(
      `SELECT w.*,u.display_name AS creator_display_name,u.profile_handle AS creator_handle,COALESCE(e.play_count,0) AS play_count,COALESCE(e.save_count,0) AS save_count,
              sr.commit_sha AS source_commit_sha,c.status AS claim_status,
              t.target_key,t.state AS target_state,t.current_release_id,t.revision AS target_revision,
              r.package_type,r.label AS release_label,r.os AS release_os,r.arch AS release_arch,
              r.artifact_sha256 AS release_sha256,ru.file_name AS release_file_name,ru.actual_bytes AS release_size_bytes
         FROM works w JOIN work_targets t ON t.work_id=w.id
         JOIN users u ON u.id=w.owner_user_id
         LEFT JOIN LATERAL (SELECT status FROM project_claims WHERE work_id=w.id AND status IN ('pending','verified','disputed','suspended') ORDER BY submitted_at DESC LIMIT 1) c ON true
         LEFT JOIN LATERAL (SELECT COALESCE(SUM(play_count),0)::integer AS play_count,COUNT(*) FILTER (WHERE saved_at IS NOT NULL)::integer AS save_count FROM user_library WHERE work_key=w.id::text) e ON true
         JOIN releases r ON r.id=t.current_release_id AND r.work_id=t.work_id AND r.target_key=t.target_key
         LEFT JOIN release_provenance rp ON rp.release_id=r.id
         LEFT JOIN source_revisions sr ON sr.id=rp.source_revision_id
         JOIN upload_jobs ru ON ru.id=r.upload_job_id
        WHERE w.state='published' AND w.visibility='public' AND t.state='published'
          AND r.validation_state='ready' AND r.serving_state='enabled'
          AND w.id IN (
            SELECT visible.id FROM works visible JOIN users author ON author.id=visible.owner_user_id
             WHERE visible.state='published' AND visible.visibility='public'
               AND ($1::text IS NULL OR visible.kind=$1)
               AND ($3::text='' OR strpos(lower(concat_ws(' ',visible.title,visible.description,array_to_string(visible.tags,' '),author.display_name,visible.agent_label)),$3)>0 OR EXISTS(SELECT 1 FROM jsonb_to_recordset($5::jsonb) AS copy(id uuid,title text) WHERE copy.id=visible.id AND copy.title=visible.title))
               AND ($6::text IS NULL OR EXISTS(SELECT 1 FROM work_targets ft JOIN releases fr ON fr.id=ft.current_release_id AND fr.work_id=ft.work_id AND fr.target_key=ft.target_key WHERE ft.work_id=visible.id AND ft.target_key=CASE $6 WHEN 'windows' THEN 'windows-x64' ELSE $6 END AND ft.state='published' AND fr.validation_state='ready' AND fr.serving_state='enabled'))
               AND ($7::text IS NULL OR $7='community_catalog' AND visible.attribution_kind='community_catalog' OR $7 IN ('github_import','zip_upload') AND visible.ingestion_method=$7 OR $7='platform' AND false)
               AND (NOT $8::boolean OR visible.repository_url IS NOT NULL AND lower(visible.license_spdx)=ANY($12::text[]))
               AND (NOT $9::boolean OR lower(visible.license_spdx)=ANY($10::text[]))
               AND (NOT $11::boolean OR visible.attribution_kind='community_catalog' AND NOT EXISTS(SELECT 1 FROM project_claims pc WHERE pc.work_id=visible.id AND pc.status IN ('pending','verified','disputed','suspended')))
               AND EXISTS(SELECT 1 FROM work_targets vt JOIN releases vr ON vr.id=vt.current_release_id AND vr.work_id=vt.work_id AND vr.target_key=vt.target_key JOIN upload_jobs vj ON vj.id=vr.upload_job_id WHERE vt.work_id=visible.id AND vt.state='published' AND vr.validation_state='ready' AND vr.serving_state='enabled')
             ORDER BY visible.first_published_at DESC,visible.id LIMIT $2 OFFSET $4
          )
        ORDER BY w.first_published_at DESC,w.id,t.target_key`, [kind, limit,q,offset,JSON.stringify(editorialIds),runtime,source,openSource,remixable,REMIXABLE_LICENSES,claimable,OPEN_SOURCE_LICENSES],
    );
    const groups = new Map();
    for (const row of result.rows) { if (!groups.has(row.id)) groups.set(row.id, []); groups.get(row.id).push(row); }
    return [...groups.values()].map(workView);
  }

  async get(workId) {
    const rows = (await this.pool.query(
      `SELECT w.*,u.display_name AS creator_display_name,u.profile_handle AS creator_handle,COALESCE(e.play_count,0) AS play_count,COALESCE(e.save_count,0) AS save_count,
              sr.commit_sha AS source_commit_sha,c.status AS claim_status,
              t.target_key,t.state AS target_state,t.current_release_id,t.revision AS target_revision,
              r.package_type,r.label AS release_label,r.os AS release_os,r.arch AS release_arch,
              r.artifact_sha256 AS release_sha256,ru.file_name AS release_file_name,ru.actual_bytes AS release_size_bytes
         FROM works w JOIN work_targets t ON t.work_id=w.id
         JOIN users u ON u.id=w.owner_user_id
         LEFT JOIN LATERAL (SELECT status FROM project_claims WHERE work_id=w.id AND status IN ('pending','verified','disputed','suspended') ORDER BY submitted_at DESC LIMIT 1) c ON true
         LEFT JOIN LATERAL (SELECT COALESCE(SUM(play_count),0)::integer AS play_count,COUNT(*) FILTER (WHERE saved_at IS NOT NULL)::integer AS save_count FROM user_library WHERE work_key=w.id::text) e ON true
         JOIN releases r ON r.id=t.current_release_id AND r.work_id=t.work_id AND r.target_key=t.target_key
         LEFT JOIN release_provenance rp ON rp.release_id=r.id
         LEFT JOIN source_revisions sr ON sr.id=rp.source_revision_id
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
          AND r.validation_state='ready' AND r.serving_state='enabled' AND (r.retire_after IS NULL OR r.retire_after>clock_timestamp())`, [workId, releaseId],
    )).rows[0] ?? null;
  }
}
