BEGIN;

CREATE TABLE multiplayer_game_modes (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  authority text NOT NULL CHECK (authority IN ('platform_authoritative','external_authoritative','relay_unverified')),
  min_players smallint NOT NULL CHECK (min_players BETWEEN 2 AND 8),
  max_players smallint NOT NULL CHECK (max_players BETWEEN 2 AND 8 AND max_players >= min_players),
  ruleset_version text NOT NULL CHECK (ruleset_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, key)
);

CREATE INDEX multiplayer_game_modes_work_enabled_idx ON multiplayer_game_modes(work_id, enabled);

CREATE TABLE multiplayer_rooms (
  id uuid PRIMARY KEY,
  mode_id uuid NOT NULL REFERENCES multiplayer_game_modes(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visibility text NOT NULL CHECK (visibility IN ('public','private','invite_only')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','starting','in_match','closed')),
  join_code_digest bytea,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 2 AND 8),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((visibility = 'invite_only') = (join_code_digest IS NOT NULL)),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE INDEX multiplayer_rooms_public_list_idx ON multiplayer_rooms(mode_id, created_at DESC, id) WHERE status='open' AND visibility='public';
CREATE INDEX multiplayer_rooms_expiry_idx ON multiplayer_rooms(expires_at) WHERE status='open';
CREATE INDEX multiplayer_rooms_owner_idx ON multiplayer_rooms(owner_user_id, status, updated_at DESC);

CREATE TABLE multiplayer_room_members (
  room_id uuid NOT NULL REFERENCES multiplayer_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat smallint NOT NULL CHECK (seat BETWEEN 0 AND 7),
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('player','spectator')),
  ready boolean NOT NULL DEFAULT false,
  connection_state text NOT NULL DEFAULT 'offline' CHECK (connection_state IN ('online','offline','grace')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (room_id, user_id)
);

CREATE UNIQUE INDEX multiplayer_room_active_seat_idx ON multiplayer_room_members(room_id, seat) WHERE left_at IS NULL AND role='player';
CREATE INDEX multiplayer_room_active_user_idx ON multiplayer_room_members(user_id, joined_at DESC) WHERE left_at IS NULL;
CREATE INDEX multiplayer_room_members_room_idx ON multiplayer_room_members(room_id, joined_at, user_id) WHERE left_at IS NULL;

COMMIT;
