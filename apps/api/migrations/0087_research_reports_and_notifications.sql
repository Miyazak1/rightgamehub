BEGIN;

CREATE TABLE tool_research_reports (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES tool_research_runs(id) ON DELETE CASCADE,
  contract_version integer NOT NULL CHECK (contract_version > 0),
  report_kind text NOT NULL DEFAULT 'run-summary' CHECK (report_kind IN ('run-summary','weekly-summary','monthly-summary','calendar-week-summary','calendar-month-summary')),
  period_start_at timestamptz NOT NULL,
  period_end_at timestamptz NOT NULL,
  content_json jsonb NOT NULL CHECK (
    jsonb_typeof(content_json)='object'
    AND octet_length(content_json::text) <= 1048576
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(topic_id,contract_version)
    REFERENCES tool_research_topic_contracts(topic_id,version),
  UNIQUE(run_id,report_kind),
  UNIQUE(topic_id,report_kind,period_start_at,period_end_at),
  CHECK (period_end_at >= period_start_at)
);

CREATE INDEX tool_research_reports_topic_created_idx
  ON tool_research_reports(topic_id,created_at DESC,id DESC);

ALTER TABLE tool_research_events
  ADD COLUMN notification_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN notified_at timestamptz,
  ADD COLUMN read_at timestamptz;

CREATE INDEX tool_research_events_topic_unread_idx
  ON tool_research_events(topic_id,detected_at DESC,id DESC)
  WHERE notification_eligible=true AND read_at IS NULL;

CREATE FUNCTION protect_research_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research reports are immutable snapshots';
END $$;

CREATE TRIGGER tool_research_report_immutable
  BEFORE UPDATE OR DELETE ON tool_research_reports
  FOR EACH ROW EXECUTE FUNCTION protect_research_report();

COMMIT;
