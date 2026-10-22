BEGIN;

CREATE TABLE tool_research_claim_reviews (
  id uuid PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES tool_research_claims(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('accepted','rejected')),
  from_status text NOT NULL CHECK (from_status IN ('candidate','accepted','rejected','superseded')),
  to_status text NOT NULL CHECK (to_status IN ('accepted','rejected')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(claim_id,revision)
    REFERENCES tool_research_claim_revisions(claim_id,revision) ON DELETE RESTRICT,
  CHECK (action=to_status)
);

CREATE INDEX tool_research_claim_reviews_claim_idx
  ON tool_research_claim_reviews(claim_id,created_at,id);

CREATE FUNCTION reject_research_claim_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research claim reviews are append-only';
END;
$$;

CREATE TRIGGER tool_research_claim_reviews_no_update
  BEFORE UPDATE ON tool_research_claim_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_research_claim_review_mutation();
CREATE TRIGGER tool_research_claim_reviews_no_delete
  BEFORE DELETE ON tool_research_claim_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_research_claim_review_mutation();

COMMIT;
