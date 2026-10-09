BEGIN;

CREATE TABLE game_share_links (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{12,24}$'),
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload_bytes integer NOT NULL CHECK (payload_bytes BETWEEN 2 AND 49152),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, work_id, payload_sha256)
);

CREATE INDEX game_share_links_work_created_idx ON game_share_links(work_id, created_at DESC);

COMMIT;
