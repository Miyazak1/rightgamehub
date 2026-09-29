BEGIN;

CREATE TABLE guess_baike_puzzles (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases)='array'),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
  source_kind text NOT NULL,
  source_title text NOT NULL,
  source_url text NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  source_updated_at timestamptz NOT NULL,
  license text NOT NULL,
  intro_han_count integer NOT NULL CHECK (intro_han_count > 0),
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready','disabled')),
  quality_reason text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guess_baike_puzzles_status_idx ON guess_baike_puzzles(status,updated_at DESC);

CREATE TABLE guess_baike_schedule (
  puzzle_date date PRIMARY KEY,
  puzzle_id text NOT NULL REFERENCES guess_baike_puzzles(id) ON DELETE RESTRICT,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guess_baike_schedule_puzzle_idx ON guess_baike_schedule(puzzle_id,puzzle_date DESC);

COMMIT;
