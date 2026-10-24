BEGIN;

CREATE TABLE agent_workflow_definitions (
  workflow_key text NOT NULL CHECK (workflow_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  workflow_version integer NOT NULL CHECK (workflow_version BETWEEN 1 AND 2147483647),
  schema_version text NOT NULL CHECK (schema_version='agent-workflow-v1'),
  manifest_json jsonb NOT NULL CHECK (
    jsonb_typeof(manifest_json)='object'
    AND manifest_json->>'schemaVersion'='agent-workflow-v1'
    AND manifest_json->>'workflowKey'=workflow_key
    AND (manifest_json->>'workflowVersion')::integer=workflow_version
    AND jsonb_typeof(manifest_json->'stages')='array'
    AND jsonb_array_length(manifest_json->'stages') BETWEEN 1 AND 64
    AND octet_length(manifest_json::text)<=65536
  ),
  manifest_sha256 text NOT NULL UNIQUE CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  runtime_min_version text NOT NULL CHECK (char_length(runtime_min_version) BETWEEN 1 AND 40),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workflow_key,workflow_version)
);

CREATE TABLE agent_capability_grants (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  capability_key text NOT NULL CHECK (capability_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  contract_version integer NOT NULL CHECK (contract_version BETWEEN 1 AND 2147483647),
  scope_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(scope_json)='object' AND octet_length(scope_json::text)<=16384),
  risk_ceiling text NOT NULL CHECK (risk_ceiling IN ('L0','L1','L2','L3','L4','L5')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  granted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (valid_until IS NULL OR valid_until>valid_from),
  CHECK ((status='revoked' AND revoked_at IS NOT NULL) OR (status<>'revoked' AND revoked_at IS NULL))
);

CREATE UNIQUE INDEX agent_capability_grants_active_unique
  ON agent_capability_grants(agent_user_id,capability_key,contract_version)
  WHERE status='active' AND valid_until IS NULL;
CREATE INDEX agent_capability_grants_lookup
  ON agent_capability_grants(agent_user_id,capability_key,status,valid_from,valid_until);

CREATE TABLE agent_policy_profiles (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  schema_version text NOT NULL CHECK (schema_version='agent-policy-v1'),
  policy_json jsonb NOT NULL CHECK (
    jsonb_typeof(policy_json)='object'
    AND policy_json->>'schemaVersion'='agent-policy-v1'
    AND octet_length(policy_json::text)<=32768
  ),
  policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,version),
  UNIQUE(agent_user_id,id),
  UNIQUE(agent_user_id,policy_sha256)
);

CREATE TABLE agent_policy_profile_assignments (
  agent_user_id uuid PRIMARY KEY REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  active_policy_profile_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(agent_user_id,active_policy_profile_id)
    REFERENCES agent_policy_profiles(agent_user_id,id) ON DELETE RESTRICT
);

WITH seeded AS (
  INSERT INTO agent_policy_profiles(id,agent_user_id,version,schema_version,policy_json,policy_sha256,created_by_user_id)
  SELECT gen_random_uuid(),a.user_id,1,'agent-policy-v1',
    jsonb_build_object(
      'schemaVersion','agent-policy-v1',
      'mode','compatibility',
      'capabilitySource','agent-account-v0',
      'autoPublish',('blog:auto-publish'=ANY(a.capabilities)),
      'requiresVerifiedEvidence',true
    ),
    encode(sha256(convert_to(jsonb_build_object(
      'schemaVersion','agent-policy-v1',
      'mode','compatibility',
      'capabilitySource','agent-account-v0',
      'autoPublish',('blog:auto-publish'=ANY(a.capabilities)),
      'requiresVerifiedEvidence',true
    )::text,'UTF8')),'hex'),
    a.operator_user_id
  FROM agent_accounts a
  RETURNING agent_user_id,id,created_by_user_id
)
INSERT INTO agent_policy_profile_assignments(agent_user_id,active_policy_profile_id,updated_by_user_id)
SELECT agent_user_id,id,created_by_user_id FROM seeded;

INSERT INTO agent_capability_grants(
  id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
)
SELECT gen_random_uuid(),a.user_id,
  CASE capability WHEN 'research:qa' THEN 'research.qa' ELSE 'blog.article.publish' END,
  1,'{}'::jsonb,
  CASE capability WHEN 'research:qa' THEN 'L1' ELSE 'L3' END,
  'active',a.operator_user_id,'由旧版 Agent capability 安全迁移'
