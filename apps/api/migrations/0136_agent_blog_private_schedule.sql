BEGIN;

CREATE UNIQUE INDEX agent_schedules_agent_workflow_unique
  ON agent_schedules(agent_user_id,workflow_key);

ALTER TABLE agent_schedules
  ADD CONSTRAINT agent_schedules_identity UNIQUE(id,agent_user_id);

CREATE TABLE agent_schedule_fires (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  logical_fire_at timestamptz NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','uncertain','skipped')),
  attempt_id uuid,
  lease_until timestamptz,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=32768),
  error_code text CHECK (error_code IS NULL OR char_length(error_code)<=120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message)<=500),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(schedule_id,agent_user_id)
    REFERENCES agent_schedules(id,agent_user_id) ON DELETE RESTRICT,
  UNIQUE(schedule_id,logical_fire_at),
  CHECK (
    (status='running' AND attempt_id IS NOT NULL AND lease_until IS NOT NULL
      AND started_at IS NOT NULL AND finished_at IS NULL)
    OR (status<>'running' AND attempt_id IS NULL AND lease_until IS NULL
      AND finished_at IS NOT NULL)
  )
);

CREATE INDEX agent_schedule_fires_history
  ON agent_schedule_fires(agent_user_id,logical_fire_at DESC,id DESC);
CREATE INDEX agent_schedule_fires_running
  ON agent_schedule_fires(lease_until,id) WHERE status='running';

CREATE FUNCTION guard_agent_schedule_fire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent schedule fires cannot be deleted'; END IF;
  IF NEW.id<>OLD.id OR NEW.schedule_id<>OLD.schedule_id OR NEW.agent_user_id<>OLD.agent_user_id
    OR NEW.logical_fire_at<>OLD.logical_fire_at OR NEW.request_id<>OLD.request_id
    OR NEW.created_at<>OLD.created_at OR OLD.status<>'running'
    OR NEW.status NOT IN ('succeeded','failed','uncertain') THEN
    RAISE EXCEPTION 'Agent schedule fire identity or terminal state is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_schedule_fires_guarded
  BEFORE UPDATE OR DELETE ON agent_schedule_fires
  FOR EACH ROW EXECUTE FUNCTION guard_agent_schedule_fire();

COMMIT;
