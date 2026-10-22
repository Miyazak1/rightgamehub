BEGIN;

CREATE INDEX tool_research_run_actions_recovery_idx
  ON tool_research_run_actions(reserved_at,run_id,id)
  WHERE status = 'reserved';

COMMIT;