FROM agent_accounts a CROSS JOIN LATERAL unnest(a.capabilities) AS c(capability);

CREATE FUNCTION seed_agent_runtime_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  policy_id uuid;
  policy_document jsonb;
  capability text;
BEGIN
  policy_document := jsonb_build_object(
    'schemaVersion','agent-policy-v1',
    'mode','compatibility',
    'capabilitySource','agent-account-v0',
    'autoPublish',('blog:auto-publish'=ANY(NEW.capabilities)),
    'requiresVerifiedEvidence',true
  );
  policy_id := gen_random_uuid();
  INSERT INTO agent_policy_profiles(id,agent_user_id,version,schema_version,policy_json,policy_sha256,created_by_user_id)
  VALUES(policy_id,NEW.user_id,1,'agent-policy-v1',policy_document,
    encode(sha256(convert_to(policy_document::text,'UTF8')),'hex'),NEW.operator_user_id);
  INSERT INTO agent_policy_profile_assignments(agent_user_id,active_policy_profile_id,updated_by_user_id)
  VALUES(NEW.user_id,policy_id,NEW.operator_user_id);
  FOREACH capability IN ARRAY NEW.capabilities LOOP
    INSERT INTO agent_capability_grants(
      id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
    ) VALUES(
      gen_random_uuid(),NEW.user_id,
      CASE capability WHEN 'research:qa' THEN 'research.qa' ELSE 'blog.article.publish' END,
      1,'{}'::jsonb,
      CASE capability WHEN 'research:qa' THEN 'L1' ELSE 'L3' END,
      'active',NEW.operator_user_id,'由旧版 Agent capability 安全迁移'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runtime_account_seed
  AFTER INSERT ON agent_accounts FOR EACH ROW EXECUTE FUNCTION seed_agent_runtime_account();

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  workflow_key text NOT NULL,
  workflow_version integer NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('schedule','manual','interaction','system')),
  trigger_ref text CHECK (trigger_ref IS NULL OR char_length(trigger_ref) BETWEEN 1 AND 240),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 240),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','succeeded','rejected','failed','cancelled','uncertain')),
  behavior_profile_id uuid NOT NULL,
  policy_profile_id uuid NOT NULL,
  capability_snapshot jsonb NOT NULL CHECK (jsonb_typeof(capability_snapshot)='object' AND octet_length(capability_snapshot::text)<=32768),
  config_snapshot jsonb NOT NULL CHECK (jsonb_typeof(config_snapshot)='object' AND octet_length(config_snapshot::text)<=32768),
  input_json jsonb NOT NULL CHECK (jsonb_typeof(input_json)='object' AND octet_length(input_json::text)<=65536),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  budget_json jsonb NOT NULL CHECK (jsonb_typeof(budget_json)='object' AND octet_length(budget_json::text)<=16384),
  usage_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(usage_json)='object' AND octet_length(usage_json::text)<=16384),
  output_type text CHECK (output_type IS NULL OR output_type ~ '^[a-z][a-z0-9.-]{2,119}$'),
  output_id uuid,
  error_code text CHECK (error_code IS NULL OR char_length(error_code)<=120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message)<=500),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workflow_key,workflow_version)
    REFERENCES agent_workflow_definitions(workflow_key,workflow_version) ON DELETE RESTRICT,
  FOREIGN KEY(agent_user_id,behavior_profile_id)
    REFERENCES agent_behavior_profiles(agent_user_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(agent_user_id,policy_profile_id)
    REFERENCES agent_policy_profiles(agent_user_id,id) ON DELETE RESTRICT,
  UNIQUE(agent_user_id,workflow_key,idempotency_key),
  UNIQUE(id,agent_user_id),
  CHECK ((output_type IS NULL)=(output_id IS NULL)),
  CHECK (
    (status IN ('queued','running','waiting') AND finished_at IS NULL)
    OR (status IN ('succeeded','rejected','failed','cancelled','uncertain') AND finished_at IS NOT NULL)
  ),
  CHECK (status<>'succeeded' OR output_id IS NOT NULL)
);

CREATE INDEX agent_runs_agent_history ON agent_runs(agent_user_id,created_at DESC,id DESC);
CREATE INDEX agent_runs_active ON agent_runs(status,queued_at,id)
  WHERE status IN ('queued','running','waiting');

