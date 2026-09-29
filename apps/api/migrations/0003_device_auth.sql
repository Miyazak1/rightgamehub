BEGIN;

CREATE TABLE email_challenges (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL CHECK (char_length(email_normalized) BETWEEN 3 AND 320),
  client_kind text NOT NULL CHECK (client_kind IN ('harness', 'vscode', 'cursor', 'browser')),
  code_hmac bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  resend_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_challenges_email_created_idx ON email_challenges(email_normalized, created_at DESC);
CREATE INDEX email_challenges_expiry_idx ON email_challenges(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE device_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  device_label text NOT NULL CHECK (char_length(device_label) BETWEEN 1 AND 120),
  client_kind text NOT NULL CHECK (client_kind IN ('harness', 'vscode', 'cursor', 'browser')),
  scopes text[] NOT NULL DEFAULT '{}',
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_grants_user_active_idx ON device_grants(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE access_tokens (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  grant_id uuid NOT NULL REFERENCES device_grants(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_tokens_grant_idx ON access_tokens(grant_id);
CREATE INDEX access_tokens_expiry_idx ON access_tokens(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  grant_id uuid NOT NULL REFERENCES device_grants(id) ON DELETE RESTRICT,
  family_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 0),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, generation)
);

CREATE INDEX refresh_tokens_grant_idx ON refresh_tokens(grant_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

COMMIT;
