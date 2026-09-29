BEGIN;

CREATE TABLE user_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  follow_enabled boolean NOT NULL DEFAULT true,
  reaction_enabled boolean NOT NULL DEFAULT true,
  challenge_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