CREATE TABLE agent_run_stages (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  stage_key text NOT NULL CHECK (stage_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 1023),
  kind text NOT NULL CHECK (kind IN ('deterministic','provider','tool','domain-write','interaction')),
  depends_on text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('blocked','queued','leased','running','waiting','succeeded','skipped','failed','cancelled','uncertain')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 100),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  timeout_seconds integer NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 86400),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  leased_by text CHECK (leased_by IS NULL OR char_length(leased_by) BETWEEN 1 AND 120),
  lease_until timestamptz,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  output_ref_json jsonb CHECK (output_ref_json IS NULL OR (jsonb_typeof(output_ref_json)='object' AND octet_length(output_ref_json::text)<=32768)),
  error_code text CHECK (error_code IS NULL OR char_length(error_code)<=120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message)<=500),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,stage_key),
  UNIQUE(run_id,id),
  CHECK (array_position(depends_on,stage_key) IS NULL),
  CHECK (attempt<=max_attempts),
  CHECK (
    (status IN ('leased','running') AND lease_token IS NOT NULL AND leased_by IS NOT NULL AND lease_until IS NOT NULL)
    OR (status NOT IN ('leased','running') AND lease_token IS NULL AND leased_by IS NULL AND lease_until IS NULL)
  ),
  CHECK (
    (status IN ('succeeded','skipped','failed','cancelled','uncertain') AND finished_at IS NOT NULL)
    OR (status IN ('blocked','queued','leased','running','waiting') AND finished_at IS NULL)
  )
);

CREATE INDEX agent_run_stages_queue ON agent_run_stages(available_at,created_at,id)
  WHERE status='queued' OR (status IN ('leased','running') AND lease_until IS NOT NULL);
CREATE INDEX agent_run_stages_run ON agent_run_stages(run_id,ordinal,id);

CREATE TABLE agent_run_actions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  action_key text NOT NULL CHECK (action_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  action_kind text NOT NULL CHECK (action_kind IN ('provider','tool','domain-write','interaction')),
  capability_key text NOT NULL CHECK (capability_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  contract_version integer NOT NULL CHECK (contract_version BETWEEN 1 AND 2147483647),
  risk_level text NOT NULL CHECK (risk_level IN ('L0','L1','L2','L3','L4','L5')),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','authorized','reserved','sending','sent','acknowledged','succeeded','rejected','failed','uncertain','cancelled')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 240),
  request_json jsonb NOT NULL CHECK (jsonb_typeof(request_json)='object' AND octet_length(request_json::text)<=65536),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_ref_json jsonb CHECK (response_ref_json IS NULL OR (jsonb_typeof(response_ref_json)='object' AND octet_length(response_ref_json::text)<=32768)),
  response_sha256 text CHECK (response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
  provider_request_id text CHECK (provider_request_id IS NULL OR char_length(provider_request_id)<=240),
  reservation_ref text CHECK (reservation_ref IS NULL OR char_length(reservation_ref)<=240),
  usage_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(usage_json)='object' AND octet_length(usage_json::text)<=16384),
  policy_decision_json jsonb NOT NULL CHECK (jsonb_typeof(policy_decision_json)='object' AND octet_length(policy_decision_json::text)<=32768),
  error_code text CHECK (error_code IS NULL OR char_length(error_code)<=120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message)<=500),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,stage_id) REFERENCES agent_run_stages(run_id,id) ON DELETE RESTRICT,
  UNIQUE(stage_id,action_key,idempotency_key),
  UNIQUE(run_id,id),
  CHECK (status NOT IN ('sent','acknowledged','succeeded') OR sent_at IS NOT NULL),
  CHECK (status NOT IN ('acknowledged','succeeded') OR acknowledged_at IS NOT NULL),
  CHECK (
    (status IN ('succeeded','rejected','failed','uncertain','cancelled') AND finished_at IS NOT NULL)
    OR (status IN ('prepared','authorized','reserved','sending','sent','acknowledged') AND finished_at IS NULL)
  )
);

CREATE INDEX agent_run_actions_stage ON agent_run_actions(stage_id,created_at,id);
CREATE INDEX agent_run_actions_recovery ON agent_run_actions(status,updated_at,id)
  WHERE status IN ('reserved','sending','sent','acknowledged');

