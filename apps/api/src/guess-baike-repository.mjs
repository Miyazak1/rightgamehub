export class PostgresGuessBaikeRepository {
  constructor(pool) { this.pool = pool; }
  async seed(puzzles, now) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const puzzle of puzzles) await client.query(
        `INSERT INTO guess_baike_puzzles(id,title,aliases,category,source_kind,source_title,source_url,source_revision,source_updated_at,license,intro_han_count,content,status,quality_reason,imported_at,updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,aliases=EXCLUDED.aliases,category=EXCLUDED.category,source_kind=EXCLUDED.source_kind,source_title=EXCLUDED.source_title,source_url=EXCLUDED.source_url,source_revision=EXCLUDED.source_revision,source_updated_at=EXCLUDED.source_updated_at,license=EXCLUDED.license,intro_han_count=EXCLUDED.intro_han_count,content=EXCLUDED.content,status=CASE WHEN guess_baike_puzzles.status='disabled' THEN 'disabled' ELSE EXCLUDED.status END,quality_reason=EXCLUDED.quality_reason,updated_at=EXCLUDED.updated_at`,
        [puzzle.id,puzzle.title,JSON.stringify(puzzle.aliases),puzzle.category,puzzle.sourceKind,puzzle.sourceTitle,puzzle.sourceUrl,puzzle.sourceRevision,puzzle.sourceUpdatedAt,puzzle.license,puzzle.introHanCount,puzzle.content,puzzle.status,puzzle.qualityReason,now],
      );
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async daily(date) {
    return (await this.pool.query(
      `SELECT p.* FROM guess_baike_puzzles p
       WHERE p.status='ready'
       ORDER BY (p.id=(SELECT puzzle_id FROM guess_baike_schedule WHERE puzzle_date=$1)) DESC,md5(p.id || $1) ASC LIMIT 1`, [date],
    )).rows[0] ?? null;
  }
  async list() {
    return (await this.pool.query(
      `SELECT p.*,COALESCE(jsonb_agg(s.puzzle_date ORDER BY s.puzzle_date) FILTER (WHERE s.puzzle_date IS NOT NULL),'[]'::jsonb) AS scheduled_dates
       FROM guess_baike_puzzles p LEFT JOIN guess_baike_schedule s ON s.puzzle_id=p.id GROUP BY p.id ORDER BY p.status DESC,p.title ASC`,
    )).rows;
  }
  async setStatus(id, status, now) {
    return (await this.pool.query(
      `UPDATE guess_baike_puzzles SET status=$2,updated_at=$3
       WHERE id=$1 AND ($2='disabled' OR quality_reason IS NULL) RETURNING *`, [id,status,now],
    )).rows[0] ?? null;
  }
  async schedule(input) {
    return (await this.pool.query(
      `INSERT INTO guess_baike_schedule(puzzle_date,puzzle_id,created_by_user_id,created_at,origin)
       SELECT $1,p.id,$3,$4,'manual' FROM guess_baike_puzzles p WHERE p.id=$2 AND p.status='ready'
       ON CONFLICT (puzzle_date) DO UPDATE SET puzzle_id=EXCLUDED.puzzle_id,created_by_user_id=EXCLUDED.created_by_user_id,created_at=EXCLUDED.created_at,origin='manual' RETURNING puzzle_date,puzzle_id`,
      [input.date,input.puzzleId,input.userId,input.now],
    )).rows[0] ?? null;
  }
  async automationSnapshot(fromDate, toDate) {
    const [puzzles, schedules] = await Promise.all([
      this.pool.query("SELECT id,category FROM guess_baike_puzzles WHERE status='ready' ORDER BY id"),
      this.pool.query('SELECT puzzle_date,puzzle_id,origin FROM guess_baike_schedule WHERE puzzle_date BETWEEN $1 AND $2 ORDER BY puzzle_date', [fromDate,toDate]),
    ]);
    return { puzzles: puzzles.rows, schedules: schedules.rows };
  }
  async insertAutomaticSchedule(input) {
    return (await this.pool.query(
      `INSERT INTO guess_baike_schedule(puzzle_date,puzzle_id,created_by_user_id,created_at,origin)
       SELECT $1,p.id,NULL,$3,'automatic' FROM guess_baike_puzzles p WHERE p.id=$2 AND p.status='ready'
       ON CONFLICT (puzzle_date) DO NOTHING RETURNING puzzle_date,puzzle_id`,
      [input.date,input.puzzleId,input.now],
    )).rows[0] ?? null;
  }
  async startAutomationRun(input) {
    await this.pool.query("INSERT INTO guess_baike_automation_runs(id,started_at,status) VALUES ($1,$2,'running')", [input.id,input.now]);
  }
  async finishAutomationRun(input) {
    await this.pool.query(
      `UPDATE guess_baike_automation_runs SET finished_at=$2,status=$3,fetched_count=$4,accepted_count=$5,scheduled_count=$6,error_code=$7,error_message=$8 WHERE id=$1`,
      [input.id,input.now,input.status,input.fetchedCount,input.acceptedCount,input.scheduledCount,input.errorCode ?? null,input.errorMessage ?? null],
    );
  }
  async automationStatus(fromDate, toDate) {
    const [run, counts] = await Promise.all([
      this.pool.query('SELECT * FROM guess_baike_automation_runs ORDER BY started_at DESC LIMIT 1'),
      this.pool.query(
        `SELECT count(*) FILTER (WHERE p.status='ready')::int AS ready_count,
                (SELECT count(*)::int FROM guess_baike_schedule WHERE puzzle_date BETWEEN $1 AND $2) AS scheduled_count
         FROM guess_baike_puzzles p`, [fromDate,toDate],
      ),
    ]);
    return { run: run.rows[0] ?? null, ...counts.rows[0] };
  }
}
