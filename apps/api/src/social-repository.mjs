const profileSelect = `SELECT u.id,u.profile_handle,u.display_name,u.bio,u.social_visibility,
  a.kind AS avatar_kind,a.preset_key,a.media_type,a.sha256,a.animated,a.poster_body,a.poster_key,
  (SELECT count(*) FROM user_follows f WHERE f.followed_user_id=u.id)::int AS follower_count,
  (SELECT count(*) FROM user_follows f WHERE f.follower_user_id=u.id)::int AS following_count,
  EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id) AS is_following,
  (u.id=$1) AS is_me`;

export class PostgresSocialRepository {
  constructor(pool) { this.pool = pool; }

  async getProfile(viewerId, userId, client = this.pool) {
    return (await client.query(
      `${profileSelect} FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id
       WHERE u.id=$2 AND u.status='active'
         AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=u.id) OR (b.blocker_user_id=u.id AND b.blocked_user_id=$1))
         AND (u.id=$1 OR u.social_visibility='public' OR (u.social_visibility='followers' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id)))`,
      [viewerId, userId],
    )).rows[0] ?? null;
  }

  async updateSettings(input) {
    await this.pool.query('UPDATE users SET bio=$2,social_visibility=$3,updated_at=$4 WHERE id=$1 AND status=\'active\'', [input.userId, input.bio, input.visibility, input.now]);
    return this.getProfile(input.userId, input.userId);
  }