CREATE TABLE agent_run_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  stage_id uuid,
  action_id uuid,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]{2,119}$'),
  actor_kind text NOT NULL CHECK (actor_kind IN ('system','worker','operator','agent','user')),
  actor_ref text CHECK (actor_ref IS NULL OR char_length(actor_ref)<=240),
  payload_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,stage_id) REFERENCES agent_run_stages(run_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(run_id,action_id) REFERENCES agent_run_actions(run_id,id) ON DELETE RESTRICT
);

CREATE INDEX agent_run_events_timeline ON agent_run_events(run_id,id);

CREATE TABLE agent_schedules (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  workflow_key text NOT NULL,
  workflow_version integer NOT NULL,
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 120),
  schedule_spec_json jsonb NOT NULL CHECK (jsonb_typeof(schedule_spec_json)='object' AND octet_length(schedule_spec_json::text)<=8192),
  enabled boolean NOT NULL DEFAULT false,
  next_fire_at timestamptz,
  last_fire_at timestamptz,
  misfire_policy text NOT NULL DEFAULT 'skip' CHECK (misfire_policy IN ('skip','fire-once')),
  config_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config_json)='object' AND octet_length(config_json::text)<=16384),
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workflow_key,workflow_version)
    REFERENCES agent_workflow_definitions(workflow_key,workflow_version) ON DELETE RESTRICT,
  CHECK (NOT enabled OR next_fire_at IS NOT NULL)
);

CREATE INDEX agent_schedules_due ON agent_schedules(next_fire_at,id) WHERE enabled=true;

