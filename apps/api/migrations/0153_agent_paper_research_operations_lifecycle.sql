BEGIN;

-- R1.10 keeps the existing Runtime as the execution source of truth. These
-- tables only persist derived operations state, alert episodes and reports.
CREATE TABLE agent_research_operations_policies (
  agent_user_id uuid PRIMARY KEY REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  worker_heartbeat_seconds integer NOT NULL DEFAULT 180 CHECK (worker_heartbeat_seconds BETWEEN 60 AND 3600),
  stale_stage_seconds integer NOT NULL DEFAULT 900 CHECK (stale_stage_seconds BETWEEN 300 AND 86400),
  oldest_backlog_seconds integer NOT NULL DEFAULT 21600 CHECK (oldest_backlog_seconds BETWEEN 900 AND 604800),
  metric_retention_days integer NOT NULL DEFAULT 90 CHECK (metric_retention_days BETWEEN 30 AND 730),
  weekly_report_enabled boolean NOT NULL DEFAULT true,
  email_notifications_enabled boolean NOT NULL DEFAULT false,
  weekly_report_weekday integer NOT NULL DEFAULT 1 CHECK (weekly_report_weekday BETWEEN 1 AND 7),
  weekly_report_local_time time NOT NULL DEFAULT '10:00',
  timezone text NOT NULL DEFAULT 'Asia/Shanghai' CHECK (char_length(timezone) BETWEEN 3 AND 64),
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_research_operation_alerts (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 3 AND 200),
  code text NOT NULL CHECK (char_length(code) BETWEEN 3 AND 160),
  severity text NOT NULL CHECK (severity IN ('degraded','blocked')),
  status text NOT NULL CHECK (status IN ('open','resolved')),
  occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context_json)='object' AND octet_length(context_json::text)<=32768),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK ((status='open' AND resolved_at IS NULL) OR (status='resolved' AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX agent_research_operation_alerts_open_fingerprint
  ON agent_research_operation_alerts(agent_user_id,fingerprint) WHERE status='open';
CREATE INDEX agent_research_operation_alerts_agent_seen
  ON agent_research_operation_alerts(agent_user_id,last_seen_at DESC,id DESC);

CREATE TABLE agent_research_operation_alert_events (
  id uuid PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES agent_research_operation_alerts(id) ON DELETE RESTRICT,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('opened','observed','resolved')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_research_operation_alert_events_agent_created
  ON agent_research_operation_alert_events(agent_user_id,created_at DESC,id DESC);

CREATE TABLE agent_research_metric_snapshots (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  health text NOT NULL CHECK (health IN ('ready','degraded','blocked')),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=262144),
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_research_metric_snapshots_agent_observed
  ON agent_research_metric_snapshots(agent_user_id,observed_at DESC,id DESC);

CREATE TABLE agent_research_weekly_reports (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  week_started_at timestamptz NOT NULL,
  week_ended_at timestamptz NOT NULL,
  report_json jsonb NOT NULL CHECK (jsonb_typeof(report_json)='object' AND octet_length(report_json::text)<=262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,week_started_at)
);
CREATE INDEX agent_research_weekly_reports_agent_created
  ON agent_research_weekly_reports(agent_user_id,created_at DESC,id DESC);

CREATE TABLE agent_research_operation_deliveries (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('alert.opened','alert.resolved','weekly-report')),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 3 AND 240),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=262144),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,dedupe_key)
);
CREATE INDEX agent_research_operation_deliveries_pending
  ON agent_research_operation_deliveries(next_attempt_at,id) WHERE status='pending';

CREATE TABLE agent_research_retention_runs (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  operator_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid,
  mode text NOT NULL CHECK (mode IN ('automatic','operator')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  cutoff_at timestamptz NOT NULL,
  deleted_metric_snapshots integer NOT NULL CHECK (deleted_metric_snapshots >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,request_id)
);
CREATE INDEX agent_research_retention_runs_agent_created
  ON agent_research_retention_runs(agent_user_id,created_at DESC,id DESC);

CREATE TRIGGER agent_research_operation_alert_events_immutable
  BEFORE UPDATE OR DELETE ON agent_research_operation_alert_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_research_weekly_reports_immutable
  BEFORE UPDATE OR DELETE ON agent_research_weekly_reports
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_research_retention_runs_immutable
  BEFORE UPDATE OR DELETE ON agent_research_retention_runs
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

COMMIT;
