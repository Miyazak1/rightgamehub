BEGIN;

ALTER TABLE tool_research_source_versions
  ADD COLUMN origin_run_id uuid REFERENCES tool_research_runs(id) ON DELETE SET NULL;

CREATE INDEX tool_research_source_versions_origin_run_idx
  ON tool_research_source_versions(origin_run_id,fetched_at,id)
  WHERE origin_run_id IS NOT NULL;

CREATE TABLE tool_research_news_materials (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE RESTRICT,
  source_version_id uuid NOT NULL REFERENCES tool_research_source_versions(id) ON DELETE RESTRICT,
  origin_run_id uuid NOT NULL REFERENCES tool_research_runs(id) ON DELETE RESTRICT,
  external_key text NOT NULL CHECK (external_key ~ '^[a-f0-9]{64}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  url text,
  published_at timestamptz,
  evidence_id uuid NOT NULL REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,external_key)
);

CREATE INDEX tool_research_news_materials_run_idx
  ON tool_research_news_materials(origin_run_id,created_at,id);

ALTER TABLE tool_research_claims
  DROP CONSTRAINT tool_research_claims_kind_check,
  ADD CONSTRAINT tool_research_claims_kind_check
    CHECK (kind IN ('fact','event','metric','claim','contradiction'));

ALTER TABLE tool_research_claim_revisions
  ADD COLUMN fact_json jsonb
  CHECK (fact_json IS NULL OR jsonb_typeof(fact_json)='object');

CREATE INDEX tool_research_claim_revisions_fact_dimension_idx
  ON tool_research_claim_revisions((fact_json->>'dimensionKey'),created_at DESC)
  WHERE fact_json IS NOT NULL;

COMMIT;
