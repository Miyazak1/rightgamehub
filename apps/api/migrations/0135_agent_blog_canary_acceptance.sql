BEGIN;

ALTER TABLE agent_run_handoffs
  ADD CONSTRAINT agent_run_handoffs_acceptance_identity
  UNIQUE(id,agent_user_id,source_run_id,target_run_id);

CREATE TABLE agent_blog_canary_acceptance_reports (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL,
  discovery_run_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  draft_run_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version BETWEEN 1 AND 2147483647),
  verdict text NOT NULL CHECK (verdict IN ('passed','failed')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  policy_json jsonb NOT NULL CHECK (jsonb_typeof(policy_json)='object' AND octet_length(policy_json::text)<=16384),
  metrics_json jsonb NOT NULL CHECK (jsonb_typeof(metrics_json)='object' AND octet_length(metrics_json::text)<=32768),
  evidence_json jsonb NOT NULL CHECK (jsonb_typeof(evidence_json)='object' AND octet_length(evidence_json::text)<=65536),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  report_sha256 text NOT NULL UNIQUE CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(handoff_id,agent_user_id,discovery_run_id,draft_run_id)
    REFERENCES agent_run_handoffs(id,agent_user_id,source_run_id,target_run_id) ON DELETE RESTRICT,
  FOREIGN KEY(discovery_run_id,agent_user_id) REFERENCES agent_runs(id,agent_user_id) ON DELETE RESTRICT,
  FOREIGN KEY(draft_run_id,agent_user_id) REFERENCES agent_runs(id,agent_user_id) ON DELETE RESTRICT,
  UNIQUE(draft_run_id,policy_version),
  CHECK ((verdict='passed' AND cardinality(reason_codes)=0)
    OR (verdict='failed' AND cardinality(reason_codes)>0)),
  CHECK (reason_codes<@ARRAY[
    'RUN_GRAPH_INVALID','DISCOVERY_NOT_SUCCEEDED','DRAFT_NOT_SUCCEEDED',
    'STAGE_COUNT_INVALID','STAGE_NOT_SUCCEEDED','STAGE_RETRY_OBSERVED',
    'ACTION_NOT_SUCCEEDED','PUBLISH_AUTHORITY_OBSERVED','DRAFT_NOT_PRIVATE',
    'DRAFT_LINEAGE_INCOMPLETE','PROVIDER_CALL_COUNT_INVALID','TOOL_CALL_COUNT_INVALID',
    'BUDGET_EXCEEDED','WALL_CLOCK_EXCEEDED'
  ]::text[])
);

CREATE INDEX agent_blog_canary_acceptance_history
  ON agent_blog_canary_acceptance_reports(agent_user_id,created_at DESC,id DESC);

CREATE FUNCTION reject_agent_blog_canary_acceptance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent blog canary acceptance reports are immutable';
END;
$$;

CREATE TRIGGER agent_blog_canary_acceptance_reports_immutable
  BEFORE UPDATE OR DELETE ON agent_blog_canary_acceptance_reports
  FOR EACH ROW EXECUTE FUNCTION reject_agent_blog_canary_acceptance_mutation();

COMMIT;
