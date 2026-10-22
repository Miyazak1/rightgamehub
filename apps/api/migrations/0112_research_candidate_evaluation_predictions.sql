BEGIN;

ALTER TABLE tool_research_candidate_evaluation_cases
  ADD CONSTRAINT tool_research_candidate_evaluation_cases_dataset_id_id_unique UNIQUE(dataset_id,id);

CREATE TABLE tool_research_candidate_evaluation_predictions (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL,
  case_id uuid NOT NULL,
  evaluation_key text NOT NULL CHECK (char_length(evaluation_key) BETWEEN 1 AND 120),
  evaluator_kind text NOT NULL CHECK (evaluator_kind IN ('rule','model')),
  model_decision text NOT NULL CHECK (model_decision IN ('relevant','needs-review','irrelevant')),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes)='array' AND octet_length(reason_codes::text)<=4096),
  dimension_scores jsonb NOT NULL CHECK (jsonb_typeof(dimension_scores)='object' AND octet_length(dimension_scores::text)<=4096),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 1000),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dataset_id,case_id,evaluation_key),
  FOREIGN KEY(topic_id,dataset_id)
    REFERENCES tool_research_candidate_evaluation_datasets(topic_id,id) ON DELETE CASCADE,
  FOREIGN KEY(dataset_id,case_id)
    REFERENCES tool_research_candidate_evaluation_cases(dataset_id,id) ON DELETE CASCADE
);

CREATE INDEX tool_research_candidate_evaluation_predictions_dataset_idx
  ON tool_research_candidate_evaluation_predictions(dataset_id,evaluation_key,model_decision,id);

CREATE TRIGGER tool_research_candidate_evaluation_predictions_no_update
  BEFORE UPDATE OR DELETE ON tool_research_candidate_evaluation_predictions
  FOR EACH ROW EXECUTE FUNCTION protect_research_candidate_evaluation_record();

COMMIT;
