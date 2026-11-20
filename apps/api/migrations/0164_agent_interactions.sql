BEGIN;

-- Channels refer to an existing Agent; no duplicate identity, model key,
-- article store, capability grant ledger or publishing schedule is introduced.
CREATE TABLE agent_channel_participants (
 agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
 channel text NOT NULL CHECK(channel IN ('web','qq')),
 actor_ref text NOT NULL CHECK(char_length(actor_ref) BETWEEN 1 AND 160),
 can_invoke boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(agent_user_id,channel,actor_ref)
);

CREATE TABLE agent_interactions (
 id uuid PRIMARY KEY,
 agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
 parent_id uuid REFERENCES agent_interactions(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('message','github-search','github-article')),
 channel text NOT NULL CHECK(channel IN ('web','qq')),
 actor_ref text NOT NULL CHECK(char_length(actor_ref) BETWEEN 1 AND 160),
 conversation_ref text NOT NULL CHECK(char_length(conversation_ref) BETWEEN 1 AND 200),
 event_ref text NOT NULL CHECK(char_length(event_ref) BETWEEN 1 AND 200),
 origin_json jsonb NOT NULL CHECK(jsonb_typeof(origin_json)='object'),
 input_json jsonb NOT NULL CHECK(jsonb_typeof(input_json)='object' AND octet_length(input_json::text)<=112000),
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','waiting','completed','failed','needs-review')),
 result_json jsonb CHECK(result_json IS NULL OR (jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=131072)),
 checkpoint_json jsonb CHECK(checkpoint_json IS NULL OR (jsonb_typeof(checkpoint_json)='object' AND octet_length(checkpoint_json::text)<=131072)),
 error_code text,
 run_id uuid REFERENCES agent_runs(id) ON DELETE RESTRICT,
 lease_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agent_user_id,channel,actor_ref,conversation_ref,event_ref,kind),
 CHECK((state='running')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((state='completed')=(result_json IS NOT NULL))
);
CREATE INDEX agent_interactions_due ON agent_interactions(agent_user_id,kind,next_attempt_at) WHERE state IN ('queued','waiting','running');
CREATE INDEX agent_interactions_conversation ON agent_interactions(agent_user_id,channel,actor_ref,conversation_ref,created_at);

CREATE FUNCTION guard_agent_interaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'agent interaction history cannot be deleted'; END IF;
 IF (NEW.id,NEW.agent_user_id,NEW.parent_id,NEW.kind,NEW.channel,NEW.actor_ref,NEW.conversation_ref,NEW.event_ref,NEW.origin_json,NEW.input_json,NEW.input_sha256,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.agent_user_id,OLD.parent_id,OLD.kind,OLD.channel,OLD.actor_ref,OLD.conversation_ref,OLD.event_ref,OLD.origin_json,OLD.input_json,OLD.input_sha256,OLD.created_at)
   OR (OLD.checkpoint_json IS NOT NULL AND NEW.checkpoint_json IS DISTINCT FROM OLD.checkpoint_json)
   OR (OLD.state='completed' AND NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION 'accepted agent interaction is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_interactions_guard BEFORE UPDATE OR DELETE ON agent_interactions FOR EACH ROW EXECUTE FUNCTION guard_agent_interaction();

CREATE TABLE agent_interaction_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 interaction_id uuid NOT NULL REFERENCES agent_interactions(id) ON DELETE RESTRICT,
 event_type text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object' AND octet_length(details::text)<=8192),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_channel_participant_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
 channel text NOT NULL, actor_ref text NOT NULL,
 revision integer NOT NULL, can_invoke boolean NOT NULL, status text NOT NULL,
 changed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION audit_agent_channel_participant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO agent_channel_participant_events(agent_user_id,channel,actor_ref,revision,can_invoke,status,changed_by_user_id)
 VALUES(NEW.agent_user_id,NEW.channel,NEW.actor_ref,NEW.revision,NEW.can_invoke,NEW.status,NEW.updated_by_user_id);
 RETURN NEW;
END $$;
CREATE TRIGGER agent_channel_participant_audit AFTER INSERT OR UPDATE ON agent_channel_participants FOR EACH ROW EXECUTE FUNCTION audit_agent_channel_participant();
CREATE FUNCTION guard_agent_interaction_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'agent interaction audit is append only'; END $$;
CREATE TRIGGER agent_channel_participant_events_guard BEFORE UPDATE OR DELETE ON agent_channel_participant_events FOR EACH ROW EXECUTE FUNCTION guard_agent_interaction_audit();
CREATE TRIGGER agent_interaction_events_guard BEFORE UPDATE OR DELETE ON agent_interaction_events FOR EACH ROW EXECUTE FUNCTION guard_agent_interaction_audit();
COMMIT;
