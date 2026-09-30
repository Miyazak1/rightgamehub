BEGIN;

CREATE TABLE multiplayer_matches (
  id uuid PRIMARY KEY,
  room_id uuid UNIQUE REFERENCES multiplayer_rooms(id) ON DELETE RESTRICT,
  mode_id uuid NOT NULL REFERENCES multiplayer_game_modes(id) ON DELETE RESTRICT,
  ruleset_version text NOT NULL CHECK (ruleset_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  status text NOT NULL CHECK (status IN ('pending','active','finishing','completed','aborted')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_event_seq bigint NOT NULL DEFAULT 1 CHECK (next_event_seq >= 1),
  turn_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  turn_deadline_at timestamptz,
  seed_hash bytea NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  termination_reason text CHECK (termination_reason IS NULL OR termination_reason IN ('normal','resignation','timeout','disconnect','admin_abort','adapter_error')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('active','finishing','completed') OR started_at IS NOT NULL),
  CHECK ((status IN ('completed','aborted')) = (ended_at IS NOT NULL))
);

CREATE INDEX multiplayer_matches_mode_status_idx ON multiplayer_matches(mode_id,status,updated_at DESC);
CREATE INDEX multiplayer_matches_turn_deadline_idx ON multiplayer_matches(turn_deadline_at) WHERE status='active';
CREATE INDEX multiplayer_matches_ended_idx ON multiplayer_matches(ended_at DESC) WHERE ended_at IS NOT NULL;

CREATE TABLE multiplayer_match_players (
  match_id uuid NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat smallint NOT NULL CHECK (seat BETWEEN 0 AND 7),
  team smallint,
  result text CHECK (result IS NULL OR result IN ('win','loss','draw','none')),
  rating_before integer,
  rating_after integer,
  connected_at timestamptz,
  disconnected_at timestamptz,
  PRIMARY KEY (match_id,user_id),
  UNIQUE (match_id,seat)
);

CREATE INDEX multiplayer_match_players_user_idx ON multiplayer_match_players(user_id,match_id);

CREATE TABLE multiplayer_match_events (
  match_id uuid NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  seq bigint NOT NULL CHECK (seq >= 1),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  command_id uuid,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id,seq)
);

CREATE UNIQUE INDEX multiplayer_match_command_unique ON multiplayer_match_events(match_id,command_id) WHERE command_id IS NOT NULL;
CREATE INDEX multiplayer_match_events_actor_idx ON multiplayer_match_events(actor_user_id,created_at DESC) WHERE actor_user_id IS NOT NULL;

CREATE TABLE multiplayer_match_snapshots (
  match_id uuid NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  event_seq bigint NOT NULL CHECK (event_seq >= 1),
  ruleset_version text NOT NULL,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  public_state jsonb NOT NULL CHECK (jsonb_typeof(public_state) = 'object'),
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id,event_seq),
  FOREIGN KEY (match_id,event_seq) REFERENCES multiplayer_match_events(match_id,seq) ON DELETE CASCADE
);

COMMIT;
