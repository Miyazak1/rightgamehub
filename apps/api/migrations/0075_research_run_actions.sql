BEGIN;

CREATE TABLE tool_research_run_actions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES tool_research_runs(id) ON DELETE CASCADE,
  source_id uuid REFERENCES tool_research_sources(id) ON DELETE SET NULL,
  action_kind text NOT NULL
    CHECK (action_kind IN ('url-archive','feed-fetch','github-fetch','search','researcher')),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  attempt_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','completed','failed','uncertain','skipped')),
  estimated_usage jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(estimated_usage)='object'),
  actual_usage jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(actual_usage)='object'),
  receipt jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(receipt)='object'),
  retryable boolean NOT NULL DEFAULT false,
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,action_kind,request_sha256)
);

CREATE INDEX tool_research_run_actions_run_idx
  ON tool_research_run_actions(run_id,reserved_at,id);

CREATE FUNCTION protect_research_run_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'reserved' THEN
    RAISE EXCEPTION 'settled research run actions are immutable';
  END IF;
  IF (NEW.id,NEW.run_id,NEW.source_id,NEW.action_kind,NEW.provider,NEW.request_sha256,NEW.attempt_id,NEW.estimated_usage,NEW.reserved_at,NEW.created_at)
    IS DISTINCT FROM
     (OLD.id,OLD.run_id,OLD.source_id,OLD.action_kind,OLD.provider,OLD.request_sha256,OLD.attempt_id,OLD.estimated_usage,OLD.reserved_at,OLD.created_at) THEN
    RAISE EXCEPTION 'research run action identity is immutable';
  END IF;
  IF NEW.status = 'reserved' AND (
    NEW.actual_usage IS DISTINCT FROM OLD.actual_usage OR
    NEW.receipt IS DISTINCT FROM OLD.receipt OR
    NEW.retryable IS DISTINCT FROM OLD.retryable OR
    NEW.error_code IS DISTINCT FROM OLD.error_code OR
    NEW.error_message IS DISTINCT FROM OLD.error_message OR
    NEW.settled_at IS DISTINCT FROM OLD.settled_at OR
    (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at)
  ) THEN
    RAISE EXCEPTION 'reserved research run action may only record its first sent timestamp';
  END IF;
  IF NEW.status <> 'reserved' AND NEW.settled_at IS NULL THEN
    RAISE EXCEPTION 'settled research run action requires a settlement timestamp';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tool_research_run_action_immutable
  BEFORE UPDATE ON tool_research_run_actions
  FOR EACH ROW EXECUTE FUNCTION protect_research_run_action();

COMMIT;
