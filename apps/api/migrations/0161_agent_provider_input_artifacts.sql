BEGIN;

CREATE TABLE agent_provider_input_artifacts (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  content_json jsonb NOT NULL CHECK(jsonb_typeof(content_json)='object' AND octet_length(content_json::text)<=1048576),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER agent_provider_input_artifacts_immutable BEFORE UPDATE OR DELETE ON agent_provider_input_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_agent_provider_output_artifact_mutation();

COMMIT;
