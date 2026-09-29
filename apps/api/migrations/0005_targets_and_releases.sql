BEGIN;

CREATE TABLE work_targets (
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  target_key text NOT NULL CHECK (target_key IN ('web', 'windows-x64', 'windows-x86', 'windows-arm64')),
  current_release_id uuid,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  publish_generation bigint NOT NULL DEFAULT 0 CHECK (publish_generation >= 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'withdrawn', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_id, target_key)
);

CREATE TABLE releases (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL,
  target_key text NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 64),
  package_type text NOT NULL CHECK (package_type IN ('web_zip', 'windows_portable_zip', 'windows_standalone_exe', 'windows_installer_exe')),
  os text,
  arch text,
  entry_path text,
  requirements jsonb NOT NULL DEFAULT '{}',
  validation_state text NOT NULL DEFAULT 'processing' CHECK (validation_state IN ('processing', 'scanning', 'ready', 'failed', 'review_required')),
  serving_state text NOT NULL DEFAULT 'disabled' CHECK (serving_state IN ('disabled', 'enabled', 'revoked')),
  manifest jsonb NOT NULL DEFAULT '{}',
  approved_capabilities jsonb NOT NULL DEFAULT '{}',
  artifact_sha256 text CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'),
  asset_prefix text,
  asset_manifest_sha256 text CHECK (asset_manifest_sha256 IS NULL OR asset_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  asset_count integer CHECK (asset_count IS NULL OR asset_count >= 0),
  expanded_bytes bigint CHECK (expanded_bytes IS NULL OR expanded_bytes >= 0),
  retire_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (work_id, target_key) REFERENCES work_targets(work_id, target_key) ON DELETE RESTRICT,
  UNIQUE (work_id, target_key, id)
);

CREATE INDEX releases_target_created_idx ON releases(work_id, target_key, created_at DESC);

COMMIT;
