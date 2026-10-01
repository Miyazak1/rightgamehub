BEGIN;

CREATE TABLE multiplayer_rule_builds (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL UNIQUE REFERENCES multiplayer_rule_submissions(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  mode_key text NOT NULL CHECK (mode_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  ruleset_version text NOT NULL CHECK (ruleset_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_object_key text NOT NULL,
  builder_image_digest text NOT NULL CHECK (char_length(builder_image_digest) BETWEEN 8 AND 160),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','preparing','building','ready','failed')),
  artifact_object_key text UNIQUE,
  artifact_sha256 text CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_bytes bigint CHECK (artifact_bytes IS NULL OR artifact_bytes BETWEEN 1 AND 1048576),
  build_report jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, mode_key, ruleset_version)
);

CREATE INDEX multiplayer_rule_builds_state_created_idx
  ON multiplayer_rule_builds(state, created_at)
  WHERE state IN ('queued','preparing','building');
CREATE INDEX multiplayer_rule_builds_owner_created_idx
  ON multiplayer_rule_builds(owner_user_id, created_at DESC);

CREATE TABLE multiplayer_rule_build_events (
  id uuid PRIMARY KEY,
  build_id uuid NOT NULL REFERENCES multiplayer_rule_builds(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('queued','claimed','build_succeeded','build_failed')),
  from_state text,
  to_state text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX multiplayer_rule_build_events_build_idx
  ON multiplayer_rule_build_events(build_id, created_at, id);

CREATE FUNCTION reject_multiplayer_rule_build_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'multiplayer rule build events are append-only';
END;
$$;

CREATE TRIGGER multiplayer_rule_build_events_no_update
  BEFORE UPDATE ON multiplayer_rule_build_events
  FOR EACH ROW EXECUTE FUNCTION reject_multiplayer_rule_build_event_mutation();
CREATE TRIGGER multiplayer_rule_build_events_no_delete
  BEFORE DELETE ON multiplayer_rule_build_events
  FOR EACH ROW EXECUTE FUNCTION reject_multiplayer_rule_build_event_mutation();

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check
  CHECK (kind IN ('validate','scan','media','gc','source_build','multiplayer_rule_build'));

COMMIT;
