BEGIN;

CREATE TABLE challenge_participations (
  challenge_id uuid PRIMARY KEY REFERENCES game_challenges(id) ON DELETE CASCADE,
  participant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  participant_outcome text CHECK (participant_outcome IS NULL OR participant_outcome IN ('win','loss','draw'))
);

CREATE INDEX challenge_participations_user_idx ON challenge_participations(participant_user_id,accepted_at DESC);

ALTER TABLE social_notifications DROP CONSTRAINT social_notifications_type_check;
ALTER TABLE social_notifications DROP CONSTRAINT social_notifications_check1;
ALTER TABLE social_notifications ADD COLUMN challenge_id uuid REFERENCES game_challenges(id) ON DELETE CASCADE;
ALTER TABLE social_notifications ADD CONSTRAINT social_notifications_type_check CHECK (type IN ('follow','reaction','challenge_complete'));
ALTER TABLE social_notifications ADD CONSTRAINT social_notifications_payload_check CHECK (
  (type='follow' AND puzzle_date IS NULL AND reaction IS NULL AND challenge_id IS NULL) OR
  (type='reaction' AND puzzle_date IS NOT NULL AND reaction IS NOT NULL AND challenge_id IS NULL) OR
  (type='challenge_complete' AND puzzle_date IS NOT NULL AND reaction IS NULL AND challenge_id IS NOT NULL)
);
CREATE UNIQUE INDEX social_notifications_challenge_once_idx ON social_notifications(recipient_user_id,actor_user_id,challenge_id) WHERE type='challenge_complete';

COMMIT;
