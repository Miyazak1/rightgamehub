BEGIN;

CREATE TABLE github_source_install_states (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_source_install_states_expiry_idx
  ON github_source_install_states(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE github_source_connections (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  installation_id bigint NOT NULL UNIQUE CHECK (installation_id > 0),
  account_id bigint NOT NULL CHECK (account_id > 0),
  account_login text NOT NULL CHECK (char_length(account_login) BETWEEN 1 AND 255),
  account_type text NOT NULL CHECK (account_type IN ('User','Organization')),
  repository_selection text NOT NULL CHECK (repository_selection IN ('all','selected')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id)
);

CREATE INDEX github_source_connections_user_idx ON github_source_connections(user_id, updated_at DESC);

CREATE TABLE github_source_repositories (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES github_source_connections(id) ON DELETE RESTRICT,
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  node_id text NOT NULL CHECK (char_length(node_id) BETWEEN 1 AND 255),
  owner_login text NOT NULL CHECK (char_length(owner_login) BETWEEN 1 AND 255),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  default_branch text NOT NULL CHECK (char_length(default_branch) BETWEEN 1 AND 255),
  visibility text NOT NULL CHECK (visibility IN ('public','private','internal')),
  html_url text NOT NULL CHECK (html_url ~ '^https://github\.com/'),
  access_state text NOT NULL DEFAULT 'active' CHECK (access_state IN ('active','removed','connection_suspended','connection_revoked')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, repository_id),
  UNIQUE (connection_id, node_id)
);

CREATE INDEX github_source_repositories_connection_idx
  ON github_source_repositories(connection_id, access_state, owner_login, name);

CREATE TABLE github_source_imports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL REFERENCES github_source_connections(id) ON DELETE RESTRICT,
  source_repository_id uuid NOT NULL REFERENCES github_source_repositories(id) ON DELETE RESTRICT,
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
  tree_sha text NOT NULL CHECK (tree_sha ~ '^[a-f0-9]{40}$'),
  status text NOT NULL CHECK (status IN ('previewed','succeeded','failed')),
  repository_snapshot jsonb NOT NULL,
  readme_excerpt text NOT NULL DEFAULT '' CHECK (octet_length(readme_excerpt) <= 32768),
  readme_sha256 text CHECK (readme_sha256 IS NULL OR readme_sha256 ~ '^[a-f0-9]{64}$'),
  license_status text NOT NULL CHECK (license_status IN ('recognized','missing','unknown','conflict')),
  license_spdx text CHECK (license_spdx IS NULL OR char_length(license_spdx) BETWEEN 1 AND 80),
  license_path text CHECK (license_path IS NULL OR char_length(license_path) BETWEEN 1 AND 512),
  license_sha256 text CHECK (license_sha256 IS NULL OR license_sha256 ~ '^[a-f0-9]{64}$'),
  static_signals jsonb NOT NULL DEFAULT '{}',
  work_id uuid REFERENCES works(id) ON DELETE RESTRICT,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_repository_id, commit_sha)
);

CREATE INDEX github_source_imports_user_idx ON github_source_imports(user_id, updated_at DESC);

CREATE TABLE work_sources (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL UNIQUE REFERENCES works(id) ON DELETE RESTRICT,
  source_import_id uuid NOT NULL UNIQUE REFERENCES github_source_imports(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'github' CHECK (provider='github'),
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  repository_node_id text NOT NULL,
  repository_visibility text NOT NULL CHECK (repository_visibility IN ('public','private','internal')),
  owner_login text NOT NULL,
  repository_name text NOT NULL,
  repository_url text NOT NULL CHECK (repository_url ~ '^https://github\.com/'),
  default_branch text NOT NULL,
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
  tree_sha text NOT NULL CHECK (tree_sha ~ '^[a-f0-9]{40}$'),
  source_status text NOT NULL DEFAULT 'active' CHECK (source_status IN ('active','access_lost','suspended','revoked')),
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_sources_repository_idx ON work_sources(repository_id, commit_sha);

CREATE TABLE github_webhook_deliveries (
  delivery_id text PRIMARY KEY CHECK (char_length(delivery_id) BETWEEN 1 AND 128),
  event text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 80),
  installation_id bigint,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('received','processed','ignored','failed')),
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX github_webhook_deliveries_created_idx ON github_webhook_deliveries(created_at DESC);

CREATE TABLE github_source_audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  connection_id uuid REFERENCES github_source_connections(id) ON DELETE RESTRICT,
  source_repository_id uuid REFERENCES github_source_repositories(id) ON DELETE RESTRICT,
  source_import_id uuid REFERENCES github_source_imports(id) ON DELETE RESTRICT,
  work_id uuid REFERENCES works(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_source_audit_created_idx ON github_source_audit_events(created_at DESC);

CREATE FUNCTION reject_github_source_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'github source audit events are append-only';
END;
$$;

CREATE TRIGGER github_source_audit_no_update BEFORE UPDATE ON github_source_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_github_source_audit_mutation();
CREATE TRIGGER github_source_audit_no_delete BEFORE DELETE ON github_source_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_github_source_audit_mutation();

COMMIT;
