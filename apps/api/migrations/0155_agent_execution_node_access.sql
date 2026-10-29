BEGIN;

-- F1.1 trusted-device access. Human device_grants remain the interactive
-- account-login boundary; execution nodes receive a separate, narrow grant
-- and never persist a normal user access or refresh token.
CREATE TABLE agent_execution_node_pairings (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  device_label text NOT NULL CHECK (char_length(device_label) BETWEEN 1 AND 120),
  node_kind text NOT NULL CHECK (node_kind IN ('desktop','browser')),
  platform text NOT NULL CHECK (platform IN ('web','windows-x64','windows-arm64','macos-x64','macos-arm64','linux-x64','linux-arm64')),
  permission_ceiling_json jsonb NOT NULL CHECK (jsonb_typeof(permission_ceiling_json)='object' AND octet_length(permission_ceiling_json::text)<=16384),
  pairing_code_hash bytea NOT NULL UNIQUE CHECK (octet_length(pairing_code_hash)=32),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','revoked')),
  expires_at timestamptz NOT NULL,
  claimed_node_id uuid REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='pending' AND claimed_node_id IS NULL AND claimed_at IS NULL AND revoked_at IS NULL)
    OR (status='claimed' AND claimed_node_id IS NOT NULL AND claimed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX agent_execution_node_pairings_owner_created
  ON agent_execution_node_pairings(owner_user_id,created_at DESC,id DESC);
CREATE INDEX agent_execution_node_pairings_pending_expiry
  ON agent_execution_node_pairings(expires_at) WHERE status='pending';

CREATE TABLE agent_execution_node_grants (
  id uuid PRIMARY KEY,
  node_id uuid NOT NULL REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pairing_id uuid REFERENCES agent_execution_node_pairings(id) ON DELETE RESTRICT,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['node:heartbeat','node:snapshot','packages:write','leases:claim']::text[]),
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at>authenticated_at)
);
CREATE INDEX agent_execution_node_grants_node_active
  ON agent_execution_node_grants(node_id,expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX agent_execution_node_grants_owner_active
  ON agent_execution_node_grants(owner_user_id,expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE agent_execution_node_access_tokens (
  id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES agent_execution_node_grants(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_execution_node_access_tokens_grant
  ON agent_execution_node_access_tokens(grant_id,expires_at DESC);

CREATE TABLE agent_execution_node_renewal_tokens (
  id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES agent_execution_node_grants(id) ON DELETE RESTRICT,
  family_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation>=0),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES agent_execution_node_renewal_tokens(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id,generation)
);
CREATE INDEX agent_execution_node_renewal_tokens_grant
  ON agent_execution_node_renewal_tokens(grant_id);
CREATE INDEX agent_execution_node_renewal_tokens_family
  ON agent_execution_node_renewal_tokens(family_id,generation DESC);

CREATE TABLE agent_execution_node_access_events (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  node_id uuid REFERENCES agent_execution_nodes(id) ON DELETE RESTRICT,
  grant_id uuid REFERENCES agent_execution_node_grants(id) ON DELETE RESTRICT,
  pairing_id uuid REFERENCES agent_execution_node_pairings(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('pairing-created','pairing-claimed','session-refreshed','session-revoked','node-revoked')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=16384),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_execution_node_access_events_owner_created
  ON agent_execution_node_access_events(owner_user_id,created_at DESC,id DESC);

CREATE FUNCTION guard_agent_execution_node_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='agent_execution_node_pairings' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution node pairing history cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.owner_user_id<>OLD.owner_user_id
      OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.device_label<>OLD.device_label
      OR NEW.node_kind<>OLD.node_kind OR NEW.platform<>OLD.platform
      OR NEW.permission_ceiling_json<>OLD.permission_ceiling_json
      OR NEW.pairing_code_hash<>OLD.pairing_code_hash OR NEW.expires_at<>OLD.expires_at
      OR NEW.created_at<>OLD.created_at THEN
      RAISE EXCEPTION 'Execution node pairing identity cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (OLD.status='pending' AND NEW.status IN ('claimed','revoked')) THEN
      RAISE EXCEPTION 'Invalid execution node pairing transition';
    END IF;
    IF NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 THEN
      RAISE EXCEPTION 'Invalid execution node pairing attempt transition';
    END IF;
  ELSIF TG_TABLE_NAME='agent_execution_node_grants' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution node grant history cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.node_id<>OLD.node_id OR NEW.owner_user_id<>OLD.owner_user_id
      OR NEW.pairing_id IS DISTINCT FROM OLD.pairing_id OR NEW.scopes<>OLD.scopes
      OR NEW.authenticated_at<>OLD.authenticated_at OR NEW.expires_at<>OLD.expires_at
      OR NEW.created_at<>OLD.created_at
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'Execution node grant identity cannot change';
    END IF;
  ELSIF TG_TABLE_NAME='agent_execution_node_access_events' THEN
    RAISE EXCEPTION 'Execution node access evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_execution_node_pairings_guard
  BEFORE UPDATE OR DELETE ON agent_execution_node_pairings
  FOR EACH ROW EXECUTE FUNCTION guard_agent_execution_node_access();
CREATE TRIGGER agent_execution_node_grants_guard
  BEFORE UPDATE OR DELETE ON agent_execution_node_grants
  FOR EACH ROW EXECUTE FUNCTION guard_agent_execution_node_access();
CREATE TRIGGER agent_execution_node_access_events_immutable
  BEFORE UPDATE OR DELETE ON agent_execution_node_access_events
  FOR EACH ROW EXECUTE FUNCTION guard_agent_execution_node_access();

COMMIT;