CREATE TABLE agent_runtime_outbox (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('run','stage','action','schedule')),
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]{2,119}$'),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 8 AND 240),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatching','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aggregate_type,aggregate_id,event_type,dedupe_key),
  CHECK (
    (status='dispatching' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status<>'dispatching' AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CHECK ((status='delivered' AND delivered_at IS NOT NULL) OR (status<>'delivered' AND delivered_at IS NULL))
);

CREATE INDEX agent_runtime_outbox_queue ON agent_runtime_outbox(available_at,created_at,id)
  WHERE status='pending' OR (status='dispatching' AND lease_until IS NOT NULL);

CREATE FUNCTION guard_agent_runtime_foundation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='agent_workflow_definitions' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent workflow definitions cannot be deleted'; END IF;
    IF NEW.workflow_key<>OLD.workflow_key OR NEW.workflow_version<>OLD.workflow_version
      OR NEW.schema_version<>OLD.schema_version OR NEW.manifest_json<>OLD.manifest_json
      OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.runtime_min_version<>OLD.runtime_min_version
      OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at
      OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','active','retired'))
        OR (OLD.status='active' AND NEW.status IN ('active','retired'))
        OR (OLD.status='retired' AND NEW.status='retired')) THEN
      RAISE EXCEPTION 'Agent workflow identity and manifest are immutable';
    END IF;
  ELSIF TG_TABLE_NAME='agent_capability_grants' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent capability grants cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.agent_user_id<>OLD.agent_user_id OR NEW.capability_key<>OLD.capability_key
      OR NEW.contract_version<>OLD.contract_version OR NEW.scope_json<>OLD.scope_json
      OR NEW.risk_ceiling<>OLD.risk_ceiling OR NEW.valid_from<>OLD.valid_from
      OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.granted_by_user_id<>OLD.granted_by_user_id
      OR NEW.reason<>OLD.reason OR NEW.created_at<>OLD.created_at
      OR (OLD.status<>'active' AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Agent capability grant identity cannot change or reactivate';
    END IF;
  ELSIF TG_TABLE_NAME='agent_policy_profiles' THEN
    RAISE EXCEPTION 'Agent policy profile versions are immutable';
  ELSIF TG_TABLE_NAME='agent_policy_profile_assignments' AND TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Agent policy assignment cannot be deleted';
  ELSIF TG_TABLE_NAME='agent_runs' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent runs cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.agent_user_id<>OLD.agent_user_id OR NEW.workflow_key<>OLD.workflow_key
      OR NEW.workflow_version<>OLD.workflow_version OR NEW.manifest_sha256<>OLD.manifest_sha256
      OR NEW.trigger_kind<>OLD.trigger_kind OR NEW.trigger_ref IS DISTINCT FROM OLD.trigger_ref
      OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.behavior_profile_id<>OLD.behavior_profile_id
      OR NEW.policy_profile_id<>OLD.policy_profile_id OR NEW.capability_snapshot<>OLD.capability_snapshot
      OR NEW.config_snapshot<>OLD.config_snapshot OR NEW.input_json<>OLD.input_json
      OR NEW.input_sha256<>OLD.input_sha256 OR NEW.budget_json<>OLD.budget_json
      OR NEW.queued_at<>OLD.queued_at OR NEW.created_at<>OLD.created_at
      OR OLD.status IN ('succeeded','rejected','failed','cancelled','uncertain') THEN
      RAISE EXCEPTION 'Agent run frozen fields or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='queued' AND NEW.status IN ('running','cancelled','failed'))
      OR (OLD.status='running' AND NEW.status IN ('waiting','succeeded','rejected','failed','cancelled','uncertain'))
      OR (OLD.status='waiting' AND NEW.status IN ('running','failed','cancelled','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid Agent run state transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_run_stages' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent run stages cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.run_id<>OLD.run_id OR NEW.stage_key<>OLD.stage_key
      OR NEW.ordinal<>OLD.ordinal OR NEW.kind<>OLD.kind OR NEW.depends_on<>OLD.depends_on
      OR NEW.max_attempts<>OLD.max_attempts OR NEW.timeout_seconds<>OLD.timeout_seconds
      OR NEW.input_sha256<>OLD.input_sha256 OR NEW.created_at<>OLD.created_at
      OR OLD.status IN ('succeeded','skipped','failed','cancelled','uncertain') THEN
      RAISE EXCEPTION 'Agent stage definition or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='blocked' AND NEW.status IN ('queued','skipped','cancelled'))
      OR (OLD.status='queued' AND NEW.status IN ('leased','cancelled','failed'))
      OR (OLD.status='leased' AND NEW.status IN ('running','queued','succeeded','failed','cancelled','uncertain'))
      OR (OLD.status='running' AND NEW.status IN ('waiting','queued','succeeded','failed','cancelled','uncertain'))
      OR (OLD.status='waiting' AND NEW.status IN ('queued','failed','cancelled','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid Agent stage state transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_run_actions' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent run actions cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.run_id<>OLD.run_id OR NEW.stage_id<>OLD.stage_id
      OR NEW.action_key<>OLD.action_key OR NEW.action_kind<>OLD.action_kind
      OR NEW.capability_key<>OLD.capability_key OR NEW.contract_version<>OLD.contract_version
      OR NEW.risk_level<>OLD.risk_level OR NEW.idempotency_key<>OLD.idempotency_key
      OR NEW.request_json<>OLD.request_json OR NEW.request_sha256<>OLD.request_sha256
      OR NEW.policy_decision_json<>OLD.policy_decision_json OR NEW.prepared_at<>OLD.prepared_at
      OR NEW.created_at<>OLD.created_at
      OR OLD.status IN ('succeeded','rejected','failed','uncertain','cancelled') THEN
      RAISE EXCEPTION 'Agent action request or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='prepared' AND NEW.status IN ('authorized','rejected','cancelled'))
      OR (OLD.status='authorized' AND NEW.status IN ('reserved','rejected','failed','cancelled'))
      OR (OLD.status='reserved' AND NEW.status IN ('sending','failed','cancelled'))
      OR (OLD.status='sending' AND NEW.status IN ('sent','failed','uncertain'))
      OR (OLD.status='sent' AND NEW.status IN ('acknowledged','failed','uncertain'))
      OR (OLD.status='acknowledged' AND NEW.status IN ('succeeded','failed','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid Agent action state transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_run_events' THEN
    RAISE EXCEPTION 'Agent run events are append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_workflow_definitions_guard BEFORE UPDATE OR DELETE ON agent_workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();
CREATE TRIGGER agent_capability_grants_guard BEFORE UPDATE OR DELETE ON agent_capability_grants
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();
CREATE TRIGGER agent_policy_profiles_guard BEFORE UPDATE OR DELETE ON agent_policy_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();
CREATE TRIGGER agent_policy_assignments_guard BEFORE DELETE ON agent_policy_profile_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();
CREATE TRIGGER agent_runs_guard BEFORE UPDATE OR DELETE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();
CREATE TRIGGER agent_run_stages_guard BEFORE UPDATE OR DELETE ON agent_run_stages
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();
CREATE TRIGGER agent_run_actions_guard BEFORE UPDATE OR DELETE ON agent_run_actions
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();
CREATE TRIGGER agent_run_events_guard BEFORE UPDATE OR DELETE ON agent_run_events
  FOR EACH ROW EXECUTE FUNCTION guard_agent_runtime_foundation();

COMMIT;
