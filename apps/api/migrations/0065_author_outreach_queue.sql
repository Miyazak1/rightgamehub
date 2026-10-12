BEGIN;

CREATE TABLE author_outreach_records (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL UNIQUE REFERENCES works(id) ON DELETE RESTRICT,
  repository_key text NOT NULL UNIQUE CHECK (repository_key ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
  repository_url text NOT NULL CHECK (repository_url ~ '^https://github\.com/[^/[:space:]]+/[^/[:space:]]+/?$'),
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review','ready','contacted','replied','declined','paused')),
  draft_subject text NOT NULL CHECK (char_length(draft_subject) BETWEEN 5 AND 120),
  draft_body text NOT NULL CHECK (char_length(draft_body) BETWEEN 40 AND 4000),
  contact_method text CHECK (contact_method IS NULL OR contact_method IN ('github_issue','github_discussion','email','other')),
  contact_reference text CHECK (contact_reference IS NULL OR char_length(contact_reference) BETWEEN 3 AND 2048),
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 3 AND 1000),
  last_contacted_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'contacted' OR contact_method IS NOT NULL AND contact_reference IS NOT NULL AND last_contacted_at IS NOT NULL)
);

CREATE INDEX author_outreach_status_idx ON author_outreach_records(status,updated_at DESC,id DESC);

CREATE TABLE author_outreach_events (
  id uuid PRIMARY KEY,
  outreach_id uuid NOT NULL REFERENCES author_outreach_records(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('discovered','updated','contacted','replied','declined','paused','reopened')),
  from_status text,
  to_status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX author_outreach_events_record_idx ON author_outreach_events(outreach_id,created_at DESC,id DESC);

CREATE FUNCTION reject_author_outreach_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'author outreach events are append-only';
END;
$$;

CREATE TRIGGER author_outreach_events_no_update BEFORE UPDATE ON author_outreach_events
  FOR EACH ROW EXECUTE FUNCTION reject_author_outreach_event_mutation();
CREATE TRIGGER author_outreach_events_no_delete BEFORE DELETE ON author_outreach_events
  FOR EACH ROW EXECUTE FUNCTION reject_author_outreach_event_mutation();

COMMIT;
