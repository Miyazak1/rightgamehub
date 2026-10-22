BEGIN;

ALTER TABLE tool_research_runs
  ADD COLUMN source_admissions_frozen_at timestamptz;

CREATE TABLE tool_research_run_sources (
  run_id uuid NOT NULL REFERENCES tool_research_runs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('http','rss','github','search','pdf','api')),
  authority_tier text NOT NULL
    CHECK (authority_tier IN ('official-primary','official-implementation','institutional','independent-reputable','community','unknown')),
  decision text NOT NULL CHECK (decision IN ('eligible','skipped')),
  reason text NOT NULL CHECK (reason IN ('eligible','authority-below-minimum','type-not-allowed')),
  minimum_authority_tier text NOT NULL
    CHECK (minimum_authority_tier IN ('official-primary','official-implementation','institutional','independent-reputable','community','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,source_id)
);

CREATE INDEX tool_research_run_sources_decision_idx
  ON tool_research_run_sources(run_id,decision,source_type,source_id);

CREATE FUNCTION protect_research_run_source_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research run source admissions are immutable';
END $$;

CREATE TRIGGER tool_research_run_source_admission_immutable_update
  BEFORE UPDATE ON tool_research_run_sources
  FOR EACH ROW EXECUTE FUNCTION protect_research_run_source_admission();

CREATE TRIGGER tool_research_run_source_admission_immutable_delete
  BEFORE DELETE ON tool_research_run_sources
  FOR EACH ROW EXECUTE FUNCTION protect_research_run_source_admission();

COMMIT;
