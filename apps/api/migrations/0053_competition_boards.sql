BEGIN;
CREATE TABLE competition_boards (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id),
  board_key text NOT NULL,
  ruleset_version integer NOT NULL CHECK(ruleset_version>0),
  definition jsonb NOT NULL,
  definition_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(work_id,board_key,ruleset_version), UNIQUE(work_id,id)
);
CREATE TABLE competition_release_boards (
  work_id uuid NOT NULL,
  release_id uuid NOT NULL,
  board_id uuid NOT NULL,
  PRIMARY KEY(release_id,board_id),
  FOREIGN KEY(work_id,release_id) REFERENCES releases(work_id,id),
  FOREIGN KEY(work_id,board_id) REFERENCES competition_boards(work_id,id)
);
CREATE TABLE competition_runs (
  id uuid PRIMARY KEY,
  board_id uuid NOT NULL REFERENCES competition_boards(id),
  user_id uuid NOT NULL REFERENCES users(id),
  release_id uuid NOT NULL REFERENCES releases(id),
  channel text NOT NULL CHECK(channel IN ('production','preview')),
  request_id uuid NOT NULL,
  period_key text NOT NULL,
  seed bigint NOT NULL CHECK(seed BETWEEN 0 AND 4294967295),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','accepted','abandoned','invalidated')),
  submitted_at timestamptz,
  submission_hash text,
  metrics jsonb,
  sort_key bigint[],
  evidence jsonb,
  UNIQUE(user_id,release_id,request_id),
  CHECK(expires_at>issued_at),
  CHECK((status IN ('accepted','invalidated'))=(metrics IS NOT NULL AND sort_key IS NOT NULL AND submitted_at IS NOT NULL AND submission_hash IS NOT NULL))
);
CREATE INDEX competition_runs_user_issued_idx ON competition_runs(user_id,issued_at DESC);
CREATE INDEX competition_runs_cleanup_idx ON competition_runs(expires_at) WHERE status IN ('issued','abandoned');
CREATE INDEX competition_runs_evidence_idx ON competition_runs(submitted_at) WHERE evidence IS NOT NULL;
CREATE INDEX competition_runs_board_user_idx ON competition_runs(board_id,period_key,user_id,sort_key,submitted_at,id) WHERE status='accepted' AND channel='production';
CREATE TABLE competition_entries (
  board_id uuid NOT NULL REFERENCES competition_boards(id),
  period_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  run_id uuid NOT NULL UNIQUE REFERENCES competition_runs(id),
  metrics jsonb NOT NULL,
  sort_key bigint[] NOT NULL,
  achieved_at timestamptz NOT NULL,
  PRIMARY KEY(board_id,period_key,user_id)
);
CREATE INDEX competition_entries_rank_idx ON competition_entries(board_id,period_key,sort_key,achieved_at,run_id);
CREATE TABLE competition_moderation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  run_id uuid NOT NULL REFERENCES competition_runs(id),
  action text NOT NULL CHECK(action IN ('invalidate','restore')),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION competition_protect_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'competition definition is immutable; increment rulesetVersion'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER competition_definition_immutable BEFORE UPDATE ON competition_boards FOR EACH ROW EXECUTE FUNCTION competition_protect_definition();
CREATE FUNCTION competition_protect_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status IN ('accepted','invalidated') THEN RAISE EXCEPTION 'accepted competition metrics must be retained'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('accepted','invalidated') AND (
    (to_jsonb(NEW)-'status'-'evidence') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'evidence')
    OR NEW.status NOT IN ('accepted','invalidated')
    OR (NEW.evidence IS NOT NULL AND NEW.evidence IS DISTINCT FROM OLD.evidence)
  ) THEN RAISE EXCEPTION 'accepted competition metrics are immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER competition_result_immutable BEFORE UPDATE OR DELETE ON competition_runs FOR EACH ROW EXECUTE FUNCTION competition_protect_result();
CREATE FUNCTION competition_protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'competition moderation audit is append only'; END; $$;
CREATE TRIGGER competition_audit_immutable BEFORE UPDATE OR DELETE ON competition_moderation_events FOR EACH ROW EXECUTE FUNCTION competition_protect_audit();
COMMIT;
