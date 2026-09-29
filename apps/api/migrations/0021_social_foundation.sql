BEGIN;

ALTER TABLE users
  ADD COLUMN bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 160),
  ADD COLUMN social_visibility text NOT NULL DEFAULT 'public' CHECK (social_visibility IN ('public','followers','private'));

CREATE TABLE user_follows (
  follower_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id,followed_user_id),
  CHECK (follower_user_id <> followed_user_id)
);

CREATE INDEX user_follows_followed_idx ON user_follows(followed_user_id,created_at DESC);

CREATE TABLE user_blocks (
  blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id,blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX user_blocks_blocked_idx ON user_blocks(blocked_user_id);

COMMIT;
