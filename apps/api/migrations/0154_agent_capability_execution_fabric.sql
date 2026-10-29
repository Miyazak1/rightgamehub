BEGIN;

-- F1 capability fabric: the existing Agent Runtime remains the task and stage
-- source of truth. These tables describe where a stage may run, what a node
-- has installed, and the immutable decision/evidence produced by placement.
CREATE TABLE agent_capability_execution_manifests (
  capability_id text NOT NULL CHECK (capability_id ~ '^[a-z0-9]+([.:-][a-z0-9]+)*$' AND char_length(capability_id)<=160),
  capability_version text NOT NULL CHECK (capability_version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][a-zA-Z0-9.-]+)?$' AND char_length(capability_version)<=64),
  contract_key text NOT NULL CHECK (contract_key ~ '^[a-z][a-z0-9.-]{2,119}$'),
  contract_version integer NOT NULL CHECK (contract_version > 0),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  manifest_json jsonb NOT NULL CHECK (jsonb_typeof(manifest_json)='object' AND octet_length(manifest_json::text)<=65536),
  manifest_sha256 text NOT NULL UNIQUE CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  PRIMARY KEY (capability_id,capability_version),
  CHECK ((status='draft' AND activated_at IS NULL AND retired_at IS NULL)
    OR (status='active' AND activated_at IS NOT NULL AND retired_at IS NULL)
    OR (status='retired' AND retired_at IS NOT NULL))
);
CREATE INDEX agent_capability_execution_manifests_status
  ON agent_capability_execution_manifests(status,capability_id,capability_version);

CREATE TABLE agent_execution_nodes (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  node_kind text NOT NULL CHECK (node_kind IN ('browser','desktop','cloud')),
  platform text NOT NULL CHECK (platform IN ('web','windows-x64','windows-arm64','macos-x64','macos-arm64',
    'linux-x64','linux-arm64','server-linux-x64','server-linux-arm64')),
  device_key_sha256 text NOT NULL CHECK (device_key_sha256 ~ '^[a-f0-9]{64}$'),
  runtime_version text NOT NULL CHECK (runtime_version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][a-zA-Z0-9.-]+)?$'),
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline','revoked')),
  resource_json jsonb NOT NULL CHECK (jsonb_typeof(resource_json)='object' AND octet_length(resource_json::text)<=16384),
  permission_ceiling_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permission_ceiling_json)='object' AND octet_length(permission_ceiling_json::text)<=16384),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json)='object' AND octet_length(metadata_json::text)<=16384),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,device_key_sha256),
  CHECK ((status='revoked' AND revoked_at IS NOT NULL) OR (status<>'revoked' AND revoked_at IS NULL))
);
CREATE INDEX agent_execution_nodes_owner_liveness
  ON agent_execution_nodes(owner_user_id,status,last_seen_at DESC,id);

CREATE TABLE agent_execution_node_capabilities (
  node_id uuid NOT NULL REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  package_sha256 text CHECK (package_sha256 IS NULL OR package_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('downloading','installed','ready','failed','removed')),
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code)<=160),
  installed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id,capability_id,capability_version),
  FOREIGN KEY (capability_id,capability_version)
    REFERENCES agent_capability_execution_manifests(capability_id,capability_version) ON DELETE RESTRICT,
  CHECK ((status IN ('installed','ready') AND installed_at IS NOT NULL)
    OR (status NOT IN ('installed','ready')))
);
CREATE INDEX agent_execution_node_capabilities_ready
  ON agent_execution_node_capabilities(capability_id,capability_version,node_id) WHERE status='ready';

CREATE TABLE agent_capability_package_receipts (
  id uuid PRIMARY KEY,
  node_id uuid NOT NULL REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN ('download-started','download-completed','signature-verified','install-ready','install-failed','removed')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (capability_id,capability_version)
    REFERENCES agent_capability_execution_manifests(capability_id,capability_version) ON DELETE RESTRICT
);
CREATE INDEX agent_capability_package_receipts_node_created
  ON agent_capability_package_receipts(node_id,created_at DESC,id DESC);

