BEGIN;

CREATE TABLE tool_research_topics (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  current_contract_version integer NOT NULL DEFAULT 1 CHECK (current_contract_version > 0),
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_research_topics_user_updated_idx
  ON tool_research_topics(user_id,updated_at DESC,id DESC);
CREATE INDEX tool_research_topics_due_idx
  ON tool_research_topics(next_run_at,id)
  WHERE status='active' AND next_run_at IS NOT NULL;

CREATE TABLE tool_research_topic_contracts (
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  schema_version text NOT NULL DEFAULT 'research-contract-v1'
    CHECK (schema_version='research-contract-v1'),
  contract_json jsonb NOT NULL CHECK (jsonb_typeof(contract_json)='object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic_id,version)
);

CREATE TABLE tool_research_runs (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  contract_version integer NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('manual','scheduled','backfill')),
  status text NOT NULL CHECK (status IN ('queued','admitted','observing','discovering','reading','extracting','verifying','applying','completed','no_change','partial','budget_exhausted','blocked','uncertain','failed','cancelled')),
  engine_key text NOT NULL DEFAULT 'radar-native-v1' CHECK (char_length(engine_key) BETWEEN 1 AND 80),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_summary)='object'),
  stop_reason text CHECK (stop_reason IS NULL OR char_length(stop_reason) <= 500),
  window_start_at timestamptz NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  leased_by text CHECK (leased_by IS NULL OR char_length(leased_by) BETWEEN 1 AND 120),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(topic_id,contract_version)
    REFERENCES tool_research_topic_contracts(topic_id,version)
);

CREATE INDEX tool_research_runs_topic_created_idx
  ON tool_research_runs(topic_id,created_at DESC,id DESC);
CREATE INDEX tool_research_runs_queue_idx
  ON tool_research_runs(queued_at,id)
  WHERE status='queued' OR lease_until IS NOT NULL;
CREATE UNIQUE INDEX tool_research_runs_one_active_idx
  ON tool_research_runs(topic_id)
  WHERE status IN ('queued','admitted','observing','discovering','reading','extracting','verifying','applying');

ALTER TABLE tool_change_watches
  ADD COLUMN research_topic_id uuid REFERENCES tool_research_topics(id) ON DELETE SET NULL;

CREATE INDEX tool_change_watches_research_topic_idx
  ON tool_change_watches(research_topic_id,updated_at DESC,id DESC)
  WHERE research_topic_id IS NOT NULL;

COMMIT;
