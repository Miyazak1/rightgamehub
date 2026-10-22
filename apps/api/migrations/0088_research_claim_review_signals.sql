BEGIN;

CREATE TABLE tool_research_claim_review_signals (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES tool_research_claims(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  signal_type text NOT NULL CHECK (signal_type IN ('stale','revision-reopened','contradiction')),
  severity text NOT NULL CHECK (severity IN ('routine','important','critical')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  related_claim_id uuid REFERENCES tool_research_claims(id) ON DELETE RESTRICT,
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(claim_id,revision)
    REFERENCES tool_research_claim_revisions(claim_id,revision) ON DELETE CASCADE,
  UNIQUE(topic_id,dedupe_key),
  CHECK (related_claim_id IS NULL OR related_claim_id<>claim_id)
);

CREATE INDEX tool_research_claim_review_signals_topic_idx
  ON tool_research_claim_review_signals(topic_id,detected_at DESC,id DESC);

CREATE TABLE tool_research_claim_review_signal_resolutions (
  signal_id uuid PRIMARY KEY REFERENCES tool_research_claim_review_signals(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('acknowledged','dismissed','revalidated')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION protect_research_claim_review_signal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research claim review signals are append-only';
END;
$$;

CREATE TRIGGER tool_research_claim_review_signals_no_update
  BEFORE UPDATE ON tool_research_claim_review_signals
  FOR EACH ROW EXECUTE FUNCTION protect_research_claim_review_signal();
CREATE TRIGGER tool_research_claim_review_signals_no_delete
  BEFORE DELETE ON tool_research_claim_review_signals
  FOR EACH ROW EXECUTE FUNCTION protect_research_claim_review_signal();
CREATE TRIGGER tool_research_claim_review_signal_resolutions_no_update
  BEFORE UPDATE ON tool_research_claim_review_signal_resolutions
  FOR EACH ROW EXECUTE FUNCTION protect_research_claim_review_signal();
CREATE TRIGGER tool_research_claim_review_signal_resolutions_no_delete
  BEFORE DELETE ON tool_research_claim_review_signal_resolutions
  FOR EACH ROW EXECUTE FUNCTION protect_research_claim_review_signal();

COMMIT;
