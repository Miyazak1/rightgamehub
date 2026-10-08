BEGIN;
CREATE INDEX guess_baike_results_daily_board_idx
  ON guess_baike_results(puzzle_date,puzzle_id,hints,guessed_count,elapsed_seconds,completed_at,user_id);
COMMIT;
