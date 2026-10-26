BEGIN;

CREATE TABLE agent_provider_output_artifacts (
  id uuid PRIMARY KEY,
  provider_call_id uuid NOT NULL UNIQUE REFERENCES agent_provider_calls(id) ON DELETE RESTRICT,
  action_id uuid NOT NULL UNIQUE REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  schema_key text NOT NULL CHECK (schema_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  schema_version integer NOT NULL CHECK (schema_version BETWEEN 1 AND 2147483647),
  media_type text NOT NULL CHECK (media_type='application/json'),
  content_json jsonb NOT NULL CHECK (octet_length(content_json::text)<=1048576),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_runtime_stage_artifacts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  action_id uuid,
  artifact_key text NOT NULL CHECK (artifact_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('model-output','validated-output','verification')),
  schema_key text NOT NULL CHECK (schema_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  schema_version integer NOT NULL CHECK (schema_version BETWEEN 1 AND 2147483647),
  media_type text NOT NULL CHECK (media_type='application/json'),
  content_json jsonb NOT NULL CHECK (octet_length(content_json::text)<=1048576),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),
  source_tool_artifact_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(source_tool_artifact_ids)<=32),
  source_stage_artifact_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(source_stage_artifact_ids)<=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,stage_id) REFERENCES agent_run_stages(run_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(run_id,action_id) REFERENCES agent_run_actions(run_id,id) ON DELETE RESTRICT,
  UNIQUE(stage_id,artifact_key),
  CHECK (cardinality(source_tool_artifact_ids)+cardinality(source_stage_artifact_ids) BETWEEN 1 AND 32)
);

CREATE INDEX agent_runtime_stage_artifacts_run ON agent_runtime_stage_artifacts(run_id,created_at,id);

CREATE FUNCTION reject_agent_provider_output_artifact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent provider output artifacts are immutable';
END;
$$;

CREATE TRIGGER agent_provider_output_artifacts_immutable
  BEFORE UPDATE OR DELETE ON agent_provider_output_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_agent_provider_output_artifact_mutation();

CREATE FUNCTION reject_agent_runtime_stage_artifact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent runtime stage artifacts are immutable';
END;
$$;

CREATE TRIGGER agent_runtime_stage_artifacts_immutable
  BEFORE UPDATE OR DELETE ON agent_runtime_stage_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_agent_runtime_stage_artifact_mutation();

COMMIT;
