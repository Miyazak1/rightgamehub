BEGIN;

ALTER TABLE analytics_events
  DROP CONSTRAINT analytics_events_host_kind_check;

ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_host_kind_check CHECK (host_kind IN (
    'browser','mcp-app','cursor','vscode','code','harness','codex','claude','opencode','unknown'
  ));

COMMIT;