CREATE TABLE agent_stage_placement_decisions (
  id uuid PRIMARY KEY,
  stage_id uuid NOT NULL REFERENCES agent_run_stages(id) ON DELETE RESTRICT,
  stage_attempt integer NOT NULL CHECK (stage_attempt >= 0),
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  node_id uuid REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  target text CHECK (target IS NULL OR target IN ('browser','desktop','cloud')),
  decision_status text NOT NULL CHECK (decision_status IN ('ready','download-required','waiting-for-user','consent-required','waiting-for-device','unavailable')),
  decision_json jsonb NOT NULL CHECK (jsonb_typeof(decision_json)='object' AND octet_length(decision_json::text)<=32768),
  decision_sha256 text NOT NULL CHECK (decision_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (capability_id,capability_version)
    REFERENCES agent_capability_execution_manifests(capability_id,capability_version) ON DELETE RESTRICT,
  UNIQUE(stage_id,stage_attempt),
  CHECK ((decision_status IN ('ready','download-required') AND node_id IS NOT NULL AND target IS NOT NULL)
    OR (decision_status NOT IN ('ready','download-required')))
);
CREATE INDEX agent_stage_placement_decisions_capability_created
  ON agent_stage_placement_decisions(capability_id,capability_version,created_at DESC,id DESC);

CREATE FUNCTION guard_agent_capability_execution_fabric() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='agent_capability_execution_manifests' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Capability execution manifest cannot be deleted'; END IF;
    IF NEW.capability_id<>OLD.capability_id OR NEW.capability_version<>OLD.capability_version
      OR NEW.contract_key<>OLD.contract_key OR NEW.contract_version<>OLD.contract_version
      OR NEW.schema_version<>OLD.schema_version OR NEW.manifest_json<>OLD.manifest_json
      OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.created_by_user_id<>OLD.created_by_user_id
      OR NEW.created_at<>OLD.created_at THEN
      RAISE EXCEPTION 'Capability execution manifest identity cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status IN ('active','retired'))
      OR (OLD.status='active' AND NEW.status='retired')) THEN
      RAISE EXCEPTION 'Invalid capability execution manifest state transition';
    END IF;
  ELSIF TG_TABLE_NAME='agent_execution_nodes' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution node history cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.node_kind<>OLD.node_kind
      OR NEW.platform<>OLD.platform OR NEW.device_key_sha256<>OLD.device_key_sha256
      OR NEW.created_at<>OLD.created_at OR OLD.status='revoked' THEN
      RAISE EXCEPTION 'Execution node identity or revoked state cannot change';
    END IF;
  ELSIF TG_TABLE_NAME='agent_execution_node_capabilities' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution node capability history cannot be deleted'; END IF;
    IF NEW.node_id<>OLD.node_id OR NEW.capability_id<>OLD.capability_id
      OR NEW.capability_version<>OLD.capability_version THEN
      RAISE EXCEPTION 'Execution node capability identity cannot change';
    END IF;
    IF NEW.package_sha256 IS DISTINCT FROM OLD.package_sha256
      AND NOT (OLD.status IN ('failed','removed') AND NEW.status='downloading') THEN
      RAISE EXCEPTION 'Execution node capability package cannot change in place';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='downloading' AND NEW.status IN ('installed','failed','removed'))
      OR (OLD.status='installed' AND NEW.status IN ('ready','failed','removed'))
      OR (OLD.status='ready' AND NEW.status IN ('failed','removed'))
      OR (OLD.status IN ('failed','removed') AND NEW.status='downloading')) THEN
      RAISE EXCEPTION 'Invalid execution node capability state transition';
    END IF;
  ELSIF TG_TABLE_NAME IN ('agent_capability_package_receipts','agent_stage_placement_decisions') THEN
    RAISE EXCEPTION 'Capability execution evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_capability_execution_manifests_guard
  BEFORE UPDATE OR DELETE ON agent_capability_execution_manifests
  FOR EACH ROW EXECUTE FUNCTION guard_agent_capability_execution_fabric();
CREATE TRIGGER agent_execution_nodes_guard
  BEFORE UPDATE OR DELETE ON agent_execution_nodes
  FOR EACH ROW EXECUTE FUNCTION guard_agent_capability_execution_fabric();
CREATE TRIGGER agent_execution_node_capabilities_guard
  BEFORE UPDATE OR DELETE ON agent_execution_node_capabilities
  FOR EACH ROW EXECUTE FUNCTION guard_agent_capability_execution_fabric();
CREATE TRIGGER agent_capability_package_receipts_immutable
  BEFORE UPDATE OR DELETE ON agent_capability_package_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_agent_capability_execution_fabric();
CREATE TRIGGER agent_stage_placement_decisions_immutable
  BEFORE UPDATE OR DELETE ON agent_stage_placement_decisions
  FOR EACH ROW EXECUTE FUNCTION guard_agent_capability_execution_fabric();

COMMIT;
