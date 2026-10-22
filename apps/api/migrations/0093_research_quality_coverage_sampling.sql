BEGIN;

ALTER TABLE tool_research_quality_samples
  ADD COLUMN sample_kind text NOT NULL DEFAULT 'facts'
  CHECK (sample_kind IN ('facts','coverage'));

ALTER TABLE tool_research_quality_samples
  DROP CONSTRAINT tool_research_quality_samples_target_type_check;

ALTER TABLE tool_research_quality_samples
  ADD CONSTRAINT tool_research_quality_samples_target_type_check
  CHECK (target_type IN ('claim','metric-observation','source-version-diff'));

CREATE INDEX tool_research_quality_samples_kind_idx
  ON tool_research_quality_samples(topic_id,sample_kind,status,period_key,sampled_at,id);

COMMIT;
