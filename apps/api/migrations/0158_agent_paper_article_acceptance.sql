BEGIN;

-- R2.3 stores a content-free, immutable acceptance receipt for exactly three
-- real open-paper -> semantic-analysis -> private-draft samples.  It is an
-- operator gate only and grants no publication or scheduling authority.
CREATE TABLE agent_paper_article_acceptance_reports (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version=1),
  analysis_ids uuid[] NOT NULL CHECK (cardinality(analysis_ids)=3),
  draft_run_ids uuid[] NOT NULL CHECK (cardinality(draft_run_ids)=3),
  article_ids uuid[] NOT NULL CHECK (cardinality(article_ids)=3),
  verdict text NOT NULL CHECK (verdict IN ('passed','failed')),
  reason_codes text[] NOT NULL CHECK (cardinality(reason_codes)<=64),
  metrics_json jsonb NOT NULL CHECK (
    jsonb_typeof(metrics_json)='object' AND octet_length(metrics_json::text)<=32768
  ),
  evidence_json jsonb NOT NULL CHECK (
    jsonb_typeof(evidence_json)='object' AND octet_length(evidence_json::text)<=262144
  ),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  report_sha256 text NOT NULL CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,request_id,policy_version)
);

CREATE INDEX agent_paper_article_acceptance_agent_created
  ON agent_paper_article_acceptance_reports(agent_user_id,created_at DESC,id DESC);

CREATE TRIGGER agent_paper_article_acceptance_reports_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_article_acceptance_reports
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

COMMIT;
