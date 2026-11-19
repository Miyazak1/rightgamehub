BEGIN;
ALTER TABLE agent_account_events DROP CONSTRAINT agent_account_events_action_check;
ALTER TABLE agent_account_events ADD CONSTRAINT agent_account_events_action_check
  CHECK(action IN ('provision','suspend','rotate','revoke','avatar-upload','avatar-reset'));
ALTER TABLE agent_account_events ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{}'
  CHECK(jsonb_typeof(metadata_json)='object' AND octet_length(metadata_json::text)<=4096);
COMMIT;
