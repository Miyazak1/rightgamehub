BEGIN;

ALTER TABLE tool_research_topic_sources
  ADD COLUMN status text NOT NULL DEFAULT 'candidate'
  CHECK (status IN ('candidate','tracked','rejected','muted')),
  ADD COLUMN activated_at timestamptz;

UPDATE tool_research_topic_sources ts
SET status=s.status,
    activated_at=CASE WHEN s.status IN ('tracked','muted') THEN ts.created_at ELSE NULL END
FROM tool_research_sources s
WHERE s.id=ts.source_id;

CREATE INDEX tool_research_topic_sources_status_idx
  ON tool_research_topic_sources(topic_id,status,created_at DESC,source_id);

CREATE FUNCTION set_research_watch_source_tracked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.watch_id IS NOT NULL THEN
    NEW.status := 'tracked';
  END IF;
  IF NEW.status = 'tracked' THEN
    NEW.activated_at := COALESCE(NEW.activated_at,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.activated_at ELSE NULL END,
      now());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.activated_at := COALESCE(OLD.activated_at,NEW.activated_at);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tool_research_topic_source_watch_status
  BEFORE INSERT OR UPDATE ON tool_research_topic_sources
  FOR EACH ROW EXECUTE FUNCTION set_research_watch_source_tracked();

CREATE TABLE tool_research_source_status_reviews (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_status text NOT NULL CHECK (previous_status IN ('candidate','tracked','rejected','muted')),
  decided_status text NOT NULL CHECK (decided_status IN ('tracked','rejected','muted')),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 1000),
  basis text NOT NULL DEFAULT 'manual-status-control' CHECK (basis IN ('manual-status-control')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_status <> decided_status)
);

CREATE INDEX tool_research_source_status_reviews_source_idx
  ON tool_research_source_status_reviews(source_id,created_at DESC,id DESC);

CREATE INDEX tool_research_source_status_reviews_topic_idx
  ON tool_research_source_status_reviews(topic_id,created_at DESC,id DESC);

CREATE TRIGGER tool_research_source_status_review_immutable_update
  BEFORE UPDATE ON tool_research_source_status_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_authority_review();

CREATE TRIGGER tool_research_source_status_review_immutable_delete
  BEFORE DELETE ON tool_research_source_status_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_authority_review();

COMMIT;
