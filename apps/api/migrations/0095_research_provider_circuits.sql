BEGIN;

CREATE TABLE tool_research_provider_circuits (
  provider text PRIMARY KEY CHECK (char_length(provider) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','open','half_open')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  failure_window_started_at timestamptz,
  opened_at timestamptz,
  retry_after timestamptz,
  probe_action_id uuid,
  probe_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 120),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'half_open') = (probe_action_id IS NOT NULL AND probe_until IS NOT NULL)),
  CHECK (state <> 'open' OR retry_after IS NOT NULL)
);

CREATE INDEX tool_research_provider_circuits_retry_idx
  ON tool_research_provider_circuits(state,retry_after);

COMMIT;
