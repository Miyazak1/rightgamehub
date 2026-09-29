BEGIN;

CREATE TABLE github_device_challenges (
  id uuid PRIMARY KEY,
  device_code text NOT NULL UNIQUE CHECK (char_length(device_code) BETWEEN 20 AND 512),
  user_code text NOT NULL CHECK (char_length(user_code) BETWEEN 4 AND 32),
  verification_uri text NOT NULL CHECK (verification_uri = 'https://github.com/login/device'),
  client_kind text NOT NULL CHECK (client_kind IN ('harness', 'vscode', 'cursor', 'browser')),
  device_label text NOT NULL CHECK (char_length(device_label) BETWEEN 1 AND 120),
  interval_seconds integer NOT NULL CHECK (interval_seconds BETWEEN 1 AND 60),
  expires_at timestamptz NOT NULL,
  last_polled_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX github_device_challenges_expiry_idx ON github_device_challenges(expires_at) WHERE consumed_at IS NULL;

COMMIT;
