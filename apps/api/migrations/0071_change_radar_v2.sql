BEGIN;

ALTER TABLE tool_change_watches
  ADD COLUMN rule_type text NOT NULL DEFAULT 'any'
    CHECK (rule_type IN ('any','keyword_appears','keyword_disappears','number_changes')),
  ADD COLUMN rule_value text NOT NULL DEFAULT '' CHECK (char_length(rule_value) <= 200),
  ADD COLUMN ignore_noise boolean NOT NULL DEFAULT true;

ALTER TABLE tool_change_snapshots
  ADD COLUMN previous_snapshot_id uuid REFERENCES tool_change_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN diff_json jsonb NOT NULL DEFAULT '{"added":0,"removed":0,"modified":0,"changes":[],"omitted":0}'::jsonb,
  ADD COLUMN rule_matched boolean NOT NULL DEFAULT false,
  ADD COLUMN rule_reason text NOT NULL DEFAULT '',
  ADD COLUMN importance text NOT NULL DEFAULT 'routine' CHECK (importance IN ('important','routine')),
  ADD COLUMN is_read boolean NOT NULL DEFAULT false;

CREATE INDEX tool_change_snapshots_unread_idx
  ON tool_change_snapshots(watch_id,fetched_at DESC,id DESC)
  WHERE change_kind='changed' AND is_read=false;

COMMIT;
