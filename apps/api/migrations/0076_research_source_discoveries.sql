BEGIN;

CREATE TABLE tool_research_source_discoveries (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES tool_research_runs(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES tool_research_run_actions(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  query_text text NOT NULL CHECK (char_length(query_text) BETWEEN 1 AND 128),
  query_sha256 text NOT NULL CHECK (query_sha256 ~ '^[a-f0-9]{64}$'),
  result_rank integer NOT NULL CHECK (result_rank BETWEEN 1 AND 50),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  snippet text NOT NULL DEFAULT '' CHECK (char_length(snippet) <= 2000),
  rerank_score numeric(6,3) CHECK (rerank_score IS NULL OR rerank_score BETWEEN 0 AND 3),
  provider_authority integer CHECK (provider_authority IS NULL OR provider_authority BETWEEN -1 AND 4),
  published_at timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(action_id,source_id)
);

CREATE INDEX tool_research_source_discoveries_topic_idx
  ON tool_research_source_discoveries(topic_id,discovered_at DESC,id DESC);

CREATE TRIGGER tool_research_source_discovery_immutable
  BEFORE UPDATE ON tool_research_source_discoveries
  FOR EACH ROW EXECUTE FUNCTION protect_research_evidence_fact();

COMMIT;
