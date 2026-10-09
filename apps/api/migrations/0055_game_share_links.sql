BEGIN;
ALTER TABLE game_sessions DROP CONSTRAINT game_sessions_capabilities_check;
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_capabilities_check CHECK (capabilities <@ ARRAY['identity','multiplayer','cloudSave','competition','fileExport','shareLinks']::text[]);
CREATE TABLE game_share_links (
  code_hash bytea PRIMARY KEY CHECK (octet_length(code_hash)=32),
  user_id uuid NOT NULL REFERENCES users(id), work_id uuid NOT NULL, release_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=24576),
  work_generation bigint NOT NULL, target_generation bigint NOT NULL, release_generation bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY(work_id,release_id) REFERENCES releases(work_id,id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
CREATE INDEX game_share_links_user_created ON game_share_links(user_id,created_at DESC);
CREATE INDEX game_share_links_expiry ON game_share_links(expires_at);
CREATE TABLE game_share_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_hash bytea NOT NULL CHECK(octet_length(code_hash)=32),
  user_id uuid NOT NULL REFERENCES users(id), work_id uuid NOT NULL REFERENCES works(id), release_id uuid NOT NULL REFERENCES releases(id),
  action text NOT NULL CHECK(action IN ('created','revoked')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(code_hash,action)
);
CREATE INDEX game_share_events_expiry ON game_share_events(created_at);
CREATE FUNCTION protect_game_share_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'game share identity and payload are immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER game_share_identity BEFORE UPDATE ON game_share_links FOR EACH ROW EXECUTE FUNCTION protect_game_share_identity();
CREATE FUNCTION protect_game_share_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.created_at<clock_timestamp()-interval '90 days' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'game share audit is immutable within retention';
END; $$;
CREATE TRIGGER game_share_event_immutable BEFORE UPDATE OR DELETE ON game_share_events FOR EACH ROW EXECUTE FUNCTION protect_game_share_event();
COMMIT;
