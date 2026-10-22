BEGIN;

ALTER TABLE tool_research_source_discoveries
  ADD CONSTRAINT tool_research_source_discoveries_topic_id_id_unique UNIQUE(topic_id,id);

ALTER TABLE tool_research_candidate_assessments
  ADD CONSTRAINT tool_research_candidate_assessments_topic_discovery_id_unique UNIQUE(topic_id,discovery_id,id);

CREATE TABLE tool_research_candidate_evaluation_datasets (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  dataset_split text NOT NULL CHECK (dataset_split IN ('development','holdout')),
  sample_strategy text NOT NULL CHECK (sample_strategy='deterministic-stratified-v1'),
  sample_limit integer NOT NULL CHECK (sample_limit BETWEEN 1 AND 500),
  sample_count integer NOT NULL CHECK (sample_count BETWEEN 1 AND sample_limit),
  summary_json jsonb NOT NULL CHECK (jsonb_typeof(summary_json)='object' AND octet_length(summary_json::text)<=16384),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,dataset_split,content_sha256),
  UNIQUE(topic_id,id)
);

CREATE TABLE tool_research_candidate_evaluation_assignments (
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  discovery_id uuid NOT NULL,
  dataset_split text NOT NULL CHECK (dataset_split IN ('development','holdout')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic_id,discovery_id),
  UNIQUE(topic_id,discovery_id,dataset_split),
  FOREIGN KEY(topic_id,discovery_id)
    REFERENCES tool_research_source_discoveries(topic_id,id) ON DELETE RESTRICT
);

CREATE TABLE tool_research_candidate_evaluation_cases (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL,
  discovery_id uuid NOT NULL,
  dataset_split text NOT NULL CHECK (dataset_split IN ('development','holdout')),
  human_assessment_id uuid NOT NULL,
  gold_decision text NOT NULL CHECK (gold_decision IN ('relevant','irrelevant')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  snippet text NOT NULL DEFAULT '' CHECK (char_length(snippet)<=2000),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  publisher text CHECK (publisher IS NULL OR char_length(publisher)<=200),
  detected_language text NOT NULL CHECK (detected_language IN ('zh','en','mixed','undetermined')),
  source_label text NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 200),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dataset_id,discovery_id),
  FOREIGN KEY(topic_id,dataset_id)
    REFERENCES tool_research_candidate_evaluation_datasets(topic_id,id) ON DELETE CASCADE,
  FOREIGN KEY(topic_id,discovery_id,dataset_split)
    REFERENCES tool_research_candidate_evaluation_assignments(topic_id,discovery_id,dataset_split) ON DELETE RESTRICT,
  FOREIGN KEY(topic_id,discovery_id,human_assessment_id)
    REFERENCES tool_research_candidate_assessments(topic_id,discovery_id,id) ON DELETE RESTRICT
);

CREATE INDEX tool_research_candidate_evaluation_cases_dataset_idx
  ON tool_research_candidate_evaluation_cases(dataset_id,gold_decision,detected_language,source_label,id);

CREATE TABLE tool_research_candidate_evaluation_runs (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  dataset_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evaluation_key text NOT NULL CHECK (char_length(evaluation_key) BETWEEN 1 AND 120),
  dataset_sha256 text NOT NULL CHECK (dataset_sha256 ~ '^[a-f0-9]{64}$'),
  report_json jsonb NOT NULL CHECK (jsonb_typeof(report_json)='object' AND octet_length(report_json::text)<=65536),
  thresholds_json jsonb NOT NULL CHECK (jsonb_typeof(thresholds_json)='object' AND octet_length(thresholds_json::text)<=4096),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dataset_id,evaluation_key,input_sha256),
  FOREIGN KEY(topic_id,dataset_id)
    REFERENCES tool_research_candidate_evaluation_datasets(topic_id,id) ON DELETE CASCADE
);

CREATE INDEX tool_research_candidate_evaluation_runs_dataset_idx
  ON tool_research_candidate_evaluation_runs(dataset_id,created_at DESC,id DESC);

CREATE FUNCTION protect_research_candidate_evaluation_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research candidate evaluation records are immutable';
END;
$$;

CREATE TRIGGER tool_research_candidate_evaluation_datasets_no_update
  BEFORE UPDATE OR DELETE ON tool_research_candidate_evaluation_datasets
  FOR EACH ROW EXECUTE FUNCTION protect_research_candidate_evaluation_record();

CREATE TRIGGER tool_research_candidate_evaluation_assignments_no_update
  BEFORE UPDATE OR DELETE ON tool_research_candidate_evaluation_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_research_candidate_evaluation_record();

CREATE TRIGGER tool_research_candidate_evaluation_cases_no_update
  BEFORE UPDATE OR DELETE ON tool_research_candidate_evaluation_cases
  FOR EACH ROW EXECUTE FUNCTION protect_research_candidate_evaluation_record();

CREATE TRIGGER tool_research_candidate_evaluation_runs_no_update
  BEFORE UPDATE OR DELETE ON tool_research_candidate_evaluation_runs
  FOR EACH ROW EXECUTE FUNCTION protect_research_candidate_evaluation_record();

COMMIT;
