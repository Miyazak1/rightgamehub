BEGIN;

CREATE TABLE user_library (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_key text NOT NULL CHECK (char_length(work_key) BETWEEN 1 AND 120),
  saved_at timestamptz,
  last_played_at timestamptz,
  play_count integer NOT NULL DEFAULT 0 CHECK (play_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_key),
  CHECK (saved_at IS NOT NULL OR last_played_at IS NOT NULL)
);

CREATE INDEX user_library_recent_idx ON user_library(user_id,last_played_at DESC NULLS LAST);
CREATE INDEX user_library_saved_idx ON user_library(user_id,saved_at DESC NULLS LAST) WHERE saved_at IS NOT NULL;

CREATE TABLE guess_baike_results (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_date date NOT NULL,
  puzzle_id text NOT NULL CHECK (char_length(puzzle_id) BETWEEN 1 AND 120),
  guessed_count integer NOT NULL CHECK (guessed_count BETWEEN 0 AND 500),
  elapsed_seconds integer NOT NULL CHECK (elapsed_seconds BETWEEN 0 AND 86400),
  hints integer NOT NULL CHECK (hints BETWEEN 0 AND 2),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,puzzle_date)
);

COMMIT;
