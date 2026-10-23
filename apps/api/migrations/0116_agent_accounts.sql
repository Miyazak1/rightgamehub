BEGIN;

ALTER TABLE users ADD COLUMN account_type text NOT NULL DEFAULT 'human' CHECK (account_type IN ('human','agent'));
ALTER TABLE users ADD CONSTRAINT users_agent_no_publish CHECK (account_type='human' OR (can_publish=false AND role='user'));
CREATE TABLE agent_accounts (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 provision_key text NOT NULL UNIQUE CHECK (char_length(provision_key) BETWEEN 8 AND 100),
 provision_digest text NOT NULL CHECK (provision_digest ~ '^[a-f0-9]{64}$'),
 operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 badge_label text NOT NULL CHECK (badge_label IN ('AI 助手','官方机器人')),
 operator_label text NOT NULL CHECK (char_length(btrim(operator_label)) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 capabilities text[] NOT NULL DEFAULT '{}' CHECK (capabilities <@ ARRAY['research:qa']::text[]),
 metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=4096),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_execution_principals (
 id uuid PRIMARY KEY, agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
 key_id text NOT NULL UNIQUE CHECK (key_id ~ '^[a-zA-Z0-9_-]{8,100}$'),
 verifier_hash bytea NOT NULL UNIQUE CHECK (octet_length(verifier_hash)=32),
 rotation_key text NOT NULL UNIQUE CHECK (char_length(rotation_key) BETWEEN 8 AND 100),
 rotation_digest text NOT NULL CHECK (rotation_digest ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
 capabilities text[] NOT NULL DEFAULT '{}' CHECK (capabilities <@ ARRAY['research:qa']::text[]),
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, last_used_at timestamptz,
 CHECK ((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)),
 UNIQUE(agent_user_id,id)
);
CREATE UNIQUE INDEX agent_one_active_principal ON agent_execution_principals(agent_user_id) WHERE status='active';
CREATE TABLE agent_account_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
 principal_id uuid REFERENCES agent_execution_principals(id) ON DELETE RESTRICT,
 operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK (action IN ('provision','suspend','rotate','revoke')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION agent_accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
 IF TG_TABLE_NAME='users' THEN
  IF NEW.account_type<>OLD.account_type THEN RAISE EXCEPTION 'Account type is immutable'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent identity records cannot be deleted'; END IF;
 IF TG_TABLE_NAME='agent_accounts' THEN
  SELECT account_type INTO kind FROM users WHERE id=NEW.user_id FOR SHARE;
  IF kind IS DISTINCT FROM 'agent' THEN RAISE EXCEPTION 'Agent user required'; END IF;
  IF TG_OP='UPDATE' AND (NEW.user_id<>OLD.user_id OR NEW.provision_key<>OLD.provision_key OR NEW.provision_digest<>OLD.provision_digest
    OR NEW.operator_user_id<>OLD.operator_user_id OR NEW.badge_label<>OLD.badge_label OR NEW.operator_label<>OLD.operator_label
    OR NEW.capabilities<>OLD.capabilities OR NEW.metadata<>OLD.metadata OR NEW.created_at<>OLD.created_at
    OR (OLD.status='suspended' AND NEW.status<>'suspended')) THEN RAISE EXCEPTION 'Agent disclosure and scope are immutable'; END IF;
 ELSIF TG_TABLE_NAME='agent_execution_principals' AND TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.agent_user_id<>OLD.agent_user_id OR NEW.key_id<>OLD.key_id OR NEW.verifier_hash<>OLD.verifier_hash
   OR NEW.rotation_key<>OLD.rotation_key OR NEW.rotation_digest<>OLD.rotation_digest OR NEW.capabilities<>OLD.capabilities
   OR NEW.created_at<>OLD.created_at OR (OLD.status='revoked' AND NEW IS DISTINCT FROM OLD)
   OR NEW.last_used_at<OLD.last_used_at THEN RAISE EXCEPTION 'Execution principal cannot rebind or reactivate'; END IF;
 ELSIF TG_TABLE_NAME='agent_account_events' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Agent audit is append only';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER users_account_type_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION agent_accounts_guard();
CREATE TRIGGER agent_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON agent_accounts FOR EACH ROW EXECUTE FUNCTION agent_accounts_guard();
CREATE TRIGGER agent_principals_guard BEFORE UPDATE OR DELETE ON agent_execution_principals FOR EACH ROW EXECUTE FUNCTION agent_accounts_guard();
CREATE TRIGGER agent_events_guard BEFORE UPDATE OR DELETE ON agent_account_events FOR EACH ROW EXECUTE FUNCTION agent_accounts_guard();
CREATE FUNCTION agent_requires_disclosure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.account_type='agent' AND NOT EXISTS(SELECT 1 FROM agent_accounts WHERE user_id=NEW.id) THEN RAISE EXCEPTION 'Agent disclosure required'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER users_agent_disclosure AFTER INSERT ON users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_requires_disclosure();
CREATE FUNCTION human_auth_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
 SELECT account_type INTO kind FROM users WHERE id=NEW.user_id FOR SHARE;
 IF kind IS DISTINCT FROM 'human' THEN RAISE EXCEPTION 'Interactive authentication requires human user'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER auth_identities_human_only BEFORE INSERT OR UPDATE OF user_id ON auth_identities FOR EACH ROW EXECUTE FUNCTION human_auth_only();
CREATE TRIGGER device_grants_human_only BEFORE INSERT OR UPDATE OF user_id ON device_grants FOR EACH ROW EXECUTE FUNCTION human_auth_only();

-- QA agent binding: also applied to isolated per-case QA tables by the test fixture.
ALTER TABLE research_qa_questions ADD COLUMN agent_user_id uuid REFERENCES agent_accounts(user_id) ON DELETE RESTRICT;
ALTER TABLE research_qa_questions ADD COLUMN execution_principal_id uuid;
ALTER TABLE research_qa_questions ADD CONSTRAINT qa_execution_agent_fk FOREIGN KEY(agent_user_id,execution_principal_id) REFERENCES agent_execution_principals(agent_user_id,id) ON DELETE RESTRICT;
ALTER TABLE research_qa_questions ADD CONSTRAINT qa_real_agent_binding CHECK (
 (agent_user_id IS NULL AND execution_principal_id IS NULL) OR
 (agent_user_id IS NOT NULL AND execution_principal_id IS NOT NULL AND scope_json->'binding'->>'agentAccountId'=agent_user_id::text AND scope_json->'binding'->>'executionPrincipalId'=execution_principal_id::text) IS TRUE);
CREATE FUNCTION research_qa_agent_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.agent_user_id IS DISTINCT FROM OLD.agent_user_id OR NEW.execution_principal_id IS DISTINCT FROM OLD.execution_principal_id THEN RAISE EXCEPTION 'QA agent identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER research_qa_agent_binding_guard BEFORE UPDATE ON research_qa_questions FOR EACH ROW EXECUTE FUNCTION research_qa_agent_binding_guard();

COMMIT;
