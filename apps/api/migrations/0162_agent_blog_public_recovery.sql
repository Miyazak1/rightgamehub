BEGIN;

CREATE TABLE agent_blog_public_requests (
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  trigger_kind text NOT NULL CHECK(trigger_kind IN ('manual','schedule')),
  trigger_ref text NOT NULL CHECK(char_length(trigger_ref) BETWEEN 1 AND 240),
  snapshot_json jsonb NOT NULL CHECK(jsonb_typeof(snapshot_json)='object' AND octet_length(snapshot_json::text)<=1048576),
  status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','running','completed','needs-review')),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  error_code text,
  safe_for_next boolean NOT NULL DEFAULT false,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agent_user_id,request_id),
  CHECK((status='running')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK((status='completed')=(result_json IS NOT NULL))
);
CREATE UNIQUE INDEX agent_blog_public_requests_one_owner ON agent_blog_public_requests(agent_user_id) WHERE status='running';
CREATE INDEX agent_blog_public_requests_due ON agent_blog_public_requests(agent_user_id,next_attempt_at) WHERE status='waiting';

CREATE TABLE agent_blog_public_network_requests (
  agent_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 43),
  action_id uuid NOT NULL REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agent_user_id,request_id,ordinal),
  FOREIGN KEY(agent_user_id,request_id) REFERENCES agent_blog_public_requests(agent_user_id,request_id) ON DELETE RESTRICT
);

CREATE FUNCTION guard_agent_blog_public_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'public request history cannot be deleted'; END IF;
  IF (NEW.agent_user_id,NEW.request_id,NEW.trigger_kind,NEW.trigger_ref,NEW.snapshot_json,NEW.created_at)
      IS DISTINCT FROM (OLD.agent_user_id,OLD.request_id,OLD.trigger_kind,OLD.trigger_ref,OLD.snapshot_json,OLD.created_at)
    OR (OLD.status='completed' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'public request checkpoint is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_blog_public_requests_guard BEFORE UPDATE OR DELETE ON agent_blog_public_requests
  FOR EACH ROW EXECUTE FUNCTION guard_agent_blog_public_request();

CREATE TABLE agent_blog_public_recovery_events (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  request_id uuid,
  event_type text NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION reject_agent_blog_public_recovery_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Public recovery events are immutable'; END $$;
CREATE TRIGGER agent_blog_public_recovery_events_immutable BEFORE UPDATE OR DELETE ON agent_blog_public_recovery_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_blog_public_recovery_event();
CREATE TRIGGER agent_blog_public_network_requests_immutable BEFORE UPDATE OR DELETE ON agent_blog_public_network_requests
  FOR EACH ROW EXECUTE FUNCTION reject_agent_blog_public_recovery_event();

-- Renewing/taking over an expired fire keeps its identity. Terminal history
-- remains immutable; any corrected interpretation is an appended recovery event.
CREATE OR REPLACE FUNCTION guard_agent_schedule_fire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent schedule fires cannot be deleted'; END IF;
  IF (NEW.id,NEW.schedule_id,NEW.agent_user_id,NEW.logical_fire_at,NEW.request_id,NEW.created_at,NEW.started_at)
      IS DISTINCT FROM (OLD.id,OLD.schedule_id,OLD.agent_user_id,OLD.logical_fire_at,OLD.request_id,OLD.created_at,OLD.started_at)
    OR OLD.status<>'running' OR NEW.status NOT IN ('running','succeeded','failed','uncertain') THEN
    RAISE EXCEPTION 'Agent schedule fire identity or terminal state is immutable';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
