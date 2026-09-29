BEGIN;

ALTER TABLE device_grants ADD COLUMN last_seen_at timestamptz;
UPDATE device_grants SET last_seen_at=authenticated_at WHERE last_seen_at IS NULL;
ALTER TABLE device_grants ALTER COLUMN last_seen_at SET NOT NULL;
ALTER TABLE device_grants ALTER COLUMN last_seen_at SET DEFAULT now();

CREATE INDEX device_grants_user_last_seen_idx ON device_grants(user_id,last_seen_at DESC)
  WHERE revoked_at IS NULL;

COMMIT;
