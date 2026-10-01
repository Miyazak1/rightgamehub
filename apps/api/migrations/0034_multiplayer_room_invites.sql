BEGIN;

CREATE TABLE multiplayer_room_invites (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES multiplayer_rooms(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claimed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
);

CREATE UNIQUE INDEX multiplayer_room_active_invite_idx
  ON multiplayer_room_invites(room_id)
  WHERE claimed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX multiplayer_room_invites_expiry_idx
  ON multiplayer_room_invites(expires_at)
  WHERE claimed_at IS NULL AND revoked_at IS NULL;

COMMIT;
