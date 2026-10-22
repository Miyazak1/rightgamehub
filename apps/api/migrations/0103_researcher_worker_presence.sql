BEGIN;

CREATE TABLE tool_researcher_worker_presence (
  worker_id text PRIMARY KEY CHECK (char_length(worker_id) BETWEEN 1 AND 120),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  provider_model text NOT NULL CHECK (char_length(provider_model) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'polling' CHECK (state IN ('polling','leased')),
  last_job_id uuid REFERENCES tool_researcher_jobs(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_researcher_worker_presence_runtime_idx
  ON tool_researcher_worker_presence(provider,provider_model,last_seen_at DESC);

COMMIT;
