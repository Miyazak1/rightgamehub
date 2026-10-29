BEGIN;

-- R1.9 records every operator recovery command as an immutable control-plane
-- fact. The runtime stage/event tables remain the execution source of truth.
CREATE TABLE agent_runtime_operator_actions (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  stage_id uuid REFERENCES agent_run_stages(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('expired-stage.recover')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  precondition_json jsonb NOT NULL CHECK (
    jsonb_typeof(precondition_json)='object' AND octet_length(precondition_json::text)<=16384
  ),
  result_json jsonb NOT NULL CHECK (
    jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=16384
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,request_id)
);

CREATE INDEX agent_runtime_operator_actions_agent_created
  ON agent_runtime_operator_actions(agent_user_id,created_at DESC,id DESC);
CREATE INDEX agent_runtime_operator_actions_run_created
  ON agent_runtime_operator_actions(run_id,created_at DESC,id DESC);

CREATE FUNCTION enforce_agent_runtime_operator_action_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_runs run
    WHERE run.id=NEW.run_id AND run.agent_user_id=NEW.agent_user_id)
  THEN RAISE EXCEPTION 'operator action run belongs to another agent' USING ERRCODE='23514'; END IF;
  IF NEW.stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agent_run_stages stage
    WHERE stage.id=NEW.stage_id AND stage.run_id=NEW.run_id
  ) THEN RAISE EXCEPTION 'operator action stage belongs to another run' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runtime_operator_actions_scope
  BEFORE INSERT ON agent_runtime_operator_actions
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_runtime_operator_action_scope();
CREATE TRIGGER agent_runtime_operator_actions_immutable
  BEFORE UPDATE OR DELETE ON agent_runtime_operator_actions
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

COMMIT;
