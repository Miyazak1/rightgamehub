BEGIN;

CREATE TABLE agent_provider_models (
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9.-]{1,79}$'),
  model_id text NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 160),
  catalog_version integer NOT NULL CHECK (catalog_version BETWEEN 1 AND 2147483647),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','retired')),
  task_classes text[] NOT NULL CHECK (cardinality(task_classes) BETWEEN 1 AND 32),
  supports_json_schema boolean NOT NULL DEFAULT false,
  max_input_tokens integer NOT NULL CHECK (max_input_tokens BETWEEN 1 AND 100000000),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 10000000),
  input_price_microusd_per_million bigint NOT NULL CHECK (input_price_microusd_per_million>=0),
  output_price_microusd_per_million bigint NOT NULL CHECK (output_price_microusd_per_million>=0),
  config_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config_json)='object' AND octet_length(config_json::text)<=16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,model_id,catalog_version)
);

CREATE INDEX agent_provider_models_resolve
  ON agent_provider_models(status,provider,model_id,catalog_version DESC);

CREATE TABLE agent_provider_circuits (
  provider text NOT NULL,
  model_id text NOT NULL,
  state text NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','open','half-open')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 1000000),
  opened_at timestamptz,
  retry_at timestamptz,
  probe_lease_token uuid,
  probe_lease_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code)<=120),
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,model_id),
  CHECK ((state='closed' AND retry_at IS NULL AND probe_lease_token IS NULL AND probe_lease_until IS NULL)
    OR (state='open' AND retry_at IS NOT NULL AND probe_lease_token IS NULL AND probe_lease_until IS NULL)
    OR (state='half-open' AND retry_at IS NOT NULL AND probe_lease_token IS NOT NULL AND probe_lease_until IS NOT NULL))
);

CREATE TABLE agent_budget_reservations (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  agent_user_id uuid NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  period_month date NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','settled','released','uncertain')),
  reserved_provider_calls integer NOT NULL CHECK (reserved_provider_calls BETWEEN 0 AND 1000),
  reserved_input_tokens integer NOT NULL CHECK (reserved_input_tokens BETWEEN 0 AND 10000000),
  reserved_output_tokens integer NOT NULL CHECK (reserved_output_tokens BETWEEN 0 AND 2000000),
  reserved_cost_microusd bigint NOT NULL CHECK (reserved_cost_microusd BETWEEN 0 AND 1000000000000),
  actual_provider_calls integer CHECK (actual_provider_calls BETWEEN 0 AND 1000),
  actual_input_tokens integer CHECK (actual_input_tokens BETWEEN 0 AND 10000000),
  actual_output_tokens integer CHECK (actual_output_tokens BETWEEN 0 AND 2000000),
  actual_cost_microusd bigint CHECK (actual_cost_microusd BETWEEN 0 AND 1000000000000),
  charged_provider_calls integer NOT NULL DEFAULT 0 CHECK (charged_provider_calls BETWEEN 0 AND 1000),
  charged_input_tokens integer NOT NULL DEFAULT 0 CHECK (charged_input_tokens BETWEEN 0 AND 10000000),
  charged_output_tokens integer NOT NULL DEFAULT 0 CHECK (charged_output_tokens BETWEEN 0 AND 2000000),
  charged_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (charged_cost_microusd BETWEEN 0 AND 1000000000000),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,agent_user_id) REFERENCES agent_runs(id,agent_user_id) ON DELETE RESTRICT,
  CHECK ((status='reserved' AND settled_at IS NULL AND released_at IS NULL)
    OR (status IN ('settled','uncertain') AND settled_at IS NOT NULL AND released_at IS NULL)
    OR (status='released' AND released_at IS NOT NULL AND settled_at IS NULL)),
  CHECK ((status IN ('reserved','released') AND charged_provider_calls=0 AND charged_input_tokens=0
      AND charged_output_tokens=0 AND charged_cost_microusd=0)
    OR (status IN ('settled','uncertain') AND charged_provider_calls>=reserved_provider_calls
      AND charged_input_tokens>=reserved_input_tokens AND charged_output_tokens>=reserved_output_tokens
      AND charged_cost_microusd>=reserved_cost_microusd)),
  CHECK (status<>'settled' OR (actual_provider_calls IS NOT NULL AND actual_input_tokens IS NOT NULL
    AND actual_output_tokens IS NOT NULL AND actual_cost_microusd IS NOT NULL)),
  CHECK (actual_provider_calls IS NULL OR charged_provider_calls>=actual_provider_calls),
  CHECK (actual_input_tokens IS NULL OR charged_input_tokens>=actual_input_tokens),
  CHECK (actual_output_tokens IS NULL OR charged_output_tokens>=actual_output_tokens),
  CHECK (actual_cost_microusd IS NULL OR charged_cost_microusd>=actual_cost_microusd)
);

CREATE INDEX agent_budget_reservations_run ON agent_budget_reservations(run_id,status);
CREATE INDEX agent_budget_reservations_agent_month
  ON agent_budget_reservations(agent_user_id,period_month,status);
CREATE INDEX agent_budget_reservations_platform_month
  ON agent_budget_reservations(period_month,status);

