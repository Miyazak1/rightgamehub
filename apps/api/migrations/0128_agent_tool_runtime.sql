BEGIN;

CREATE TABLE agent_tool_contracts (
  tool_key text NOT NULL CHECK (tool_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  contract_version integer NOT NULL CHECK (contract_version BETWEEN 1 AND 2147483647),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','retired')),
  capability_key text NOT NULL CHECK (capability_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  risk_level text NOT NULL CHECK (risk_level IN ('L0','L1','L2','L3','L4','L5')),
  execution_class text NOT NULL CHECK (execution_class IN ('in-process','worker','sandbox','remote')),
  effect_class text NOT NULL CHECK (effect_class IN ('read-only','idempotent-write','non-idempotent-write')),
  input_schema_key text NOT NULL CHECK (input_schema_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  input_schema_version integer NOT NULL CHECK (input_schema_version BETWEEN 1 AND 2147483647),
  output_schema_key text NOT NULL CHECK (output_schema_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  output_schema_version integer NOT NULL CHECK (output_schema_version BETWEEN 1 AND 2147483647),
  network_policy_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(network_policy_json)='object' AND octet_length(network_policy_json::text)<=16384),
  filesystem_policy_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(filesystem_policy_json)='object' AND octet_length(filesystem_policy_json::text)<=16384),
  timeout_seconds integer NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 3600),
  output_limit_bytes integer NOT NULL CHECK (output_limit_bytes BETWEEN 1 AND 10485760),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tool_key,contract_version)
);

CREATE TABLE agent_tool_calls (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  tool_key text NOT NULL,
  contract_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','sending','acknowledged','succeeded','failed','uncertain')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_id text CHECK (receipt_id IS NULL OR char_length(receipt_id)<=240),
  response_ref_json jsonb CHECK (response_ref_json IS NULL OR (jsonb_typeof(response_ref_json)='object' AND octet_length(response_ref_json::text)<=32768)),
  response_sha256 text CHECK (response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
  usage_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(usage_json)='object' AND octet_length(usage_json::text)<=16384),
  error_code text CHECK (error_code IS NULL OR char_length(error_code)<=120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message)<=500),
  sending_at timestamptz,
  acknowledged_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tool_key,contract_version) REFERENCES agent_tool_contracts(tool_key,contract_version) ON DELETE RESTRICT,
  CHECK ((status='reserved' AND sending_at IS NULL AND acknowledged_at IS NULL AND finished_at IS NULL)
    OR (status='sending' AND sending_at IS NOT NULL AND acknowledged_at IS NULL AND finished_at IS NULL)
    OR (status='acknowledged' AND sending_at IS NOT NULL AND acknowledged_at IS NOT NULL AND finished_at IS NULL)
    OR (status IN ('succeeded','failed','uncertain') AND finished_at IS NOT NULL))
);

CREATE INDEX agent_tool_calls_recovery ON agent_tool_calls(status,updated_at,id)
  WHERE status IN ('reserved','sending','acknowledged');

CREATE TABLE agent_tool_artifacts (
  id uuid PRIMARY KEY,
  tool_call_id uuid NOT NULL UNIQUE REFERENCES agent_tool_calls(id) ON DELETE RESTRICT,
  action_id uuid NOT NULL UNIQUE REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  media_type text NOT NULL CHECK (media_type='application/json'),
  content_json jsonb NOT NULL CHECK (octet_length(content_json::text)<=10485760),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION guard_agent_tool_runtime() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent tool ledgers cannot be deleted'; END IF;
  IF TG_TABLE_NAME='agent_tool_contracts' THEN
    IF NEW.tool_key<>OLD.tool_key OR NEW.contract_version<>OLD.contract_version
      OR NEW.capability_key<>OLD.capability_key OR NEW.risk_level<>OLD.risk_level
      OR NEW.execution_class<>OLD.execution_class OR NEW.effect_class<>OLD.effect_class
      OR NEW.input_schema_key<>OLD.input_schema_key OR NEW.input_schema_version<>OLD.input_schema_version
      OR NEW.output_schema_key<>OLD.output_schema_key OR NEW.output_schema_version<>OLD.output_schema_version
      OR NEW.network_policy_json<>OLD.network_policy_json OR NEW.filesystem_policy_json<>OLD.filesystem_policy_json
      OR NEW.timeout_seconds<>OLD.timeout_seconds OR NEW.output_limit_bytes<>OLD.output_limit_bytes
      OR NEW.created_at<>OLD.created_at OR (OLD.status='retired' AND NEW.status<>'retired') THEN
      RAISE EXCEPTION 'Agent tool contract versions are immutable';
    END IF;
  ELSIF TG_TABLE_NAME='agent_tool_calls' THEN
    IF NEW.id<>OLD.id OR NEW.action_id<>OLD.action_id OR NEW.tool_key<>OLD.tool_key
      OR NEW.contract_version<>OLD.contract_version OR NEW.request_sha256<>OLD.request_sha256
      OR NEW.created_at<>OLD.created_at OR OLD.status IN ('succeeded','failed','uncertain') THEN
      RAISE EXCEPTION 'Agent tool call identity or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='reserved' AND NEW.status IN ('sending','failed'))
      OR (OLD.status='sending' AND NEW.status IN ('acknowledged','failed','uncertain'))
      OR (OLD.status='acknowledged' AND NEW.status IN ('succeeded','failed','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid agent tool call transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_tool_artifacts' THEN
    RAISE EXCEPTION 'Agent tool artifacts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_tool_contracts_guard BEFORE UPDATE OR DELETE ON agent_tool_contracts
  FOR EACH ROW EXECUTE FUNCTION guard_agent_tool_runtime();
CREATE TRIGGER agent_tool_calls_guard BEFORE UPDATE OR DELETE ON agent_tool_calls
  FOR EACH ROW EXECUTE FUNCTION guard_agent_tool_runtime();
CREATE TRIGGER agent_tool_artifacts_guard BEFORE UPDATE OR DELETE ON agent_tool_artifacts
  FOR EACH ROW EXECUTE FUNCTION guard_agent_tool_runtime();

COMMIT;
