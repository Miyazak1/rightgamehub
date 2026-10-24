BEGIN;

ALTER TABLE agent_run_stages
  ADD COLUMN attempt_started_at timestamptz;

UPDATE agent_run_stages
SET attempt_started_at=COALESCE(updated_at,started_at,created_at)
WHERE status IN ('leased','running');

ALTER TABLE agent_run_stages
  ADD CONSTRAINT agent_run_stages_attempt_clock CHECK (
    (status IN ('leased','running') AND attempt_started_at IS NOT NULL)
    OR (status NOT IN ('leased','running') AND attempt_started_at IS NULL)
  );

ALTER TABLE agent_runtime_outbox
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 25 CHECK (max_attempts BETWEEN 1 AND 100),
  ADD COLUMN last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code)<=120),
  ADD COLUMN last_error_message text CHECK (last_error_message IS NULL OR char_length(last_error_message)<=500);

CREATE TABLE agent_runtime_workers (
  worker_id text PRIMARY KEY CHECK (char_length(worker_id) BETWEEN 1 AND 120),
  instance_id uuid NOT NULL,
  runtime_version text NOT NULL CHECK (runtime_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$'),
  status text NOT NULL CHECK (status IN ('idle','busy','stopping','offline')),
  current_stage_id uuid REFERENCES agent_run_stages(id) ON DELETE RESTRICT,
  capabilities_json jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(capabilities_json)='array' AND octet_length(capabilities_json::text)<=16384),
  metadata_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata_json)='object' AND octet_length(metadata_json::text)<=16384),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='busy' AND current_stage_id IS NOT NULL) OR status<>'busy'),
  CHECK ((status='offline' AND stopped_at IS NOT NULL AND current_stage_id IS NULL)
    OR (status<>'offline' AND stopped_at IS NULL))
);

CREATE INDEX agent_runtime_workers_liveness ON agent_runtime_workers(status,last_seen_at,worker_id);

CREATE FUNCTION guard_agent_runtime_worker_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='agent_runtime_outbox' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent runtime outbox cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.aggregate_type<>OLD.aggregate_type OR NEW.aggregate_id<>OLD.aggregate_id
      OR NEW.event_type<>OLD.event_type OR NEW.dedupe_key<>OLD.dedupe_key
      OR NEW.payload_json<>OLD.payload_json OR NEW.max_attempts<>OLD.max_attempts
      OR NEW.created_at<>OLD.created_at OR OLD.status IN ('delivered','failed') THEN
      RAISE EXCEPTION 'Agent runtime outbox identity or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='pending' AND NEW.status IN ('dispatching','failed'))
      OR (OLD.status='dispatching' AND NEW.status IN ('pending','delivered','failed'))
    ) THEN RAISE EXCEPTION 'Invalid Agent runtime outbox state transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_runtime_workers' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent runtime worker history cannot be deleted'; END IF;
    IF NEW.worker_id<>OLD.worker_id OR NEW.created_at<>OLD.created_at THEN
      RAISE EXCEPTION 'Agent runtime worker identity cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runtime_outbox_guard BEFORE UPDATE OR DELETE ON agent_runtime_outbox
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_worker_recovery();
CREATE TRIGGER agent_runtime_workers_guard BEFORE UPDATE OR DELETE ON agent_runtime_workers
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_worker_recovery();

COMMIT;
