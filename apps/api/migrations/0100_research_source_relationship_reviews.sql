BEGIN;

CREATE TABLE tool_research_source_relationship_reviews (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE RESTRICT,
  left_source_id uuid NOT NULL,
  right_source_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  relationship text NOT NULL CHECK (relationship IN (
    'same-publisher',
    'shared-origin',
    'organizationally-related',
    'editorially-independent',
    'unknown'
  )),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (left_source_id::text < right_source_id::text),
  UNIQUE(topic_id,left_source_id,right_source_id,revision),
  FOREIGN KEY(topic_id,left_source_id)
    REFERENCES tool_research_topic_sources(topic_id,source_id) ON DELETE RESTRICT,
  FOREIGN KEY(topic_id,right_source_id)
    REFERENCES tool_research_topic_sources(topic_id,source_id) ON DELETE RESTRICT
);

CREATE INDEX tool_research_source_relationship_reviews_topic_idx
  ON tool_research_source_relationship_reviews(topic_id,left_source_id,right_source_id,revision DESC);

CREATE FUNCTION protect_research_source_relationship_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research source relationship reviews are append-only';
END;
$$;

CREATE TRIGGER tool_research_source_relationship_reviews_no_update
  BEFORE UPDATE ON tool_research_source_relationship_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_relationship_review();

CREATE TRIGGER tool_research_source_relationship_reviews_no_delete
  BEFORE DELETE ON tool_research_source_relationship_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_relationship_review();

COMMIT;
