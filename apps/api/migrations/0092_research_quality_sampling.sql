BEGIN;

CREATE TABLE tool_research_quality_samples (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  period_key text NOT NULL CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target_type text NOT NULL CHECK (target_type IN ('claim','metric-observation')),
  target_id uuid NOT NULL,
  target_revision integer NOT NULL CHECK (target_revision>0),
  selection_hash text NOT NULL CHECK (selection_hash ~ '^[a-f0-9]{64}$'),
  target_snapshot jsonb NOT NULL CHECK (jsonb_typeof(target_snapshot)='object' AND octet_length(target_snapshot::text)<=16384),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','passed','failed')),
  sampled_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE(topic_id,period_key,target_type,target_id,target_revision),
  UNIQUE(topic_id,id)
);

CREATE INDEX tool_research_quality_samples_topic_idx
  ON tool_research_quality_samples(topic_id,status,period_key,sampled_at,id);

CREATE TABLE tool_research_quality_sample_reviews (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE RESTRICT,
  sample_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('pass','fail')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  correction_gap_id uuid REFERENCES tool_research_gaps(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sample_id),
  FOREIGN KEY(topic_id,sample_id)
    REFERENCES tool_research_quality_samples(topic_id,id) ON DELETE RESTRICT,
  CHECK ((decision='pass' AND correction_gap_id IS NULL) OR (decision='fail' AND correction_gap_id IS NOT NULL))
);

CREATE INDEX tool_research_quality_sample_reviews_topic_idx
  ON tool_research_quality_sample_reviews(topic_id,created_at,id);

CREATE FUNCTION guard_research_quality_sample_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'reviewed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'reviewed_at') THEN
    RAISE EXCEPTION 'research quality sample identity is immutable';
  END IF;
  IF OLD.status<>'pending' OR NEW.status NOT IN ('passed','failed') OR NEW.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'research quality sample transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tool_research_quality_samples_update_guard
  BEFORE UPDATE ON tool_research_quality_samples
  FOR EACH ROW EXECUTE FUNCTION guard_research_quality_sample_update();

CREATE FUNCTION protect_research_quality_sample_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research quality sample reviews are append-only';
END;
$$;

CREATE TRIGGER tool_research_quality_sample_reviews_no_update
  BEFORE UPDATE ON tool_research_quality_sample_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_quality_sample_review();

CREATE TRIGGER tool_research_quality_sample_reviews_no_delete
  BEFORE DELETE ON tool_research_quality_sample_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_quality_sample_review();

COMMIT;
