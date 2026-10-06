BEGIN;

CREATE TABLE game_save_user_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  grant_id uuid NOT NULL REFERENCES device_grants(id),
  slot_id uuid NOT NULL REFERENCES game_save_slots(id),
  revision_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('export','restore')),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(slot_id,revision_id) REFERENCES game_save_revisions(slot_id,id)
);
CREATE UNIQUE INDEX game_save_user_restore_once ON game_save_user_events(slot_id,revision_id) WHERE action='restore';
CREATE INDEX game_save_user_events_owner ON game_save_user_events(user_id,created_at DESC);
CREATE INDEX game_save_slots_owner_page ON game_save_slots(user_id,id);
CREATE TRIGGER game_save_user_event_immutable BEFORE UPDATE OR DELETE ON game_save_user_events FOR EACH ROW EXECUTE FUNCTION immutable_game_save_fact();

COMMIT;
