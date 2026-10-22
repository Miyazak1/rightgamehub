BEGIN;

ALTER TABLE tool_researcher_jobs
  ADD COLUMN provider text CHECK (provider IS NULL OR char_length(provider) BETWEEN 1 AND 80),
  ADD COLUMN provider_model text CHECK (provider_model IS NULL OR char_length(provider_model) BETWEEN 1 AND 80),
  ADD COLUMN provider_call_status text NOT NULL DEFAULT 'none'
    CHECK (provider_call_status IN ('none','reserved','sent','completed','failed','uncertain','skipped')),
  ADD COLUMN provider_estimated_usage jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_estimated_usage)='object'),
  ADD COLUMN provider_actual_usage jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_actual_usage)='object'),
  ADD COLUMN provider_receipt jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_receipt)='object'),
  ADD COLUMN provider_reserved_at timestamptz,
  ADD COLUMN provider_sent_at timestamptz,
  ADD COLUMN provider_settled_at timestamptz,
  ADD CONSTRAINT tool_researcher_jobs_provider_state_check CHECK (
    (provider_call_status='none' AND provider IS NULL AND provider_model IS NULL AND provider_reserved_at IS NULL)
    OR
    (provider_call_status<>'none' AND provider IS NOT NULL AND provider_model IS NOT NULL AND provider_reserved_at IS NOT NULL)
  ),
  ADD CONSTRAINT tool_researcher_jobs_provider_timestamps_check CHECK (
    (provider_sent_at IS NULL OR provider_call_status IN ('sent','completed','failed','uncertain'))
    AND
    (provider_settled_at IS NULL OR provider_call_status IN ('completed','failed','uncertain','skipped'))
  );

CREATE INDEX tool_researcher_jobs_provider_budget_idx
  ON tool_researcher_jobs(provider_reserved_at,provider_call_status,topic_id)
  WHERE provider_call_status<>'none';

COMMIT;
