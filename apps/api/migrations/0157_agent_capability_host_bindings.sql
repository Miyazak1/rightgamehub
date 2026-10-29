BEGIN;

-- F1.2d: explicitly bind a public host capability identity to one existing
-- Runtime workflow. The Runtime ledger remains the only task queue and source
-- of truth; this table only prevents ambiguous name-based dispatch.
CREATE TABLE agent_capability_host_bindings (
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  workflow_key text NOT NULL,
  workflow_version integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  settings_json jsonb NOT NULL CHECK (
    jsonb_typeof(settings_json)='object'
    AND settings_json->>'schemaVersion'='capability-host-binding-v1'
    AND jsonb_typeof(settings_json->'features')='object'
    AND octet_length(settings_json::text)<=8192
  ),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY(capability_id,capability_version),
  FOREIGN KEY(capability_id,capability_version)
    REFERENCES agent_capability_execution_manifests(capability_id,capability_version) ON DELETE RESTRICT,
  FOREIGN KEY(workflow_key,workflow_version)
    REFERENCES agent_workflow_definitions(workflow_key,workflow_version) ON DELETE RESTRICT,
  CHECK ((status='active' AND retired_at IS NULL) OR (status='retired' AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX agent_capability_host_bindings_active_workflow
  ON agent_capability_host_bindings(workflow_key,workflow_version) WHERE status='active';

CREATE FUNCTION guard_agent_capability_host_bindings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Capability host binding history cannot be deleted'; END IF;
  IF NEW.capability_id<>OLD.capability_id OR NEW.capability_version<>OLD.capability_version
    OR NEW.workflow_key<>OLD.workflow_key OR NEW.workflow_version<>OLD.workflow_version
    OR NEW.settings_json<>OLD.settings_json OR NEW.created_by_user_id<>OLD.created_by_user_id
    OR NEW.created_at<>OLD.created_at OR OLD.status='retired'
    OR (NEW.status<>OLD.status AND NOT (OLD.status='active' AND NEW.status='retired')) THEN
    RAISE EXCEPTION 'Capability host binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_capability_host_bindings_guard
  BEFORE UPDATE OR DELETE ON agent_capability_host_bindings
  FOR EACH ROW EXECUTE FUNCTION guard_agent_capability_host_bindings();

COMMIT;
