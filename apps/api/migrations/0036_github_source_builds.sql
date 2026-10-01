BEGIN;

CREATE TABLE source_revisions (
  id uuid PRIMARY KEY,
  work_source_id uuid NOT NULL REFERENCES work_sources(id) ON DELETE RESTRICT,
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
  tree_sha text NOT NULL CHECK (tree_sha ~ '^[a-f0-9]{40}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_source_id, commit_sha)
);

CREATE TABLE build_jobs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  source_revision_id uuid NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
  template_key text NOT NULL CHECK (template_key IN ('static-v1')),
  template_version text NOT NULL CHECK (char_length(template_version) BETWEEN 1 AND 32),
  build_config jsonb NOT NULL,
  config_sha256 text NOT NULL CHECK (config_sha256 ~ '^[a-f0-9]{64}$'),
  builder_image_digest text NOT NULL CHECK (char_length(builder_image_digest) BETWEEN 8 AND 160),
  release_label text NOT NULL CHECK (char_length(release_label) BETWEEN 1 AND 64),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','preparing','building','packaging','validating','ready','failed','superseded')),
  error_code text,
  log_excerpt text NOT NULL DEFAULT '' CHECK (octet_length(log_excerpt) <= 65536),
  artifact_sha256 text CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_bytes bigint CHECK (artifact_bytes IS NULL OR artifact_bytes BETWEEN 1 AND 104857600),
  upload_job_id uuid UNIQUE REFERENCES upload_jobs(id) ON DELETE RESTRICT,
  release_id uuid UNIQUE REFERENCES releases(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_revision_id, config_sha256)
);

CREATE INDEX build_jobs_owner_created_idx ON build_jobs(owner_user_id, created_at DESC);
CREATE INDEX build_jobs_state_created_idx ON build_jobs(state, created_at) WHERE state IN ('queued','preparing','building','packaging','validating');

CREATE TABLE release_provenance (
  release_id uuid PRIMARY KEY REFERENCES releases(id) ON DELETE RESTRICT,
  source_revision_id uuid NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
  build_job_id uuid NOT NULL UNIQUE REFERENCES build_jobs(id) ON DELETE RESTRICT,
  config_sha256 text NOT NULL CHECK (config_sha256 ~ '^[a-f0-9]{64}$'),
  dependency_lock_sha256 text CHECK (dependency_lock_sha256 IS NULL OR dependency_lock_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  builder_image_digest text NOT NULL CHECK (char_length(builder_image_digest) BETWEEN 8 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('validate','scan','media','gc','source_build'));

COMMIT;
