ALTER TABLE mooyu_qq.messages ADD COLUMN IF NOT EXISTS origin_group_id text;
CREATE TABLE IF NOT EXISTS mooyu_qq.control_settings (
 channel_id text PRIMARY KEY REFERENCES mooyu_qq.settings(channel_id),
 bootstrap_hash text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 login_revision integer NOT NULL DEFAULT 1 CHECK(login_revision>0),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mooyu_qq.control_requests (
 channel_id text NOT NULL REFERENCES mooyu_qq.settings(channel_id), request_id uuid NOT NULL,
 digest text NOT NULL, operation text NOT NULL CHECK(operation IN ('configure','refresh')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(channel_id,request_id)
);
