BEGIN;

CREATE TABLE tool_research_source_authority_reviews (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_tier text NOT NULL
    CHECK (previous_tier IN ('official-primary','official-implementation','institutional','independent-reputable','community','unknown')),
  decided_tier text NOT NULL
    CHECK (decided_tier IN ('official-primary','official-implementation','institutional','independent-reputable','community','unknown')),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 1000),
  basis text NOT NULL DEFAULT 'manual-review' CHECK (basis IN ('manual-review')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_research_source_authority_reviews_source_idx
  ON tool_research_source_authority_reviews(topic_id,source_id,created_at DESC,id DESC);

CREATE FUNCTION protect_research_source_authority_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research source authority reviews are append-only';
END $$;

CREATE TRIGGER tool_research_source_authority_review_immutable_update
  BEFORE UPDATE ON tool_research_source_authority_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_authority_review();

CREATE TRIGGER tool_research_source_authority_review_immutable_delete
  BEFORE DELETE ON tool_research_source_authority_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_authority_review();

COMMIT;
