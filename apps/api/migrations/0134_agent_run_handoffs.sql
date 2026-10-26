BEGIN;

ALTER TABLE agent_runtime_stage_artifacts
  ADD CONSTRAINT agent_runtime_stage_artifacts_run_identity UNIQUE(run_id,id);

CREATE TABLE agent_run_handoffs (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL,
  handoff_kind text NOT NULL CHECK (handoff_kind ~ '^[a-z][a-z0-9.-]{2,119}$'),
  source_run_id uuid NOT NULL,
  source_artifact_id uuid NOT NULL,
  source_output_type text NOT NULL CHECK (source_output_type ~ '^[a-z][a-z0-9.-]{2,119}$'),
  source_artifact_key text NOT NULL CHECK (source_artifact_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  source_content_sha256 text NOT NULL CHECK (source_content_sha256 ~ '^[a-f0-9]{64}$'),
  target_run_id uuid NOT NULL UNIQUE,
  target_input_sha256 text NOT NULL CHECK (target_input_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(source_run_id,agent_user_id) REFERENCES agent_runs(id,agent_user_id) ON DELETE RESTRICT,
  FOREIGN KEY(target_run_id,agent_user_id) REFERENCES agent_runs(id,agent_user_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_run_id,source_artifact_id)
    REFERENCES agent_runtime_stage_artifacts(run_id,id) ON DELETE RESTRICT,
  UNIQUE(handoff_kind,source_run_id,source_artifact_id),
  CHECK (source_run_id<>target_run_id)
);

CREATE INDEX agent_run_handoffs_agent_history
  ON agent_run_handoffs(agent_user_id,created_at DESC,id DESC);
CREATE INDEX agent_run_handoffs_source
  ON agent_run_handoffs(source_run_id,source_artifact_id);

CREATE FUNCTION reject_agent_run_handoff_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent run handoffs are immutable';
END;
$$;

CREATE TRIGGER agent_run_handoffs_immutable
  BEFORE UPDATE OR DELETE ON agent_run_handoffs
  FOR EACH ROW EXECUTE FUNCTION reject_agent_run_handoff_mutation();

COMMIT;
