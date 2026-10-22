BEGIN;

CREATE INDEX tool_research_run_actions_monthly_budget_idx
  ON tool_research_run_actions(reserved_at,status,run_id);

COMMIT;
