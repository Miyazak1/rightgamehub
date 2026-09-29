BEGIN;

CREATE TABLE creator_applications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  statement text NOT NULL CHECK (char_length(statement) BETWEEN 20 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (
    (status = 'pending' AND review_note IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR
    (status <> 'pending' AND review_note IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX creator_applications_one_pending_per_user_idx
  ON creator_applications(user_id) WHERE status = 'pending';
CREATE INDEX creator_applications_review_queue_idx
  ON creator_applications(status, created_at, id);
CREATE INDEX creator_applications_user_history_idx
  ON creator_applications(user_id, created_at DESC);

COMMIT;
