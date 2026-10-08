export class PostgresEngagementRepository {
  constructor(pool) { this.pool = pool; }

  async list(userId,{limit=null,recent=false}={}) {
    return (await this.pool.query(
      `SELECT work_key,saved_at,last_played_at,play_count
         FROM user_library WHERE user_id=$1 AND (NOT $2::boolean OR last_played_at IS NOT NULL)
        ORDER BY CASE WHEN $2::boolean THEN last_played_at ELSE GREATEST(COALESCE(saved_at,'epoch'),COALESCE(last_played_at,'epoch')) END DESC,work_key LIMIT $3`,
      [userId,recent,limit],
    )).rows;
  }

  async get(userId, workKey) {
    return (await this.pool.query(
      'SELECT work_key,saved_at,last_played_at,play_count FROM user_library WHERE user_id=$1 AND work_key=$2',
      [userId, workKey],
    )).rows[0] ?? null;
  }

  async save(userId, workKey, now) {
    await this.pool.query(
      `INSERT INTO user_library(user_id,work_key,saved_at,updated_at) VALUES ($1,$2,$3,$3)
       ON CONFLICT (user_id,work_key) DO UPDATE SET saved_at=COALESCE(user_library.saved_at,EXCLUDED.saved_at),updated_at=EXCLUDED.updated_at`,
      [userId, workKey, now],
    );
    return this.get(userId, workKey);
  }

  async unsave(userId, workKey, now) {
    await this.pool.query(
      'UPDATE user_library SET saved_at=NULL,updated_at=$3 WHERE user_id=$1 AND work_key=$2',
      [userId, workKey, now],
    );
    await this.pool.query(
      'DELETE FROM user_library WHERE user_id=$1 AND work_key=$2 AND saved_at IS NULL AND last_played_at IS NULL',
      [userId, workKey],
    );
    return this.get(userId, workKey);
  }

  async recordPlay(userId, workKey, now) {
    await this.pool.query(
      `INSERT INTO user_library(user_id,work_key,last_played_at,play_count,updated_at) VALUES ($1,$2,$3,1,$3)
       ON CONFLICT (user_id,work_key) DO UPDATE SET last_played_at=EXCLUDED.last_played_at,play_count=user_library.play_count+1,updated_at=EXCLUDED.updated_at`,
      [userId, workKey, now],
    );
    return this.get(userId, workKey);
  }

  async saveGuessResult(input) {
    await this.pool.query(
      `INSERT INTO guess_baike_results(user_id,puzzle_date,puzzle_id,guessed_count,elapsed_seconds,hints,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id,puzzle_date) DO UPDATE SET
         puzzle_id=EXCLUDED.puzzle_id,
         guessed_count=EXCLUDED.guessed_count,
         elapsed_seconds=EXCLUDED.elapsed_seconds,
         hints=EXCLUDED.hints,
         completed_at=EXCLUDED.completed_at
       WHERE (EXCLUDED.hints,EXCLUDED.guessed_count,EXCLUDED.elapsed_seconds,EXCLUDED.completed_at)
           < (guess_baike_results.hints,guess_baike_results.guessed_count,guess_baike_results.elapsed_seconds,guess_baike_results.completed_at)`,
      [input.userId, input.puzzleDate, input.puzzleId, input.guessedCount, input.elapsedSeconds, input.hints, input.now],
    );
  }
}
