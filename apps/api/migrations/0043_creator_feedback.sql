BEGIN;

CREATE TABLE creator_feedback (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('bug','idea','compatibility','other')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 5 AND 160),
  details text NOT NULL CHECK (char_length(details) BETWEEN 10 AND 2000),
  reproduction_steps text NOT NULL DEFAULT '' CHECK (char_length(reproduction_steps) <= 2000),
  environment text NOT NULL DEFAULT '' CHECK (char_length(environment) <= 500),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','archived','issue_drafted','issue_linked')),
  issue_url text CHECK (issue_url IS NULL OR char_length(issue_url) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creator_feedback_reporter_rate_idx
  ON creator_feedback(reporter_user_id, work_id, created_at DESC);
CREATE INDEX creator_feedback_work_queue_idx
  ON creator_feedback(work_id, status, created_at DESC);

CREATE TABLE creator_feedback_events (
  id uuid PRIMARY KEY,
  feedback_id uuid NOT NULL REFERENCES creator_feedback(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('submitted','reviewed','archived','reopened','issue_drafted','issue_linked')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creator_feedback_events_feedback_idx
  ON creator_feedback_events(feedback_id, created_at ASC);

CREATE FUNCTION reject_creator_feedback_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'creator feedback events are append-only';
END;
$$;

CREATE TRIGGER creator_feedback_events_no_update
  BEFORE UPDATE ON creator_feedback_events
  FOR EACH ROW EXECUTE FUNCTION reject_creator_feedback_event_mutation();
CREATE TRIGGER creator_feedback_events_no_delete
  BEFORE DELETE ON creator_feedback_events
  FOR EACH ROW EXECUTE FUNCTION reject_creator_feedback_event_mutation();

COMMIT;
