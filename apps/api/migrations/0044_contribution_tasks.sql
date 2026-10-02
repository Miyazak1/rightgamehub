BEGIN;

CREATE TABLE contribution_tasks (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  feedback_id uuid REFERENCES creator_feedback(id) ON DELETE RESTRICT,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claimant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 20 AND 4000),
  difficulty text NOT NULL CHECK (difficulty IN ('starter','intermediate','advanced')),
  skills text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(skills) <= 8),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','claimed','submitted','completed','closed')),
  repository_url text CHECK (repository_url IS NULL OR char_length(repository_url) <= 2048),
  issue_url text CHECK (issue_url IS NULL OR char_length(issue_url) <= 2048),
  submission_url text CHECK (submission_url IS NULL OR char_length(submission_url) <= 2048),
  submission_note text NOT NULL DEFAULT '' CHECK (char_length(submission_note) <= 2000),
  published_at timestamptz,
  claimed_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feedback_id),
  CHECK ((status IN ('claimed','submitted','completed')) = (claimant_user_id IS NOT NULL)),
  CHECK (status NOT IN ('open','claimed','submitted','completed') OR published_at IS NOT NULL),
  CHECK (status NOT IN ('submitted','completed') OR (submission_url IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX contribution_tasks_public_queue_idx
  ON contribution_tasks(status, published_at DESC, id DESC);
CREATE INDEX contribution_tasks_author_idx
  ON contribution_tasks(author_user_id, updated_at DESC);
CREATE INDEX contribution_tasks_claimant_idx
  ON contribution_tasks(claimant_user_id, status, updated_at DESC)
  WHERE claimant_user_id IS NOT NULL;

CREATE TABLE contribution_task_events (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES contribution_tasks(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('draft_created','published','claimed','released','submitted','changes_requested','completed','closed','reopened','issue_drafted','issue_linked')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contribution_task_events_task_idx
  ON contribution_task_events(task_id, created_at ASC, id ASC);

CREATE FUNCTION reject_contribution_task_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'contribution task events are append-only';
END;
$$;

CREATE TRIGGER contribution_task_events_no_update
  BEFORE UPDATE ON contribution_task_events
  FOR EACH ROW EXECUTE FUNCTION reject_contribution_task_event_mutation();
CREATE TRIGGER contribution_task_events_no_delete
  BEFORE DELETE ON contribution_task_events
  FOR EACH ROW EXECUTE FUNCTION reject_contribution_task_event_mutation();

COMMIT;
