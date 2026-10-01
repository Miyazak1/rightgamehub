BEGIN;

CREATE TABLE multiplayer_rule_submissions (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  mode_key text NOT NULL CHECK (mode_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  mode_name text NOT NULL CHECK (char_length(mode_name) BETWEEN 1 AND 80),
  ruleset_version text NOT NULL CHECK (ruleset_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  min_players integer NOT NULL CHECK (min_players BETWEEN 2 AND 8),
  max_players integer NOT NULL CHECK (max_players BETWEEN 2 AND 8 AND max_players >= min_players),
  mode_config jsonb NOT NULL DEFAULT '{}',
  creator_submission jsonb NOT NULL,
  doctor_report jsonb NOT NULL,
  source_file_name text NOT NULL CHECK (char_length(source_file_name) BETWEEN 1 AND 255),
  declared_bytes bigint NOT NULL CHECK (declared_bytes BETWEEN 1 AND 20971520),
  declared_sha256 text NOT NULL CHECK (declared_sha256 ~ '^[a-f0-9]{64}$'),
  actual_bytes bigint CHECK (actual_bytes IS NULL OR actual_bytes BETWEEN 1 AND 20971520),
  actual_sha256 text CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'created' CHECK (state IN ('created','receiving','uploaded','submitted','in_review','changes_requested','approved_for_build','rejected','expired','failed')),
  error_code text,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 2000),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX multiplayer_rule_submissions_active_identity_idx
  ON multiplayer_rule_submissions(work_id, mode_key, ruleset_version)
  WHERE state IN ('created','receiving','uploaded','submitted','in_review','approved_for_build');
CREATE INDEX multiplayer_rule_submissions_owner_idx
  ON multiplayer_rule_submissions(owner_user_id, created_at DESC);
CREATE INDEX multiplayer_rule_submissions_review_queue_idx
  ON multiplayer_rule_submissions(state, submitted_at, id)
  WHERE state IN ('submitted','in_review');

CREATE TABLE multiplayer_rule_submission_grants (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES multiplayer_rule_submissions(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX multiplayer_rule_submission_grants_submission_idx
  ON multiplayer_rule_submission_grants(submission_id);

CREATE TABLE multiplayer_rule_submission_events (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES multiplayer_rule_submissions(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created','uploaded','submitted','review_started','changes_requested','approved_for_build','rejected','upload_failed','expired')),
  from_state text,
  to_state text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX multiplayer_rule_submission_events_submission_idx
  ON multiplayer_rule_submission_events(submission_id, created_at, id);

CREATE FUNCTION reject_multiplayer_rule_submission_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'multiplayer rule submission events are append-only';
END;
$$;

CREATE TRIGGER multiplayer_rule_submission_events_no_update
  BEFORE UPDATE ON multiplayer_rule_submission_events
  FOR EACH ROW EXECUTE FUNCTION reject_multiplayer_rule_submission_event_mutation();
CREATE TRIGGER multiplayer_rule_submission_events_no_delete
  BEFORE DELETE ON multiplayer_rule_submission_events
  FOR EACH ROW EXECUTE FUNCTION reject_multiplayer_rule_submission_event_mutation();

COMMIT;
