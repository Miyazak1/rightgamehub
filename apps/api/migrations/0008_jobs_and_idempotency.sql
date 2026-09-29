BEGIN;

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('validate', 'scan', 'media', 'gc')),
  target_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'succeeded', 'failed', 'cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, target_id)
);

CREATE INDEX jobs_ready_idx ON jobs(state, available_at) WHERE state = 'queued';
CREATE INDEX jobs_lease_idx ON jobs(lease_until) WHERE state = 'leased';

CREATE TABLE idempotency_keys (
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 120),
  key text NOT NULL CHECK (char_length(key) BETWEEN 16 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_status integer NOT NULL CHECK (result_status BETWEEN 100 AND 599),
  result_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation, key)
);

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys(expires_at);

COMMIT;