  async follow(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = (await client.query(
        `SELECT 1 FROM users u WHERE u.id=$2 AND u.status='active' AND u.social_visibility<>'private'
         AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$2) OR (b.blocker_user_id=$2 AND b.blocked_user_id=$1))`,
        [input.followerId, input.followedId],
      )).rows[0];
      if (!target) { await client.query('ROLLBACK'); return null; }
      const inserted = await client.query('INSERT INTO user_follows(follower_user_id,followed_user_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [input.followerId, input.followedId, input.now]);
      if (inserted.rowCount) await client.query(
        "INSERT INTO social_notifications(id,recipient_user_id,actor_user_id,type,created_at) SELECT $1,$2,$3,'follow',$4 WHERE COALESCE((SELECT follow_enabled FROM user_notification_preferences WHERE user_id=$2),true)",
        [input.notificationId, input.followedId, input.followerId, input.now],
      );
      await client.query('COMMIT');
      return this.getProfile(input.followerId, input.followedId);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async unfollow(followerId, followedId) { await this.pool.query('DELETE FROM user_follows WHERE follower_user_id=$1 AND followed_user_id=$2', [followerId, followedId]); }

  async block(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exists = (await client.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [input.blockedId])).rowCount > 0;
      if (!exists) { await client.query('ROLLBACK'); return false; }
      await client.query('DELETE FROM user_follows WHERE (follower_user_id=$1 AND followed_user_id=$2) OR (follower_user_id=$2 AND followed_user_id=$1)', [input.blockerId, input.blockedId]);
      await client.query('INSERT INTO user_blocks(blocker_user_id,blocked_user_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [input.blockerId, input.blockedId, input.now]);
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async unblock(blockerId, blockedId) { await this.pool.query('DELETE FROM user_blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2', [blockerId, blockedId]); }

  async leaderboard(input) {
    return (await this.pool.query(
      `${profileSelect},r.guessed_count,r.elapsed_seconds,r.hints,r.completed_at,
       COALESCE((SELECT jsonb_object_agg(grouped.reaction,grouped.count) FROM (SELECT gr.reaction,count(*)::int AS count FROM guess_baike_reactions gr WHERE gr.target_user_id=u.id AND gr.puzzle_date=r.puzzle_date GROUP BY gr.reaction) grouped),'{}'::jsonb) AS reaction_counts,
       (SELECT gr.reaction FROM guess_baike_reactions gr WHERE gr.reactor_user_id=$1 AND gr.target_user_id=u.id AND gr.puzzle_date=r.puzzle_date) AS own_reaction
       FROM guess_baike_results r JOIN users u ON u.id=r.user_id LEFT JOIN user_avatars a ON a.user_id=u.id
       WHERE r.puzzle_date=$2 AND u.status='active'
         AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=u.id) OR (b.blocker_user_id=u.id AND b.blocked_user_id=$1))
         AND (u.id=$1 OR u.social_visibility='public' OR (u.social_visibility='followers' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id)))
         AND ($3='global' OR u.id=$1 OR EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id))
       ORDER BY r.hints ASC,r.guessed_count ASC,r.elapsed_seconds ASC,r.completed_at ASC,u.id ASC LIMIT $4`,
      [input.viewerId, input.date, input.scope, input.limit],
    )).rows;
  }

  async react(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const visible = (await client.query(
        `SELECT 1 FROM guess_baike_results r JOIN users u ON u.id=r.user_id
         WHERE r.user_id=$2 AND r.puzzle_date=$3 AND u.status='active'
           AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$2) OR (b.blocker_user_id=$2 AND b.blocked_user_id=$1))
           AND (u.social_visibility='public' OR (u.social_visibility='followers' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=$2)))`,
        [input.reactorId, input.targetId, input.puzzleDate],
      )).rowCount > 0;
      if (!visible) { await client.query('ROLLBACK'); return false; }
      await client.query(
        `INSERT INTO guess_baike_reactions(reactor_user_id,target_user_id,puzzle_date,reaction,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (reactor_user_id,target_user_id,puzzle_date) DO UPDATE SET reaction=EXCLUDED.reaction,updated_at=EXCLUDED.updated_at`,
        [input.reactorId, input.targetId, input.puzzleDate, input.reaction, input.now],
      );
      await client.query(
        `INSERT INTO social_notifications(id,recipient_user_id,actor_user_id,type,puzzle_date,reaction,created_at)
         SELECT $1,$2,$3,'reaction',$4,$5,$6 WHERE COALESCE((SELECT reaction_enabled FROM user_notification_preferences WHERE user_id=$2),true)
         ON CONFLICT (recipient_user_id,actor_user_id,puzzle_date) WHERE type='reaction' DO UPDATE SET reaction=EXCLUDED.reaction,read_at=NULL,created_at=EXCLUDED.created_at`,
        [input.id, input.targetId, input.reactorId, input.puzzleDate, input.reaction, input.now],
      );
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async removeReaction(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM guess_baike_reactions WHERE reactor_user_id=$1 AND target_user_id=$2 AND puzzle_date=$3', [input.reactorId, input.targetId, input.puzzleDate]);
      await client.query("DELETE FROM social_notifications WHERE recipient_user_id=$2 AND actor_user_id=$1 AND type='reaction' AND puzzle_date=$3", [input.reactorId, input.targetId, input.puzzleDate]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async listNotifications(userId, limit) {
    return (await this.pool.query(
      `${profileSelect},n.id AS notification_id,n.type AS notification_type,n.puzzle_date,n.reaction,n.read_at,n.created_at AS notification_created_at,c.code AS challenge_code,p.participant_outcome
       FROM social_notifications n JOIN users u ON u.id=n.actor_user_id LEFT JOIN user_avatars a ON a.user_id=u.id
       LEFT JOIN game_challenges c ON c.id=n.challenge_id LEFT JOIN challenge_participations p ON p.challenge_id=n.challenge_id
         WHERE n.recipient_user_id=$1 AND u.status='active'
         AND ((n.type='follow' AND COALESCE((SELECT follow_enabled FROM user_notification_preferences WHERE user_id=$1),true))
           OR (n.type='reaction' AND COALESCE((SELECT reaction_enabled FROM user_notification_preferences WHERE user_id=$1),true))
           OR (n.type='challenge_complete' AND COALESCE((SELECT challenge_enabled FROM user_notification_preferences WHERE user_id=$1),true)))
         AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=u.id) OR (b.blocker_user_id=u.id AND b.blocked_user_id=$1))
         AND (n.type='challenge_complete' OR u.id=$1 OR u.social_visibility='public' OR (u.social_visibility='followers' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id)))
       ORDER BY n.created_at DESC LIMIT $2`,
      [userId, limit],
    )).rows;
  }

  async markNotificationsRead(userId, now) {
    return (await this.pool.query('UPDATE social_notifications SET read_at=$2 WHERE recipient_user_id=$1 AND read_at IS NULL', [userId, now])).rowCount;
  }

  async createChallenge(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`challenge-create:${input.creatorId}:${input.puzzleDate}`]);
      const hasResult = (await client.query('SELECT 1 FROM guess_baike_results WHERE user_id=$1 AND puzzle_date=$2', [input.creatorId, input.puzzleDate])).rowCount > 0;
      if (!hasResult) { await client.query('ROLLBACK'); return { error: 'result_required' }; }
      const count = Number((await client.query('SELECT count(*)::int AS count FROM game_challenges WHERE creator_user_id=$1 AND puzzle_date=$2', [input.creatorId, input.puzzleDate])).rows[0].count);
      if (count >= 5) { await client.query('ROLLBACK'); return { error: 'limit' }; }
      const row = (await client.query(
        'INSERT INTO game_challenges(id,code,creator_user_id,puzzle_date,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,code,puzzle_date,expires_at',
        [input.id, input.code, input.creatorId, input.puzzleDate, input.now, input.expiresAt],
      )).rows[0];
      await client.query('COMMIT'); return row;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async getChallenge(viewerId, code, now) {
    return (await this.pool.query(
      `${profileSelect},c.id AS challenge_id,c.code,c.puzzle_date,c.expires_at,r.guessed_count,r.elapsed_seconds,r.hints,
       p.participant_user_id,p.completed_at AS participation_completed_at,p.participant_outcome
       FROM game_challenges c JOIN guess_baike_results r ON r.user_id=c.creator_user_id AND r.puzzle_date=c.puzzle_date
       JOIN users u ON u.id=c.creator_user_id LEFT JOIN user_avatars a ON a.user_id=u.id LEFT JOIN challenge_participations p ON p.challenge_id=c.id
       WHERE c.code=$2 AND c.expires_at>$3 AND u.status='active'
         AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=u.id) OR (b.blocker_user_id=u.id AND b.blocked_user_id=$1))
         AND (u.id=$1 OR u.social_visibility='public' OR (u.social_visibility='followers' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id)))`,
      [viewerId, code, now],
    )).rows[0] ?? null;
  }

  async acceptChallenge(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const challenge = (await client.query('SELECT id,creator_user_id,puzzle_date,expires_at FROM game_challenges WHERE code=$1 FOR UPDATE', [input.code])).rows[0];
      if (!challenge || new Date(challenge.expires_at) <= input.now) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
      if (challenge.creator_user_id === input.userId) { await client.query('ROLLBACK'); return { error: 'self' }; }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`challenge-accept:${input.userId}:${String(challenge.puzzle_date).slice(0, 10)}`]);
      const blocked = (await client.query('SELECT 1 FROM user_blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)', [input.userId, challenge.creator_user_id])).rowCount > 0;
      if (blocked) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
      const existing = (await client.query('SELECT participant_user_id,completed_at,participant_outcome FROM challenge_participations WHERE challenge_id=$1', [challenge.id])).rows[0];
      if (existing) {
        await client.query('ROLLBACK');
        return existing.participant_user_id === input.userId ? { accepted: true, completed: Boolean(existing.completed_at), outcome: existing.participant_outcome } : { error: 'taken' };
      }
      const accepted = Number((await client.query(`SELECT count(*)::int AS count FROM challenge_participations p JOIN game_challenges c ON c.id=p.challenge_id WHERE p.participant_user_id=$1 AND c.puzzle_date=$2`, [input.userId, challenge.puzzle_date])).rows[0].count);
      if (accepted >= 10) { await client.query('ROLLBACK'); return { error: 'limit' }; }
      await client.query('INSERT INTO challenge_participations(challenge_id,participant_user_id,accepted_at) VALUES ($1,$2,$3)', [challenge.id, input.userId, input.now]);
      await client.query('COMMIT'); return { accepted: true, completed: false, outcome: null };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async completeChallenge(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(
        `SELECT c.id,c.creator_user_id,c.puzzle_date,c.expires_at,p.completed_at,p.participant_outcome,
          cr.guessed_count AS creator_guessed,cr.elapsed_seconds AS creator_elapsed,cr.hints AS creator_hints,
          pr.guessed_count AS participant_guessed,pr.elapsed_seconds AS participant_elapsed,pr.hints AS participant_hints
         FROM game_challenges c JOIN challenge_participations p ON p.challenge_id=c.id
         JOIN guess_baike_results cr ON cr.user_id=c.creator_user_id AND cr.puzzle_date=c.puzzle_date
         LEFT JOIN guess_baike_results pr ON pr.user_id=p.participant_user_id AND pr.puzzle_date=c.puzzle_date
         WHERE c.code=$1 AND p.participant_user_id=$2 FOR UPDATE OF p`,
        [input.code, input.userId],
      )).rows[0];
      if (!row || new Date(row.expires_at) <= input.now) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
      if (row.participant_guessed == null) { await client.query('ROLLBACK'); return { error: 'result_required' }; }
      const creator = [Number(row.creator_hints),Number(row.creator_guessed),Number(row.creator_elapsed)];
      const participant = [Number(row.participant_hints),Number(row.participant_guessed),Number(row.participant_elapsed)];
      const comparison = participant.findIndex((value,index) => value !== creator[index]);
      const outcome = comparison < 0 ? 'draw' : participant[comparison] < creator[comparison] ? 'win' : 'loss';
      if (!row.completed_at) {
        await client.query('UPDATE challenge_participations SET completed_at=$2,participant_outcome=$3 WHERE challenge_id=$1', [row.id, input.now, outcome]);
        await client.query(
          `INSERT INTO social_notifications(id,recipient_user_id,actor_user_id,type,puzzle_date,challenge_id,created_at)
           SELECT $1,$2,$3,'challenge_complete',$4,$5,$6 WHERE COALESCE((SELECT challenge_enabled FROM user_notification_preferences WHERE user_id=$2),true)
           ON CONFLICT (recipient_user_id,actor_user_id,challenge_id) WHERE type='challenge_complete' DO NOTHING`,
          [input.notificationId, row.creator_user_id, input.userId, row.puzzle_date, row.id, input.now],
        );
      }
      await client.query('COMMIT');
      return { outcome: row.participant_outcome ?? outcome, creator: { hints: creator[0], guessedCount: creator[1], elapsedSeconds: creator[2] }, participant: { hints: participant[0], guessedCount: participant[1], elapsedSeconds: participant[2] } };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async listChallenges(userId, now, limit) {
    return (await this.pool.query(
      `SELECT c.id,c.code,c.creator_user_id,c.puzzle_date,c.expires_at,p.participant_user_id,p.completed_at,p.participant_outcome,
        cr.guessed_count AS creator_guessed,cr.elapsed_seconds AS creator_elapsed,cr.hints AS creator_hints,
        pr.guessed_count AS participant_guessed,pr.elapsed_seconds AS participant_elapsed,pr.hints AS participant_hints
       FROM game_challenges c LEFT JOIN challenge_participations p ON p.challenge_id=c.id
       JOIN guess_baike_results cr ON cr.user_id=c.creator_user_id AND cr.puzzle_date=c.puzzle_date
       LEFT JOIN guess_baike_results pr ON pr.user_id=p.participant_user_id AND pr.puzzle_date=c.puzzle_date
       WHERE c.creator_user_id=$1 OR p.participant_user_id=$1
       ORDER BY GREATEST(c.created_at,COALESCE(p.completed_at,p.accepted_at,c.created_at)) DESC LIMIT $2`,
      [userId, limit],
    )).rows.map(row => ({ ...row, expired: new Date(row.expires_at) <= now }));
  }

  async getRetention(userId) {
    const [dates, challengeStats] = await Promise.all([
      this.pool.query('SELECT puzzle_date FROM guess_baike_results WHERE user_id=$1 ORDER BY puzzle_date ASC', [userId]),
      this.pool.query(
        `SELECT
          count(*) FILTER (WHERE p.completed_at IS NOT NULL)::int AS completed,
          count(*) FILTER (WHERE p.completed_at IS NOT NULL AND ((c.creator_user_id=$1 AND p.participant_outcome='loss') OR (p.participant_user_id=$1 AND p.participant_outcome='win')))::int AS wins
         FROM game_challenges c LEFT JOIN challenge_participations p ON p.challenge_id=c.id
         WHERE c.creator_user_id=$1 OR p.participant_user_id=$1`,
        [userId],
      ),
    ]);
    return { dates: dates.rows.map(row => String(row.puzzle_date).slice(0, 10)), completedChallenges: Number(challengeStats.rows[0].completed), challengeWins: Number(challengeStats.rows[0].wins) };
  }

  async getNotificationPreferences(userId) {
    return (await this.pool.query(
      `SELECT COALESCE(p.follow_enabled,true) AS follow_enabled,COALESCE(p.reaction_enabled,true) AS reaction_enabled,COALESCE(p.challenge_enabled,true) AS challenge_enabled
       FROM users u LEFT JOIN user_notification_preferences p ON p.user_id=u.id WHERE u.id=$1 AND u.status='active'`,
      [userId],
    )).rows[0] ?? null;
  }

  async updateNotificationPreferences(input) {
    return (await this.pool.query(
      `INSERT INTO user_notification_preferences(user_id,follow_enabled,reaction_enabled,challenge_enabled,updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET follow_enabled=EXCLUDED.follow_enabled,reaction_enabled=EXCLUDED.reaction_enabled,challenge_enabled=EXCLUDED.challenge_enabled,updated_at=EXCLUDED.updated_at
       RETURNING follow_enabled,reaction_enabled,challenge_enabled`,
      [input.userId, input.follow, input.reaction, input.challenge, input.now],
    )).rows[0];
  }
}
