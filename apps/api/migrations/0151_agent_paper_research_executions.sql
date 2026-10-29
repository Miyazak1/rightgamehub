BEGIN;

-- R1.8 binds the private paper queue to the generic Agent Runtime. Runtime
-- tables remain the source of truth for stages, leases and attempts; this
-- table is the paper-domain projection and audit boundary.
CREATE TABLE agent_paper_research_executions (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  queue_item_id uuid NOT NULL REFERENCES agent_paper_research_queue_items(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 1000),
  runtime_run_id uuid UNIQUE REFERENCES agent_runs(id) ON DELETE RESTRICT,
  paper_version_id uuid REFERENCES agent_paper_versions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN (
    'queued','running','blocked','succeeded','failed','cancelled'
  )),
  stage_key text NOT NULL CHECK (char_length(stage_key) BETWEEN 3 AND 80),
  access_level text NOT NULL CHECK (access_level IN (
    'unknown','metadata-only','abstract-only','fulltext-open',
    'fulltext-user-provided','fulltext-restricted'
  )),
  input_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(input_snapshot)='object' AND octet_length(input_snapshot::text)<=32768
  ),
  result_json jsonb CHECK (
    result_json IS NULL OR (jsonb_typeof(result_json)='object'
      AND octet_length(result_json::text)<=65536)
  ),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 3 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(agent_user_id,request_id),
  UNIQUE(queue_item_id,attempt_number),
  CHECK ((status IN ('succeeded','failed','cancelled'))=(finished_at IS NOT NULL)),
  CHECK (status<>'succeeded' OR (paper_version_id IS NOT NULL AND result_json IS NOT NULL)),
  CHECK (status NOT IN ('blocked','failed') OR error_code IS NOT NULL)
);

CREATE TABLE agent_paper_research_execution_events (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES agent_paper_research_executions(id) ON DELETE RESTRICT,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('operator','worker','system')),
  actor_ref text CHECK (actor_ref IS NULL OR char_length(actor_ref) BETWEEN 1 AND 160),
  event_type text NOT NULL CHECK (event_type IN (
    'execution.created','execution.started','execution.stage','execution.blocked',
    'execution.failed','execution.succeeded','execution.cancelled','execution.requeued'
  )),
  stage_key text NOT NULL CHECK (char_length(stage_key) BETWEEN 3 AND 80),
  payload_json jsonb NOT NULL CHECK (
    jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_paper_research_executions_queue_created
  ON agent_paper_research_executions(queue_item_id,created_at DESC,id DESC);
CREATE INDEX agent_paper_research_executions_agent_status
  ON agent_paper_research_executions(agent_user_id,status,created_at DESC,id DESC);
CREATE UNIQUE INDEX agent_paper_research_executions_active_queue
  ON agent_paper_research_executions(queue_item_id)
  WHERE status IN ('queued','running');
CREATE INDEX agent_paper_research_execution_events_execution_created
  ON agent_paper_research_execution_events(execution_id,created_at,id);

CREATE FUNCTION enforce_agent_paper_research_execution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_json jsonb := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME='agent_paper_research_executions' THEN
    IF NOT EXISTS (SELECT 1 FROM agent_paper_research_queue_items item
      WHERE item.id=(row_json->>'queue_item_id')::uuid
        AND item.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper execution queue item belongs to another agent' USING ERRCODE='23514'; END IF;
    IF row_json->>'runtime_run_id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM agent_runs run WHERE run.id=(row_json->>'runtime_run_id')::uuid
        AND run.agent_user_id=(row_json->>'agent_user_id')::uuid
        AND run.workflow_key='paper.private.research'
    ) THEN RAISE EXCEPTION 'paper execution run belongs to another agent or workflow' USING ERRCODE='23514'; END IF;
    IF row_json->>'paper_version_id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM agent_paper_versions version
      JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
      WHERE version.id=(row_json->>'paper_version_id')::uuid
        AND identity.agent_user_id=(row_json->>'agent_user_id')::uuid
    ) THEN RAISE EXCEPTION 'paper execution version belongs to another agent' USING ERRCODE='23514'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM agent_paper_research_executions execution
      WHERE execution.id=(row_json->>'execution_id')::uuid
        AND execution.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper execution event belongs to another agent' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_paper_research_executions_scope
  BEFORE INSERT OR UPDATE ON agent_paper_research_executions
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_research_execution_scope();
CREATE TRIGGER agent_paper_research_execution_events_scope
  BEFORE INSERT ON agent_paper_research_execution_events
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_research_execution_scope();

CREATE FUNCTION guard_agent_paper_research_execution_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id<>NEW.id OR OLD.agent_user_id<>NEW.agent_user_id
    OR OLD.operator_user_id<>NEW.operator_user_id OR OLD.queue_item_id<>NEW.queue_item_id
    OR OLD.request_id<>NEW.request_id OR OLD.attempt_number<>NEW.attempt_number
    OR OLD.input_snapshot<>NEW.input_snapshot OR OLD.created_at<>NEW.created_at THEN
    RAISE EXCEPTION 'paper execution identity fields are immutable';
  END IF;
  IF OLD.runtime_run_id IS NOT NULL AND OLD.runtime_run_id IS DISTINCT FROM NEW.runtime_run_id THEN
    RAISE EXCEPTION 'paper execution run is immutable once assigned';
  END IF;
  IF OLD.paper_version_id IS NOT NULL AND OLD.paper_version_id IS DISTINCT FROM NEW.paper_version_id THEN
    RAISE EXCEPTION 'paper execution version is immutable once assigned';
  END IF;
  IF NOT (
    (OLD.status='queued' AND NEW.status IN ('queued','running','blocked','failed','cancelled'))
    OR (OLD.status='running' AND NEW.status IN ('running','blocked','succeeded','failed','cancelled'))
    OR (OLD.status IN ('blocked','failed') AND NEW.status IN (OLD.status,'queued','cancelled'))
    OR (OLD.status IN ('succeeded','cancelled') AND NEW.status=OLD.status)
  ) THEN RAISE EXCEPTION 'invalid paper execution transition'; END IF;
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_paper_research_executions_guard
  BEFORE UPDATE ON agent_paper_research_executions
  FOR EACH ROW EXECUTE FUNCTION guard_agent_paper_research_execution_update();
CREATE TRIGGER agent_paper_research_executions_no_delete
  BEFORE DELETE ON agent_paper_research_executions
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_research_execution_events_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_research_execution_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

COMMIT;
