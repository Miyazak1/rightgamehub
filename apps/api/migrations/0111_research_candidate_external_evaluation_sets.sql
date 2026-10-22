BEGIN;

ALTER TABLE tool_research_candidate_evaluation_datasets
  DROP CONSTRAINT tool_research_candidate_evaluation_datasets_sample_strategy_check,
  ADD COLUMN dataset_origin text NOT NULL DEFAULT 'internal-review'
    CHECK (dataset_origin IN ('internal-review','external-import')),
  ADD COLUMN coverage_report_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(coverage_report_json)='object' AND octet_length(coverage_report_json::text)<=32768),
  ADD CONSTRAINT tool_research_candidate_evaluation_datasets_sample_strategy_check
    CHECK (sample_strategy IN ('deterministic-stratified-v1','external-jsonl-v1'));

CREATE TABLE tool_research_candidate_evaluation_external_assignments (
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  external_case_key text NOT NULL CHECK (external_case_key ~ '^[a-f0-9]{64}$'),
  dataset_split text NOT NULL CHECK (dataset_split IN ('development','holdout')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic_id,external_case_key),
  UNIQUE(topic_id,external_case_key,dataset_split)
);

ALTER TABLE tool_research_candidate_evaluation_cases
  ALTER COLUMN discovery_id DROP NOT NULL,
  ALTER COLUMN human_assessment_id DROP NOT NULL,
  ADD COLUMN case_origin text NOT NULL DEFAULT 'internal-review'
    CHECK (case_origin IN ('internal-review','external-import')),
  ADD COLUMN external_id text CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 120),
  ADD COLUMN external_case_key text CHECK (external_case_key IS NULL OR external_case_key ~ '^[a-f0-9]{64}$'),
  ADD COLUMN reference_url text CHECK (reference_url IS NULL OR char_length(reference_url) BETWEEN 8 AND 2048),
  ADD COLUMN provenance_note text CHECK (provenance_note IS NULL OR char_length(provenance_note) BETWEEN 10 AND 1000),
  ADD CONSTRAINT tool_research_candidate_evaluation_case_origin_check CHECK (
    (case_origin='internal-review' AND discovery_id IS NOT NULL AND human_assessment_id IS NOT NULL AND external_case_key IS NULL)
    OR
    (case_origin='external-import' AND discovery_id IS NULL AND human_assessment_id IS NULL AND external_id IS NOT NULL AND external_case_key IS NOT NULL AND provenance_note IS NOT NULL)
  ),
  ADD CONSTRAINT tool_research_candidate_evaluation_external_assignment_fk
    FOREIGN KEY(topic_id,external_case_key,dataset_split)
    REFERENCES tool_research_candidate_evaluation_external_assignments(topic_id,external_case_key,dataset_split)
    ON DELETE RESTRICT;

CREATE INDEX tool_research_candidate_evaluation_cases_external_idx
  ON tool_research_candidate_evaluation_cases(topic_id,external_case_key)
  WHERE external_case_key IS NOT NULL;

CREATE UNIQUE INDEX tool_research_candidate_evaluation_cases_dataset_external_unique
  ON tool_research_candidate_evaluation_cases(dataset_id,external_case_key)
  WHERE external_case_key IS NOT NULL;

CREATE TRIGGER tool_research_candidate_evaluation_external_assignments_no_update
  BEFORE UPDATE OR DELETE ON tool_research_candidate_evaluation_external_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_research_candidate_evaluation_record();

COMMIT;
