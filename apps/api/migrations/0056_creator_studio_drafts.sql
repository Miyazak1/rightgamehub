BEGIN;

CREATE TABLE creator_drafts (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  studio_key text NOT NULL CHECK (studio_key IN ('bingo','puzzle','story','world')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version BETWEEN 1 AND 1000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','published')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1048576),
  work_id uuid UNIQUE REFERENCES works(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creator_drafts_owner_updated_idx ON creator_drafts(owner_user_id, updated_at DESC, id);
CREATE INDEX creator_drafts_owner_studio_idx ON creator_drafts(owner_user_id, studio_key, updated_at DESC) WHERE status = 'active';

CREATE TABLE creator_draft_revisions (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES creator_drafts(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision >= 1),
  schema_version integer NOT NULL CHECK (schema_version BETWEEN 1 AND 1000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, revision)
);

CREATE INDEX creator_draft_revisions_draft_idx ON creator_draft_revisions(draft_id, revision DESC);

CREATE TABLE creator_generation_jobs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  draft_id uuid NOT NULL REFERENCES creator_drafts(id) ON DELETE RESTRICT,
  base_revision bigint NOT NULL CHECK (base_revision >= 1),
  operation text NOT NULL CHECK (operation IN ('create','rewrite','expand','repair')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object' AND octet_length(input::text) <= 262144),
  output jsonb CHECK (output IS NULL OR (jsonb_typeof(output) = 'object' AND octet_length(output::text) <= 1048576)),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creator_generation_jobs_owner_created_idx ON creator_generation_jobs(owner_user_id, created_at DESC);
CREATE INDEX creator_generation_jobs_queue_idx ON creator_generation_jobs(state, created_at) WHERE state IN ('queued','running');

COMMIT;
