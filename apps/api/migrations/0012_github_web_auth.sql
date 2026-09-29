BEGIN;

CREATE TABLE github_web_challenges (
  id uuid PRIMARY KEY,
  state_hash bytea NOT NULL UNIQUE,
  client_kind text NOT NULL CHECK (client_kind IN ('harness', 'vscode', 'cursor', 'browser')),
  device_label text NOT NULL CHECK (char_length(device_label) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed', 'consumed')),
  token_payload text,
  error_code text,
  expires_at timestamptz NOT NULL,
  last_polled_at timestamptz,
  callback_started_at timestamptz,
  completed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'complete' AND token_payload IS NOT NULL) OR (status <> 'complete' AND token_payload IS NULL))
);

CREATE INDEX github_web_challenges_expiry_idx ON github_web_challenges(expires_at) WHERE consumed_at IS NULL;

COMMIT;
