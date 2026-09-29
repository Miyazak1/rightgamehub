BEGIN;

CREATE TABLE upload_jobs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL,
  target_key text NOT NULL,
  package_type text NOT NULL CHECK (package_type IN ('web_zip', 'windows_portable_zip', 'windows_standalone_exe', 'windows_installer_exe')),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  state text NOT NULL DEFAULT 'created' CHECK (state IN ('created', 'receiving', 'uploaded', 'queued', 'validating', 'scanning', 'succeeded', 'failed', 'expired', 'review_required')),
  declared_bytes bigint NOT NULL CHECK (declared_bytes >= 0),
  declared_sha256 text NOT NULL CHECK (declared_sha256 ~ '^[a-f0-9]{64}$'),
  actual_bytes bigint CHECK (actual_bytes IS NULL OR actual_bytes >= 0),
  actual_sha256 text CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE,
  auto_publish boolean NOT NULL DEFAULT false,
  publish_generation bigint CHECK (publish_generation IS NULL OR publish_generation >= 0),
  publication_outcome text NOT NULL DEFAULT 'pending' CHECK (publication_outcome IN ('pending', 'published', 'draft', 'skipped_newer_intent', 'blocked')),
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes >= 0),
  expires_at timestamptz NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (work_id, target_key) REFERENCES work_targets(work_id, target_key) ON DELETE RESTRICT
);

CREATE INDEX upload_jobs_owner_state_idx ON upload_jobs(owner_user_id, state);
CREATE INDEX upload_jobs_expiry_idx ON upload_jobs(expires_at) WHERE state IN ('created', 'receiving');

CREATE TABLE upload_grants (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  upload_id uuid NOT NULL REFERENCES upload_jobs(id) ON DELETE RESTRICT,
  declared_bytes bigint NOT NULL CHECK (declared_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX upload_grants_upload_idx ON upload_grants(upload_id);

ALTER TABLE releases ADD COLUMN upload_job_id uuid;
ALTER TABLE releases ADD CONSTRAINT releases_upload_job_unique UNIQUE (upload_job_id);
ALTER TABLE releases ADD CONSTRAINT releases_upload_job_fk FOREIGN KEY (upload_job_id) REFERENCES upload_jobs(id) ON DELETE RESTRICT;

COMMIT;
