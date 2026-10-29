BEGIN;

CREATE TABLE agent_editorial_memory_events (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'project-featured','project-compared','comparison-used','topic-used','claim-stated','scenario-used'
  )),
  subject_kind text NOT NULL CHECK (subject_kind IN ('project','comparison','topic','claim','scenario')),
  subject_key text NOT NULL CHECK (char_length(subject_key) BETWEEN 3 AND 512),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  article_id uuid NOT NULL REFERENCES blog_articles(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES blog_article_revisions(id) ON DELETE RESTRICT,
  research_source_version_id uuid REFERENCES tool_research_source_versions(id) ON DELETE RESTRICT,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,event_type,subject_key,revision_id)
);

CREATE INDEX agent_editorial_memory_events_subject
  ON agent_editorial_memory_events(agent_user_id,subject_kind,subject_key,occurred_at DESC,id DESC);

CREATE TABLE agent_editorial_memory_subjects (
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  subject_kind text NOT NULL CHECK (subject_kind IN ('project','comparison','topic','claim','scenario')),
  subject_key text NOT NULL CHECK (char_length(subject_key) BETWEEN 3 AND 512),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrence_count integer NOT NULL CHECK (occurrence_count>=1),
  editorial_role text CHECK (editorial_role IS NULL OR editorial_role IN ('main','comparison','topic','claim','scenario')),
  permanent_main_exclusion boolean NOT NULL DEFAULT false,
  cooldown_until timestamptz,
  latest_event_id uuid NOT NULL REFERENCES agent_editorial_memory_events(id) ON DELETE RESTRICT,
  latest_revision_id uuid NOT NULL REFERENCES blog_article_revisions(id) ON DELETE RESTRICT,
  latest_payload_json jsonb NOT NULL CHECK (
    jsonb_typeof(latest_payload_json)='object' AND octet_length(latest_payload_json::text)<=32768
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agent_user_id,subject_kind,subject_key),
  CHECK (last_seen_at>=first_seen_at)
);

CREATE INDEX agent_editorial_memory_subjects_gate
  ON agent_editorial_memory_subjects(agent_user_id,subject_kind,permanent_main_exclusion,cooldown_until,last_seen_at DESC);

CREATE FUNCTION guard_agent_editorial_memory_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent editorial memory events are immutable';
END;
$$;

CREATE TRIGGER agent_editorial_memory_events_immutable
  BEFORE UPDATE OR DELETE ON agent_editorial_memory_events
  FOR EACH ROW EXECUTE FUNCTION guard_agent_editorial_memory_events();

CREATE FUNCTION guard_agent_editorial_memory_subject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent editorial memory subjects cannot be deleted';
END;
$$;

CREATE TRIGGER agent_editorial_memory_subjects_no_delete
  BEFORE DELETE ON agent_editorial_memory_subjects
  FOR EACH ROW EXECUTE FUNCTION guard_agent_editorial_memory_subject_delete();

COMMIT;