CREATE TABLE agent_provider_calls (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL UNIQUE REFERENCES agent_budget_reservations(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  model_id text NOT NULL,
  catalog_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','sending','acknowledged','succeeded','failed','uncertain')),
  model_policy_json jsonb NOT NULL CHECK (jsonb_typeof(model_policy_json)='object' AND octet_length(model_policy_json::text)<=16384),
  prompt_template_key text NOT NULL CHECK (prompt_template_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  prompt_template_version integer NOT NULL CHECK (prompt_template_version BETWEEN 1 AND 2147483647),
  response_schema_key text NOT NULL CHECK (response_schema_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  response_schema_version integer NOT NULL CHECK (response_schema_version BETWEEN 1 AND 2147483647),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  token_ceiling integer NOT NULL CHECK (token_ceiling BETWEEN 1 AND 2000000),
  timeout_seconds integer NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 3600),
  provider_request_id text CHECK (provider_request_id IS NULL OR char_length(provider_request_id)<=240),
  response_ref_json jsonb CHECK (response_ref_json IS NULL OR (jsonb_typeof(response_ref_json)='object' AND octet_length(response_ref_json::text)<=32768)),
  usage_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(usage_json)='object' AND octet_length(usage_json::text)<=16384),
  error_code text CHECK (error_code IS NULL OR char_length(error_code)<=120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message)<=500),
  sending_at timestamptz,
  acknowledged_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(provider,model_id,catalog_version)
    REFERENCES agent_provider_models(provider,model_id,catalog_version) ON DELETE RESTRICT,
  CHECK ((status='reserved' AND sending_at IS NULL AND finished_at IS NULL)
    OR (status='sending' AND sending_at IS NOT NULL AND finished_at IS NULL)
    OR (status='acknowledged' AND sending_at IS NOT NULL AND acknowledged_at IS NOT NULL AND finished_at IS NULL)
    OR (status IN ('succeeded','failed','uncertain') AND finished_at IS NOT NULL))
);

CREATE INDEX agent_provider_calls_recovery ON agent_provider_calls(status,updated_at,id)
  WHERE status IN ('reserved','sending','acknowledged');

CREATE FUNCTION guard_agent_runtime_governance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent governance ledgers cannot be deleted'; END IF;
  IF TG_TABLE_NAME='agent_provider_models' THEN
    IF NEW.provider<>OLD.provider OR NEW.model_id<>OLD.model_id OR NEW.catalog_version<>OLD.catalog_version
      OR NEW.task_classes<>OLD.task_classes OR NEW.supports_json_schema<>OLD.supports_json_schema
      OR NEW.max_input_tokens<>OLD.max_input_tokens OR NEW.max_output_tokens<>OLD.max_output_tokens
      OR NEW.input_price_microusd_per_million<>OLD.input_price_microusd_per_million
      OR NEW.output_price_microusd_per_million<>OLD.output_price_microusd_per_million
      OR NEW.config_json<>OLD.config_json OR NEW.created_at<>OLD.created_at
      OR (OLD.status='retired' AND NEW.status<>'retired') THEN
      RAISE EXCEPTION 'Provider model catalog versions are immutable';
    END IF;
  ELSIF TG_TABLE_NAME='agent_budget_reservations' THEN
    IF NEW.id<>OLD.id OR NEW.action_id<>OLD.action_id OR NEW.run_id<>OLD.run_id
      OR NEW.agent_user_id<>OLD.agent_user_id OR NEW.provider<>OLD.provider OR NEW.model_id<>OLD.model_id
      OR NEW.period_month<>OLD.period_month OR NEW.reserved_provider_calls<>OLD.reserved_provider_calls
      OR NEW.reserved_input_tokens<>OLD.reserved_input_tokens OR NEW.reserved_output_tokens<>OLD.reserved_output_tokens
      OR NEW.reserved_cost_microusd<>OLD.reserved_cost_microusd OR NEW.reserved_at<>OLD.reserved_at
      OR OLD.status IN ('settled','released','uncertain') THEN
      RAISE EXCEPTION 'Budget reservation identity or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (OLD.status='reserved' AND NEW.status IN ('settled','released','uncertain')) THEN
      RAISE EXCEPTION 'Invalid budget reservation transition';
    END IF;
  ELSIF TG_TABLE_NAME='agent_provider_calls' THEN
    IF NEW.id<>OLD.id OR NEW.action_id<>OLD.action_id OR NEW.reservation_id<>OLD.reservation_id
      OR NEW.provider<>OLD.provider OR NEW.model_id<>OLD.model_id OR NEW.catalog_version<>OLD.catalog_version
      OR NEW.model_policy_json<>OLD.model_policy_json OR NEW.prompt_template_key<>OLD.prompt_template_key
      OR NEW.prompt_template_version<>OLD.prompt_template_version OR NEW.response_schema_key<>OLD.response_schema_key
      OR NEW.response_schema_version<>OLD.response_schema_version OR NEW.request_sha256<>OLD.request_sha256
      OR NEW.token_ceiling<>OLD.token_ceiling OR NEW.timeout_seconds<>OLD.timeout_seconds
      OR NEW.created_at<>OLD.created_at OR OLD.status IN ('succeeded','failed','uncertain') THEN
      RAISE EXCEPTION 'Provider call request or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='reserved' AND NEW.status IN ('sending','failed'))
      OR (OLD.status='sending' AND NEW.status IN ('acknowledged','failed','uncertain'))
      OR (OLD.status='acknowledged' AND NEW.status IN ('succeeded','failed','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid provider call transition'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_provider_models_guard BEFORE UPDATE OR DELETE ON agent_provider_models
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_governance();
CREATE TRIGGER agent_budget_reservations_guard BEFORE UPDATE OR DELETE ON agent_budget_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_governance();
CREATE TRIGGER agent_provider_calls_guard BEFORE UPDATE OR DELETE ON agent_provider_calls
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_governance();
CREATE TRIGGER agent_provider_circuits_no_delete BEFORE DELETE ON agent_provider_circuits
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_governance();

COMMIT;
