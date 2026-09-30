BEGIN;

CREATE TABLE multiplayer_admin_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  match_id uuid NOT NULL REFERENCES multiplayer_matches(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('abort')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX multiplayer_admin_events_created_idx ON multiplayer_admin_events(created_at DESC,id DESC);
CREATE INDEX multiplayer_admin_events_match_idx ON multiplayer_admin_events(match_id,created_at DESC);

CREATE FUNCTION reject_multiplayer_admin_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'multiplayer admin events are append-only';
END;
$$;

CREATE TRIGGER multiplayer_admin_events_no_update
  BEFORE UPDATE ON multiplayer_admin_events
  FOR EACH ROW EXECUTE FUNCTION reject_multiplayer_admin_event_mutation();
CREATE TRIGGER multiplayer_admin_events_no_delete
  BEFORE DELETE ON multiplayer_admin_events
  FOR EACH ROW EXECUTE FUNCTION reject_multiplayer_admin_event_mutation();

COMMIT;
