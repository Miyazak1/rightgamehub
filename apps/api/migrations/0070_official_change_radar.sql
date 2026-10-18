BEGIN;

CREATE TABLE tool_change_watches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  url text NOT NULL CHECK (char_length(url) BETWEEN 8 AND 2048),
  normalized_url text NOT NULL CHECK (char_length(normalized_url) BETWEEN 8 AND 2048),
  condition_text text NOT NULL DEFAULT '' CHECK (char_length(condition_text) <= 500),
  interval_minutes integer NOT NULL CHECK (interval_minutes BETWEEN 15 AND 10080),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','error')),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_status_code integer,
  last_error_code text,
  last_error_message text CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_change_watches_user_updated_idx
  ON tool_change_watches(user_id,updated_at DESC,id DESC);
CREATE INDEX tool_change_watches_due_idx
  ON tool_change_watches(next_check_at,id) WHERE status='active';

CREATE TABLE tool_change_snapshots (
  id uuid PRIMARY KEY,
  watch_id uuid NOT NULL REFERENCES tool_change_watches(id) ON DELETE CASCADE,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  final_url text NOT NULL CHECK (char_length(final_url) BETWEEN 8 AND 2048),
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  content_type text NOT NULL CHECK (char_length(content_type) <= 120),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  body_text text NOT NULL CHECK (octet_length(body_text) <= 524288),
  change_kind text NOT NULL CHECK (change_kind IN ('initial','changed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_change_snapshots_watch_fetched_idx
  ON tool_change_snapshots(watch_id,fetched_at DESC,id DESC);

COMMIT;
