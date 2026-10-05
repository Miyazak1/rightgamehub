import { withTransaction } from './database.mjs';
import { GameSessionError } from './game-session-service.mjs';

const launchQuery = `
  SELECT r.id,r.approved_capabilities,r.game_session_generation AS release_generation,
    w.game_session_generation AS work_generation,t.game_session_generation AS target_generation,
    w.owner_user_id,w.state AS work_state,w.visibility,t.state AS target_state
  FROM releases r JOIN works w ON w.id=r.work_id
  JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key
  WHERE r.work_id=$1 AND r.id=$2 AND r.validation_state='ready' AND r.serving_state='enabled'
    AND (r.retire_after IS NULL OR r.retire_after>$3)
    AND w.state NOT IN ('withdrawn','suspended')
  FOR SHARE OF r,w,t`;
export class PostgresGameSessionRepository {
  constructor(pool) { this.pool = pool; }
  async create(input) {
    return withTransaction(this.pool, async client => {
      // The grant row serializes the active-session quota across all API processes.
      const grant = (await client.query(`SELECT g.id FROM device_grants g JOIN users u ON u.id=g.user_id
        WHERE g.id=$1 AND g.user_id=$2 AND g.revoked_at IS NULL AND g.expires_at>$3 AND u.status='active'
        FOR UPDATE OF g`, [input.grantId, input.userId, input.now])).rows[0];
      if (!grant) throw new GameSessionError('AUTH_REQUIRED', 401, 'Authentication is required.');
      await client.query('DELETE FROM game_sessions WHERE grant_id=$1 AND expires_at<=$2', [input.grantId,input.now]);
      const issued = (await client.query('SELECT count(*)::int AS count FROM game_sessions WHERE grant_id=$1 AND issued_at>$2',
        [input.grantId,new Date(input.now.getTime()-60_000)])).rows[0].count;
      if (issued >= 30) throw new GameSessionError('GAME_SESSION_RATE_LIMITED', 429, 'Too many game launches; retry later.', true);
      const active = (await client.query('SELECT count(*)::int AS count FROM game_sessions WHERE grant_id=$1 AND revoked_at IS NULL', [input.grantId])).rows[0].count;
      if (active >= 8) throw new GameSessionError('GAME_SESSION_LIMIT', 429, 'Too many active game sessions.', true);
      const row = (await client.query(launchQuery, [input.workId,input.releaseId,input.now])).rows[0];
      if (!row || (input.channel === 'production'
        ? row.work_state !== 'published' || row.visibility !== 'public' || row.target_state !== 'published'
        : row.owner_user_id !== input.userId)) {
        throw new GameSessionError('GAME_SESSION_RELEASE_NOT_ALLOWED', 403, 'This release cannot be launched in the requested channel.');
      }
      const scopeRow = (await client.query('SELECT namespaces,mode_ids,status AS scope_status,generation AS scope_generation FROM game_release_service_scopes WHERE release_id=$1 AND channel=$2 FOR SHARE', [input.releaseId,input.channel])).rows[0];
      const scope = input.deriveScope({ ...row,...scopeRow });
      const params = [input.tokenHash,input.userId,input.grantId,input.workId,input.releaseId,input.channel,input.launchNonce,
        scope.capabilities,JSON.stringify(scope.namespaces),scope.modeIds,row.work_generation,row.target_generation,row.release_generation,scopeRow?.scope_generation ?? 0,input.now,input.expiresAt];
      try {
        await client.query(`INSERT INTO game_sessions(token_hash,user_id,grant_id,work_id,release_id,channel,launch_nonce,
          capabilities,namespaces,mode_ids,work_generation,target_generation,release_generation,scope_generation,issued_at,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,params);
      } catch (error) {
        if (error.code === '23505') throw new GameSessionError('GAME_SESSION_NONCE_REUSED',409,'Launch nonce has already been used.');
        throw error;
      }
      return { expiresAt: input.expiresAt, capabilities: scope.capabilities };
    });
  }
  async resolve(input, transaction) {
    const db = transaction ?? this.pool;
    if (transaction) {
      // Keep the issuance lock order and hold authority stable through commit.
      await db.query('SELECT id FROM device_grants WHERE id=$1 AND user_id=$2 FOR SHARE', [input.grantId,input.userId]);
      await db.query(`SELECT r.id FROM game_sessions s JOIN releases r ON r.id=s.release_id
        JOIN works w ON w.id=s.work_id JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.grant_id=$3 FOR SHARE OF r,w,t,u`,
        [input.tokenHash,input.userId,input.grantId]);
      await db.query(`SELECT a.release_id FROM game_sessions s JOIN game_release_service_scopes a
        ON a.release_id=s.release_id AND a.channel=s.channel WHERE s.token_hash=$1 FOR SHARE OF a`, [input.tokenHash]);
    }
    const row = (await db.query(`SELECT s.* FROM game_sessions s
      JOIN device_grants g ON g.id=s.grant_id AND g.user_id=s.user_id
      JOIN users u ON u.id=s.user_id
      JOIN releases r ON r.id=s.release_id AND r.work_id=s.work_id
      JOIN works w ON w.id=s.work_id
      JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key
      LEFT JOIN game_release_service_scopes a ON a.release_id=s.release_id AND a.channel=s.channel
      WHERE s.token_hash=$1 AND s.user_id=$2 AND s.grant_id=$3
        AND s.revoked_at IS NULL AND s.expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND g.revoked_at IS NULL AND g.expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND u.status='active'
        AND r.validation_state='ready' AND r.serving_state='enabled' AND (r.retire_after IS NULL OR r.retire_after>GREATEST($4::timestamptz,clock_timestamp()))
        AND w.state NOT IN ('withdrawn','suspended')
        AND (s.channel='production' AND w.state='published' AND w.visibility='public' AND t.state='published'
          OR s.channel='preview' AND w.owner_user_id=s.user_id)
        AND s.work_generation=w.game_session_generation AND s.target_generation=t.game_session_generation
        AND s.release_generation=r.game_session_generation AND s.scope_generation=COALESCE(a.generation,0)
        AND (NOT (s.capabilities && ARRAY['cloudSave','competition']::text[]) OR a.status='active')${transaction ? ' FOR SHARE OF s' : ''}`,
      [input.tokenHash,input.userId,input.grantId,input.now])).rows[0];
    if (!row) return null;
    return { userId: row.user_id, grantId: row.grant_id, workId: row.work_id, releaseId: row.release_id, channel: row.channel,
      capabilities: row.capabilities, namespaces: row.namespaces, modeIds: row.mode_ids, expiresAt: new Date(row.expires_at).toISOString() };
  }
  async revoke(input) {
    await this.pool.query('UPDATE game_sessions SET revoked_at=COALESCE(revoked_at,$4) WHERE token_hash=$1 AND user_id=$2 AND grant_id=$3',
      [input.tokenHash,input.userId,input.grantId,input.now]);
  }
}
