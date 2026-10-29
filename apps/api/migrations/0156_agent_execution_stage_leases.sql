BEGIN;

-- F1.1b: a trusted execution node may lease a stage only after the existing
-- Runtime has a ready placement decision for that exact node and attempt.
-- agent_run_stages remains the only work queue; this table is immutable
-- binding/evidence for the external execution boundary, not another queue.
CREATE TABLE agent_execution_stage_leases (
  id uuid PRIMARY KEY,
  stage_id uuid NOT NULL REFERENCES agent_run_stages(id) ON DELETE RESTRICT,
  stage_attempt integer NOT NULL CHECK (stage_attempt > 0),
  placement_decision_id uuid NOT NULL UNIQUE REFERENCES agent_stage_placement_decisions(id) ON DELETE RESTRICT,
  node_id uuid NOT NULL REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL REFERENCES agent_execution_node_grants(id) ON DELETE RESTRICT,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  contract_key text NOT NULL CHECK (contract_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  contract_version integer NOT NULL CHECK (contract_version > 0),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  run_input_sha256 text NOT NULL CHECK (run_input_sha256 ~ '^[a-f0-9]{64}$'),
  lease_token_sha256 text NOT NULL CHECK (lease_token_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','failed','uncertain','expired')),
  lease_expires_at timestamptz NOT NULL,
  last_renewed_at timestamptz,
  result_ref_json jsonb,
  result_sha256 text CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[a-f0-9]{64}$'),
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code)<=160),
  failure_message text CHECK (failure_message IS NULL OR char_length(failure_message)<=500),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(stage_id,stage_attempt),
  FOREIGN KEY (capability_id,capability_version)
    REFERENCES agent_capability_execution_manifests(capability_id,capability_version) ON DELETE RESTRICT,
  CHECK ((status='active' AND finished_at IS NULL AND result_ref_json IS NULL AND result_sha256 IS NULL
      AND failure_code IS NULL AND failure_message IS NULL)
    OR (status='completed' AND finished_at IS NOT NULL AND jsonb_typeof(result_ref_json)='object'
      AND result_sha256 IS NOT NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (status IN ('failed','uncertain','expired') AND finished_at IS NOT NULL
      AND result_ref_json IS NULL AND result_sha256 IS NULL AND failure_code IS NOT NULL))
);
CREATE INDEX agent_execution_stage_leases_node_status
  ON agent_execution_stage_leases(node_id,status,lease_expires_at,id);

CREATE TABLE agent_execution_stage_result_receipts (
  id uuid PRIMARY KEY,
  execution_lease_id uuid NOT NULL REFERENCES agent_execution_stage_leases(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  result_ref_json jsonb NOT NULL CHECK (jsonb_typeof(result_ref_json)='object'
    AND octet_length(result_ref_json::text)<=65536),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_lease_id,submission_id)
);
CREATE INDEX agent_execution_stage_result_receipts_node_created
  ON agent_execution_stage_result_receipts(node_id,created_at DESC,id DESC);

CREATE FUNCTION guard_agent_execution_stage_leases() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='agent_execution_stage_result_receipts' THEN
    RAISE EXCEPTION 'Execution stage result evidence is immutable';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution stage lease history cannot be deleted'; END IF;
  IF NEW.id<>OLD.id OR NEW.stage_id<>OLD.stage_id OR NEW.stage_attempt<>OLD.stage_attempt
    OR NEW.placement_decision_id<>OLD.placement_decision_id OR NEW.node_id<>OLD.node_id
    OR NEW.grant_id<>OLD.grant_id OR NEW.capability_id<>OLD.capability_id
    OR NEW.capability_version<>OLD.capability_version OR NEW.contract_key<>OLD.contract_key
    OR NEW.contract_version<>OLD.contract_version OR NEW.manifest_sha256<>OLD.manifest_sha256
    OR NEW.run_input_sha256<>OLD.run_input_sha256 OR NEW.lease_token_sha256<>OLD.lease_token_sha256
    OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Execution stage lease identity cannot change';
  END IF;
  IF OLD.status<>'active' THEN RAISE EXCEPTION 'Terminal execution stage lease cannot change'; END IF;
  IF NEW.status='active' THEN
    IF NEW.lease_expires_at<OLD.lease_expires_at OR NEW.last_renewed_at IS NULL
      OR NEW.result_ref_json IS DISTINCT FROM OLD.result_ref_json
      OR NEW.result_sha256 IS DISTINCT FROM OLD.result_sha256
      OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
      OR NEW.failure_message IS DISTINCT FROM OLD.failure_message
      OR NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
      RAISE EXCEPTION 'Invalid execution stage lease renewal';
    END IF;
  ELSIF NEW.status NOT IN ('completed','failed','uncertain','expired') THEN
    RAISE EXCEPTION 'Invalid execution stage lease transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_execution_stage_leases_guard
  BEFORE UPDATE OR DELETE ON agent_execution_stage_leases
  FOR EACH ROW EXECUTE FUNCTION guard_agent_execution_stage_leases();
CREATE TRIGGER agent_execution_stage_result_receipts_immutable
  BEFORE UPDATE OR DELETE ON agent_execution_stage_result_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_agent_execution_stage_leases();

COMMIT;
