CREATE SCHEMA IF NOT EXISTS mooyu_qq;
CREATE TABLE IF NOT EXISTS mooyu_qq.settings (
 channel_id text PRIMARY KEY, policy_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mooyu_qq.messages (
 channel_id text NOT NULL REFERENCES mooyu_qq.settings(channel_id), message_id text NOT NULL,
 user_id text NOT NULL, input_text text NOT NULL CHECK(octet_length(input_text)<=4000), fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','generating','ready','sending','delivered','needs-review','failed')),
 reply text CHECK(octet_length(reply)<=12000), remote_message_id text, attempt_count integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now(), error_code text, run_token uuid, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(channel_id,message_id),
 CHECK(status NOT IN ('ready','sending','delivered','needs-review') OR reply IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS qq_pending ON mooyu_qq.messages(channel_id,status,next_at,created_at);
CREATE TABLE IF NOT EXISTS mooyu_qq.attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, channel_id text NOT NULL, message_id text NOT NULL,
 user_id text NOT NULL, attempt_no integer NOT NULL, reserved_tokens integer NOT NULL CHECK(reserved_tokens>0),
 actual_tokens integer, provider_request_id text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(channel_id,message_id) REFERENCES mooyu_qq.messages(channel_id,message_id),
 UNIQUE(channel_id,message_id,attempt_no)
);
CREATE INDEX IF NOT EXISTS qq_daily_budget ON mooyu_qq.attempts(channel_id,created_at);
CREATE TABLE IF NOT EXISTS mooyu_qq.events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, channel_id text NOT NULL, message_id text,
 event_type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(details)='object' AND octet_length(details::text)<=4096)
);
CREATE UNIQUE INDEX IF NOT EXISTS qq_id_conflict_once ON mooyu_qq.events(channel_id,message_id) WHERE event_type='id-conflict';
CREATE OR REPLACE FUNCTION mooyu_qq.audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'QQ audit is append only'; END; $$;
DROP TRIGGER IF EXISTS qq_audit_guard ON mooyu_qq.events;
CREATE TRIGGER qq_audit_guard BEFORE UPDATE OR DELETE ON mooyu_qq.events FOR EACH ROW EXECUTE FUNCTION mooyu_qq.audit_guard();
