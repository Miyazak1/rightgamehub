BEGIN;

-- Private question evidence and keys never appear in the public batch projection.
CREATE TABLE practice_questions (
  id text PRIMARY KEY CHECK (length(id) = 64),
  identity_key text NOT NULL UNIQUE CHECK (length(identity_key) = 64),
  topic_id text NOT NULL,
  difficulty_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX practice_questions_supply_idx ON practice_questions(topic_id, difficulty_id);

CREATE TABLE practice_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
  previous_id uuid UNIQUE REFERENCES practice_batches(id) ON DELETE RESTRICT,
  config jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','preparing','ready','completed','failed')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  current_index integer NOT NULL DEFAULT 0 CHECK (current_index >= 0),
  revision integer NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(user_id, request_key)
);
CREATE INDEX practice_batches_owner_idx ON practice_batches(user_id, created_at DESC);
CREATE INDEX practice_batches_jobs_idx ON practice_batches(status, lease_until, created_at)
  WHERE status IN ('queued','preparing');

-- Reserve at presentation, not submission: abandoning a round must not repeat it.
CREATE TABLE practice_exposures (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  identity_key text NOT NULL REFERENCES practice_questions(identity_key) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES practice_batches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, identity_key)
);
COMMIT;
