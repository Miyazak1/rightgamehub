BEGIN;

-- F1-4A is deliberately passive: the legacy blog runner remains the sole
-- provider caller and publisher.  These rows are a rebuildable compatibility
-- projection used to prove that every legacy run can be represented by the
-- Foundation contracts before any execution ownership is moved.
CREATE TABLE agent_blog_runtime_shadow_projections (
  legacy_run_id uuid PRIMARY KEY REFERENCES agent_blog_runs(id) ON DELETE RESTRICT,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  projection_mode text NOT NULL DEFAULT 'passive' CHECK (projection_mode IN ('passive','shadow','canary','foundation')),
  runtime_run_id uuid REFERENCES agent_runs(id) ON DELETE RESTRICT,
  source_status text NOT NULL CHECK (source_status IN ('queued','generating','checking','published','rejected','failed')),
  mapped_run_status text NOT NULL CHECK (mapped_run_status IN ('queued','running','succeeded','rejected','failed')),
  mapped_stage_status text NOT NULL CHECK (mapped_stage_status IN ('queued','running','succeeded','failed')),
  provider_owner text NOT NULL DEFAULT 'legacy' CHECK (provider_owner IN ('legacy','foundation')),
  publish_owner text NOT NULL DEFAULT 'legacy' CHECK (publish_owner IN ('legacy','foundation')),
  parity_status text NOT NULL CHECK (parity_status IN ('exact','invalid')),
  mismatch_codes text[] NOT NULL DEFAULT '{}',
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot)='object' AND octet_length(source_snapshot::text)<=65536),
  source_updated_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now(),
  CHECK (projection_mode<>'passive' OR runtime_run_id IS NULL),
  CHECK (projection_mode<>'passive' OR (provider_owner='legacy' AND publish_owner='legacy')),
  CHECK ((parity_status='exact' AND cardinality(mismatch_codes)=0) OR (parity_status='invalid' AND cardinality(mismatch_codes)>0)),
  UNIQUE(runtime_run_id)
);

CREATE INDEX agent_blog_runtime_shadow_agent_history
  ON agent_blog_runtime_shadow_projections(agent_user_id,projected_at DESC,legacy_run_id DESC);
CREATE INDEX agent_blog_runtime_shadow_reconcile
  ON agent_blog_runtime_shadow_projections(source_updated_at,legacy_run_id);

CREATE TABLE agent_blog_runtime_shadow_events (
  id bigserial PRIMARY KEY,
  legacy_run_id uuid NOT NULL REFERENCES agent_blog_runs(id) ON DELETE RESTRICT,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_status text NOT NULL CHECK (source_status IN ('queued','generating','checking','published','rejected','failed')),
  mapped_run_status text NOT NULL CHECK (mapped_run_status IN ('queued','running','succeeded','rejected','failed')),
  parity_status text NOT NULL CHECK (parity_status IN ('exact','invalid')),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object' AND octet_length(payload_json::text)<=32768),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(legacy_run_id,source_sha256)
);

CREATE FUNCTION reject_agent_blog_shadow_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent blog shadow events are append-only';
END;
$$;

CREATE TRIGGER agent_blog_shadow_events_append_only
  BEFORE UPDATE OR DELETE ON agent_blog_runtime_shadow_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_blog_shadow_event_mutation();

COMMIT;
