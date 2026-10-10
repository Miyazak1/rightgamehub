BEGIN;

CREATE TABLE community_events (
  id uuid PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES community_projects(id) ON DELETE RESTRICT,
  work_id uuid REFERENCES works(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 10 AND 500),
  event_type text NOT NULL CHECK (event_type IN ('meetup','playtest','discussion','workshop','project_meeting')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 2 AND 200),
  meeting_url text CHECK (meeting_url IS NULL OR meeting_url ~ '^https://'),
  join_window_minutes smallint NOT NULL DEFAULT 60 CHECK (join_window_minutes BETWEEN 10 AND 1440),
  recording boolean NOT NULL DEFAULT false,
  code_of_conduct text NOT NULL CHECK (char_length(code_of_conduct) BETWEEN 10 AND 1000),
  cancellation_policy text NOT NULL CHECK (char_length(cancellation_policy) BETWEEN 10 AND 500),
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','cancelled','completed')),
  recap_post_id uuid REFERENCES community_posts(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  CHECK (ends_at > starts_at),
  CHECK ((state='cancelled')=(cancelled_at IS NOT NULL)),
  CHECK ((state='completed')=(completed_at IS NOT NULL))
);
CREATE INDEX community_events_upcoming_idx ON community_events(starts_at,id) WHERE state='scheduled';
CREATE INDEX community_events_host_idx ON community_events(host_id,starts_at DESC,id);
CREATE INDEX community_events_project_idx ON community_events(project_id,starts_at DESC,id) WHERE project_id IS NOT NULL;

CREATE TABLE community_event_attendees (
  event_id uuid NOT NULL REFERENCES community_events(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attendance_state text NOT NULL DEFAULT 'registered' CHECK (attendance_state IN ('registered','cancelled','attended')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  attended_at timestamptz,
  PRIMARY KEY(event_id,user_id),
  CHECK ((attendance_state='cancelled')=(cancelled_at IS NOT NULL)),
  CHECK ((attendance_state='attended')=(attended_at IS NOT NULL))
);
CREATE INDEX community_event_attendees_user_idx ON community_event_attendees(user_id,registered_at DESC,event_id);

CREATE TABLE community_event_audit (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES community_events(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created','updated','registered','registration_cancelled','cancelled','completed','recap_linked')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_event_audit_event_idx ON community_event_audit(event_id,created_at DESC,id DESC);

CREATE TABLE community_game_parties (
  id uuid PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  mode_id uuid REFERENCES multiplayer_game_modes(id) ON DELETE RESTRICT,
  room_id uuid REFERENCES multiplayer_rooms(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100),
  mode_label text NOT NULL CHECK (char_length(mode_label) BETWEEN 2 AND 80),
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 500),
  starts_at timestamptz NOT NULL,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 2 AND 8),
  room_mode text NOT NULL CHECK (room_mode IN ('gamehub','external')),
  external_instructions text CHECK (external_instructions IS NULL OR char_length(external_instructions) BETWEEN 10 AND 1000),
  state text NOT NULL DEFAULT 'recruiting' CHECK (state IN ('recruiting','full','ready','playing','ended','cancelled')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  cancelled_at timestamptz,
  CHECK ((room_mode='gamehub')=(mode_id IS NOT NULL)),
  CHECK ((room_mode='external')=(external_instructions IS NOT NULL)),
  CHECK (room_id IS NULL OR room_mode='gamehub'),
  CHECK ((state='ended')=(ended_at IS NOT NULL)),
  CHECK ((state='cancelled')=(cancelled_at IS NOT NULL))
);
CREATE INDEX community_game_parties_open_idx ON community_game_parties(starts_at,id) WHERE state IN ('recruiting','full','ready');
CREATE INDEX community_game_parties_host_idx ON community_game_parties(host_id,starts_at DESC,id);

CREATE TABLE community_game_party_members (
  party_id uuid NOT NULL REFERENCES community_game_parties(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  membership_state text NOT NULL DEFAULT 'active' CHECK (membership_state IN ('active','left')),
  ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY(party_id,user_id),
  CHECK ((membership_state='left')=(left_at IS NOT NULL))
);
CREATE INDEX community_game_party_members_user_idx ON community_game_party_members(user_id,joined_at DESC,party_id) WHERE membership_state='active';

CREATE TABLE community_participation_notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('event_reminder','event_cancelled','party_cancelled')),
  subject_kind text NOT NULL CHECK (subject_kind IN ('event','party')),
  subject_id uuid NOT NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 240),
  available_at timestamptz NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,kind,subject_id)
);
CREATE INDEX community_participation_notifications_inbox_idx ON community_participation_notifications(user_id,available_at DESC,id) WHERE read_at IS NULL;

CREATE TABLE community_game_party_audit (
  id uuid PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES community_game_parties(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created','joined','left','ready_changed','room_created','started','ended','cancelled')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_game_party_audit_party_idx ON community_game_party_audit(party_id,created_at DESC,id DESC);

CREATE FUNCTION reject_community_activity_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'community activity audit is append-only';
END;
$$;
CREATE TRIGGER community_event_audit_no_update BEFORE UPDATE ON community_event_audit FOR EACH ROW EXECUTE FUNCTION reject_community_activity_audit_mutation();
CREATE TRIGGER community_event_audit_no_delete BEFORE DELETE ON community_event_audit FOR EACH ROW EXECUTE FUNCTION reject_community_activity_audit_mutation();
CREATE TRIGGER community_game_party_audit_no_update BEFORE UPDATE ON community_game_party_audit FOR EACH ROW EXECUTE FUNCTION reject_community_activity_audit_mutation();
CREATE TRIGGER community_game_party_audit_no_delete BEFORE DELETE ON community_game_party_audit FOR EACH ROW EXECUTE FUNCTION reject_community_activity_audit_mutation();

COMMIT;
