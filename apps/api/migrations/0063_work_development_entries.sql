BEGIN;

CREATE TABLE work_development_entries (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entry_kind text NOT NULL CHECK (entry_kind IN ('update','release_notes','milestone')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 20 AND 4000),
  release_id uuid,
  publication_state text NOT NULL DEFAULT 'draft' CHECK (publication_state IN ('draft','published','withdrawn')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (work_id,release_id) REFERENCES releases(work_id,id) ON DELETE RESTRICT,
  CHECK (
    (publication_state='draft' AND published_at IS NULL AND withdrawn_at IS NULL)
    OR (publication_state='published' AND published_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (publication_state='withdrawn' AND published_at IS NOT NULL AND withdrawn_at IS NOT NULL)
  )
);

CREATE INDEX work_development_entries_public_idx
  ON work_development_entries(work_id,published_at DESC,id DESC)
  WHERE publication_state='published';
CREATE INDEX work_development_entries_author_idx
  ON work_development_entries(author_user_id,updated_at DESC,id DESC);

CREATE TABLE work_development_entry_events (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES work_development_entries(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('draft_created','edited','published','withdrawn')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_development_entry_events_entry_idx
  ON work_development_entry_events(entry_id,created_at,id);

CREATE FUNCTION reject_work_development_entry_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work development entry events are append-only';
END;
$$;

CREATE TRIGGER work_development_entry_events_no_update BEFORE UPDATE ON work_development_entry_events
  FOR EACH ROW EXECUTE FUNCTION reject_work_development_entry_event_mutation();
CREATE TRIGGER work_development_entry_events_no_delete BEFORE DELETE ON work_development_entry_events
  FOR EACH ROW EXECUTE FUNCTION reject_work_development_entry_event_mutation();

COMMIT;
