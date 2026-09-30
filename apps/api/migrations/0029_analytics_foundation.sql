BEGIN;

CREATE TABLE analytics_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  anonymous_id uuid NOT NULL,
  session_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'page_view','session_ping','work_view','download_start','download_complete','game_start','game_end'
  )),
  route text CHECK (route IS NULL OR char_length(route) BETWEEN 1 AND 80),
  work_key text CHECK (work_key IS NULL OR char_length(work_key) BETWEEN 1 AND 120),
  release_id uuid,
  host_kind text NOT NULL CHECK (host_kind IN (
    'browser','cursor','vscode','code','harness','codex','claude','opencode','unknown'
  )),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 600000),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_occurred_idx ON analytics_events(occurred_at DESC);
CREATE INDEX analytics_events_type_occurred_idx ON analytics_events(event_type, occurred_at DESC);
CREATE INDEX analytics_events_anonymous_occurred_idx ON analytics_events(anonymous_id, occurred_at DESC);
CREATE INDEX analytics_events_user_occurred_idx ON analytics_events(user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX analytics_events_work_occurred_idx ON analytics_events(work_key, occurred_at DESC) WHERE work_key IS NOT NULL;

COMMIT;
