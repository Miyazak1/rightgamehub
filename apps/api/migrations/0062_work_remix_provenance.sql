BEGIN;

ALTER TABLE works
  ADD COLUMN remix_source_work_id uuid REFERENCES works(id) ON DELETE RESTRICT,
  ADD COLUMN remix_note text CHECK (remix_note IS NULL OR char_length(remix_note) BETWEEN 10 AND 1000),
  ADD CONSTRAINT works_remix_source_pair_check CHECK (
    (remix_source_work_id IS NULL AND remix_note IS NULL)
    OR (remix_source_work_id IS NOT NULL AND remix_note IS NOT NULL)
  ),
  ADD CONSTRAINT works_remix_source_not_self_check CHECK (remix_source_work_id IS NULL OR remix_source_work_id <> id);

CREATE INDEX works_remix_source_idx
  ON works(remix_source_work_id, first_published_at DESC, id)
  WHERE remix_source_work_id IS NOT NULL;

CREATE TABLE work_remix_events (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('declared','updated','removed')),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_remix_events_work_idx ON work_remix_events(work_id, created_at, id);

CREATE FUNCTION reject_work_remix_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work remix events are append-only';
END;
$$;

CREATE TRIGGER work_remix_events_no_update BEFORE UPDATE ON work_remix_events
  FOR EACH ROW EXECUTE FUNCTION reject_work_remix_event_mutation();
CREATE TRIGGER work_remix_events_no_delete BEFORE DELETE ON work_remix_events
  FOR EACH ROW EXECUTE FUNCTION reject_work_remix_event_mutation();

COMMIT;
