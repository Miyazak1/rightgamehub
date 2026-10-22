BEGIN;

ALTER TABLE tool_research_metric_views
  DROP CONSTRAINT tool_research_metric_views_view_type_check;

ALTER TABLE tool_research_metric_views
  ADD CONSTRAINT tool_research_metric_views_view_type_check
  CHECK (view_type IN ('series','comparison','matrix'));

COMMIT;
