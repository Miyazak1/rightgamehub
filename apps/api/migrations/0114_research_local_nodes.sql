BEGIN;

CREATE TABLE tool_research_local_nodes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  provider_model text NOT NULL CHECK (char_length(provider_model) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id)
);

CREATE INDEX tool_research_local_nodes_user_idx
  ON tool_research_local_nodes(user_id,status,created_at DESC,id DESC);

ALTER TABLE tool_researcher_jobs
  ADD COLUMN executor_kind text NOT NULL DEFAULT 'local-node'
    CHECK (executor_kind IN ('local-node','server')),
  ADD COLUMN local_node_id uuid REFERENCES tool_research_local_nodes(id) ON DELETE SET NULL;

CREATE INDEX tool_researcher_jobs_local_queue_idx
  ON tool_researcher_jobs(topic_id,queued_at,id)
  WHERE status='queued' AND executor_kind='local-node';

COMMIT;
