BEGIN;

CREATE TABLE content_reports (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('unsafe','malware','harassment','copyright','other')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution_action text CHECK (resolution_action IN ('suspend','dismiss')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  CHECK ((status = 'open' AND resolution_action IS NULL AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status <> 'open' AND resolution_action IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);

CREATE UNIQUE INDEX content_reports_one_open_per_user_work_idx
  ON content_reports(reporter_user_id, work_id) WHERE status = 'open';
CREATE INDEX content_reports_queue_idx ON content_reports(status, created_at);
CREATE INDEX content_reports_work_idx ON content_reports(work_id, created_at DESC);

CREATE TABLE moderation_audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL REFERENCES content_reports(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('suspend','dismiss')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX moderation_audit_created_idx ON moderation_audit_events(created_at DESC);

CREATE FUNCTION reject_moderation_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'moderation audit events are append-only';
END;
$$;

CREATE TRIGGER moderation_audit_no_update
  BEFORE UPDATE ON moderation_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
CREATE TRIGGER moderation_audit_no_delete
  BEFORE DELETE ON moderation_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();

COMMIT;
