const view = row => row ? ({
  code: row.code,
  workId: row.work_id,
  title: row.title,
  payload: row.payload,
  createdAt: new Date(row.created_at).toISOString(),
}) : null;

export class PostgresGameShareRepository {
  constructor(pool) { this.pool = pool; }

  async findByDigest({ userId,workId,payloadSha256 }) {
    return view((await this.pool.query(
      `SELECT code,work_id,title,payload,created_at FROM game_share_links
        WHERE created_by=$1 AND work_id=$2 AND payload_sha256=$3`,
      [userId,workId,payloadSha256],
    )).rows[0]);
  }

  async create({ id,code,userId,workId,title,payload,payloadSha256,payloadBytes }) {
    return view((await this.pool.query(
      `INSERT INTO game_share_links(id,code,created_by,work_id,title,payload,payload_sha256,payload_bytes)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       RETURNING code,work_id,title,payload,created_at`,
      [id,code,userId,workId,title,JSON.stringify(payload),payloadSha256,payloadBytes],
    )).rows[0]);
  }

  async get(code) {
    return view((await this.pool.query(
      `SELECT s.code,s.work_id,s.title,s.payload,s.created_at
         FROM game_share_links s
         JOIN works w ON w.id=s.work_id
         JOIN work_targets t ON t.work_id=w.id AND t.target_key='web'
        WHERE s.code=$1 AND w.state='published' AND w.visibility='public'
          AND t.state='published' AND t.current_release_id IS NOT NULL`, [code],
    )).rows[0]);
  }
}
