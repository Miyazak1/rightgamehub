BEGIN;

CREATE TABLE guess_baike_reactions (
  reactor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL,
  puzzle_date date NOT NULL,
  reaction text NOT NULL CHECK (reaction IN ('gg','spark','wow','coffee')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reactor_user_id,target_user_id,puzzle_date),
  FOREIGN KEY (target_user_id,puzzle_date) REFERENCES guess_baike_results(user_id,puzzle_date) ON DELETE CASCADE,
  CHECK (reactor_user_id <> target_user_id)
);

CREATE INDEX guess_baike_reactions_target_idx ON guess_baike_reactions(target_user_id,puzzle_date);

CREATE TABLE social_notifications (
  id uuid PRIMARY KEY,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('follow','reaction')),
  puzzle_date date,
  reaction text CHECK (reaction IS NULL OR reaction IN ('gg','spark','wow','coffee')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recipient_user_id <> actor_user_id),
  CHECK ((type='follow' AND puzzle_date IS NULL AND reaction IS NULL) OR (type='reaction' AND puzzle_date IS NOT NULL AND reaction IS NOT NULL))
);

CREATE INDEX social_notifications_recipient_idx ON social_notifications(recipient_user_id,created_at DESC);
CREATE UNIQUE INDEX social_notifications_reaction_once_idx ON social_notifications(recipient_user_id,actor_user_id,puzzle_date) WHERE type='reaction';

CREATE TABLE game_challenges (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{10,24}$'),
  creator_user_id uuid NOT NULL,
  puzzle_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (creator_user_id,puzzle_date) REFERENCES guess_baike_results(user_id,puzzle_date) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX game_challenges_expiry_idx ON game_challenges(expires_at);

COMMIT;
