BEGIN;

ALTER TABLE tool_research_run_actions
  DROP CONSTRAINT tool_research_run_actions_action_kind_check;

ALTER TABLE tool_research_run_actions
  ADD CONSTRAINT tool_research_run_actions_action_kind_check
  CHECK (action_kind IN ('url-archive','feed-fetch','github-fetch','search','researcher','candidate-assess'));

COMMIT;
