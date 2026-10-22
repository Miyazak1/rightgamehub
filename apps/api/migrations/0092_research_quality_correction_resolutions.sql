BEGIN;

CREATE TABLE tool_research_quality_correction_resolutions (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE RESTRICT,
  sample_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('corrected','dismissed')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  replacement_target_id uuid,
  replacement_target_revision integer CHECK (replacement_target_revision IS NULL OR replacement_target_revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sample_id),
  FOREIGN KEY(topic_id,sample_id)
    REFERENCES tool_research_quality_samples(topic_id,id) ON DELETE RESTRICT,
  CHECK (
    (decision='corrected' AND replacement_target_id IS NOT NULL AND replacement_target_revision IS NOT NULL)
    OR
    (decision='dismissed' AND replacement_target_id IS NULL AND replacement_target_revision IS NULL)
  )
);

CREATE INDEX tool_research_quality_correction_resolutions_topic_idx
  ON tool_research_quality_correction_resolutions(topic_id,created_at,id);

CREATE FUNCTION protect_research_quality_correction_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research quality correction resolutions are append-only';
END;
$$;

CREATE TRIGGER tool_research_quality_correction_resolutions_no_update
  BEFORE UPDATE ON tool_research_quality_correction_resolutions
  FOR EACH ROW EXECUTE FUNCTION protect_research_quality_correction_resolution();

CREATE TRIGGER tool_research_quality_correction_resolutions_no_delete
  BEFORE DELETE ON tool_research_quality_correction_resolutions
  FOR EACH ROW EXECUTE FUNCTION protect_research_quality_correction_resolution();

COMMIT;
