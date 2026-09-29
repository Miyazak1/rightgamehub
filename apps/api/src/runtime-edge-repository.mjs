export class PostgresRuntimeEdgeRepository {
  constructor(pool) { this.pool = pool; }

  async resolveRelease(releaseId) {
    return (await this.pool.query(
      `SELECT r.id,r.work_id,r.entry_path,r.asset_prefix,r.asset_manifest_sha256,r.asset_count,r.expanded_bytes
         FROM releases r JOIN works w ON w.id=r.work_id
         JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key
        WHERE r.id=$1 AND r.target_key='web' AND r.validation_state='ready' AND r.serving_state='enabled'
          AND w.state='published' AND w.visibility='public' AND t.state='published'`, [releaseId],
    )).rows[0] ?? null;
  }
}
