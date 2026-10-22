BEGIN;

CREATE TABLE tool_research_candidate_assessments (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  discovery_id uuid NOT NULL REFERENCES tool_research_source_discoveries(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_stage text NOT NULL
    CHECK (assessment_stage IN ('prefilter','value','manual-review')),
  decision text NOT NULL
    CHECK (decision IN ('relevant','irrelevant','needs-review')),
  evaluator_kind text NOT NULL
    CHECK (evaluator_kind IN ('rule','model','human')),
  evaluation_key text NOT NULL CHECK (char_length(evaluation_key) BETWEEN 1 AND 120),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes)<=20),
  dimension_scores jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(dimension_scores)='object' AND octet_length(dimension_scores::text)<=4096),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 1000),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(discovery_id,evaluation_key,input_sha256)
);

CREATE INDEX tool_research_candidate_assessments_topic_idx
  ON tool_research_candidate_assessments(topic_id,created_at DESC,id DESC);

CREATE INDEX tool_research_candidate_assessments_discovery_idx
  ON tool_research_candidate_assessments(discovery_id,created_at DESC,id DESC);

CREATE TRIGGER tool_research_candidate_assessment_immutable_update
  BEFORE UPDATE ON tool_research_candidate_assessments
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_authority_review();

CREATE TRIGGER tool_research_candidate_assessment_immutable_delete
  BEFORE DELETE ON tool_research_candidate_assessments
  FOR EACH ROW EXECUTE FUNCTION protect_research_source_authority_review();

COMMIT;
