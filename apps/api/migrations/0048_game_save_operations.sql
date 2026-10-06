BEGIN;

ALTER TABLE game_save_policies ADD COLUMN writes_paused boolean NOT NULL DEFAULT false;
ALTER TABLE game_save_policies ADD COLUMN control_version bigint NOT NULL DEFAULT 0 CHECK (control_version >= 0);

CREATE FUNCTION bump_game_save_policy_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.control_version:=OLD.control_version+1; RETURN NEW; END;
$$;
CREATE TRIGGER game_save_policy_control BEFORE UPDATE ON game_save_policies
  FOR EACH ROW EXECUTE FUNCTION bump_game_save_policy_control();

-- Logical retained payload bytes only. This is not a measurement of free PG disk or WAL.
CREATE TABLE game_save_capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  retained_bytes bigint NOT NULL CHECK (retained_bytes >= 0),
  max_payload_bytes bigint NOT NULL DEFAULT 5368709120 CHECK (max_payload_bytes BETWEEN 1 AND 5368709120),
  writes_paused boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
INSERT INTO game_save_capacity(singleton,retained_bytes)
  SELECT true,COALESCE(sum(octet_length(payload_inline)),0) FROM game_save_payloads;
CREATE FUNCTION count_game_save_payload_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE game_save_capacity SET retained_bytes=retained_bytes+octet_length(NEW.payload_inline)
      WHERE singleton AND NOT writes_paused AND retained_bytes+octet_length(NEW.payload_inline)<=max_payload_bytes;
    IF NOT FOUND THEN RAISE EXCEPTION 'save payload capacity closed' USING ERRCODE='P7501'; END IF;
    RETURN NEW;
  END IF;
  UPDATE game_save_capacity SET retained_bytes=retained_bytes-octet_length(OLD.payload_inline) WHERE singleton;
  RETURN OLD;
END;
$$;
CREATE TRIGGER game_save_payload_bytes AFTER INSERT OR DELETE ON game_save_payloads
  FOR EACH ROW EXECUTE FUNCTION count_game_save_payload_bytes();

CREATE TABLE game_save_admin_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  grant_id uuid NOT NULL REFERENCES device_grants(id),
  operation_id uuid NOT NULL,
  request_digest bytea NOT NULL CHECK (octet_length(request_digest)=32),
  action text NOT NULL CHECK (action IN ('policy_pause','capacity','inspect','repair','cleanup')),
  work_id uuid REFERENCES works(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state)='object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_user_id,operation_id)
);
CREATE TRIGGER game_save_admin_event_immutable BEFORE UPDATE OR DELETE ON game_save_admin_events
  FOR EACH ROW EXECUTE FUNCTION immutable_game_save_fact();
CREATE INDEX game_save_admin_events_recent ON game_save_admin_events(created_at DESC,id);
CREATE INDEX game_save_usage_work_page ON game_save_usage(work_id,user_id,channel);
CREATE INDEX game_save_policies_work_page ON game_save_policies(work_id);

-- No player, device, session or slot identifiers in health telemetry.
CREATE TABLE game_save_health_buckets (
  hour timestamptz NOT NULL,
  work_id uuid NOT NULL REFERENCES works(id),
  channel text NOT NULL CHECK (channel IN ('production','preview')),
  operation text NOT NULL CHECK (operation IN ('read','write','delete','restore','receipt')),
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 80),
  latency_bucket integer NOT NULL CHECK (latency_bucket IN (10,50,100,250,500,1000,3000,10000,60000,60001)),
  count bigint NOT NULL CHECK (count > 0),
  PRIMARY KEY(hour,work_id,channel,operation,code,latency_bucket)
);
CREATE INDEX game_save_health_work_hour ON game_save_health_buckets(work_id,hour);
COMMIT;
