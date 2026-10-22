BEGIN;

ALTER TABLE tool_research_events
  ADD CONSTRAINT tool_research_events_topic_id_id_unique UNIQUE(topic_id,id);

CREATE TABLE tool_research_external_benchmark_cases (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  period_key text NOT NULL CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  occurred_at timestamptz NOT NULL,
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 8 AND 2048),
  source_kind text NOT NULL CHECK (source_kind IN ('external-audit','official-timeline','provider-export','user-curated')),
  importance text NOT NULL CHECK (importance IN ('routine','important','critical')),
  provenance_note text NOT NULL CHECK (char_length(provenance_note) BETWEEN 10 AND 1000),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','detected','missed','excluded')),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,input_sha256),
  UNIQUE(topic_id,id)
);

CREATE INDEX tool_research_external_benchmark_cases_topic_idx
  ON tool_research_external_benchmark_cases(topic_id,period_key,status,occurred_at DESC,id DESC);

CREATE TABLE tool_research_external_benchmark_reviews (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('detected','missed','excluded')),
  matched_event_id uuid,
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id),
  FOREIGN KEY(topic_id,case_id)
    REFERENCES tool_research_external_benchmark_cases(topic_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(topic_id,matched_event_id)
    REFERENCES tool_research_events(topic_id,id) ON DELETE RESTRICT,
  CHECK ((decision='detected' AND matched_event_id IS NOT NULL) OR (decision IN ('missed','excluded') AND matched_event_id IS NULL))
);

CREATE INDEX tool_research_external_benchmark_reviews_topic_idx
  ON tool_research_external_benchmark_reviews(topic_id,created_at DESC,id DESC);

CREATE FUNCTION guard_research_external_benchmark_case_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'reviewed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'reviewed_at') THEN
    RAISE EXCEPTION 'research external benchmark case identity is immutable';
  END IF;
  IF OLD.status<>'pending' OR NEW.status NOT IN ('detected','missed','excluded') OR NEW.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'research external benchmark case transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tool_research_external_benchmark_cases_update_guard
  BEFORE UPDATE ON tool_research_external_benchmark_cases
  FOR EACH ROW EXECUTE FUNCTION guard_research_external_benchmark_case_update();

CREATE FUNCTION protect_research_external_benchmark_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research external benchmark reviews are append-only';
END;
$$;

CREATE TRIGGER tool_research_external_benchmark_reviews_no_update
  BEFORE UPDATE ON tool_research_external_benchmark_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_external_benchmark_review();

CREATE TRIGGER tool_research_external_benchmark_reviews_no_delete
  BEFORE DELETE ON tool_research_external_benchmark_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_external_benchmark_review();

COMMIT;
