BEGIN;

CREATE TABLE tool_research_provider_billing_reconciliations (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  period_start_at timestamptz NOT NULL,
  period_end_at timestamptz NOT NULL,
  statement_billable_requests bigint NOT NULL CHECK (statement_billable_requests >= 0),
  statement_cost_usd_micros bigint NOT NULL CHECK (statement_cost_usd_micros >= 0),
  ledger_billable_requests bigint NOT NULL CHECK (ledger_billable_requests >= 0),
  ledger_cost_usd_micros bigint NOT NULL CHECK (ledger_cost_usd_micros >= 0),
  source_reference text CHECK (source_reference IS NULL OR char_length(source_reference) <= 240),
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end_at > period_start_at),
  CHECK (period_end_at <= period_start_at + interval '366 days'),
  UNIQUE(topic_id,provider,period_start_at,period_end_at,input_sha256),
  UNIQUE(topic_id,id)
);

CREATE INDEX tool_research_provider_billing_reconciliations_topic_idx
  ON tool_research_provider_billing_reconciliations(topic_id,period_end_at DESC,created_at DESC,id);

CREATE TABLE tool_research_provider_billing_reviews (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE RESTRICT,
  reconciliation_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('acknowledged','disputed')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(topic_id,reconciliation_id)
    REFERENCES tool_research_provider_billing_reconciliations(topic_id,id) ON DELETE RESTRICT
);

CREATE INDEX tool_research_provider_billing_reviews_reconciliation_idx
  ON tool_research_provider_billing_reviews(reconciliation_id,created_at DESC,id DESC);

CREATE FUNCTION protect_research_provider_billing_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research provider billing records are append-only';
END;
$$;

CREATE TRIGGER tool_research_provider_billing_reconciliations_no_update
  BEFORE UPDATE ON tool_research_provider_billing_reconciliations
  FOR EACH ROW EXECUTE FUNCTION protect_research_provider_billing_ledger();

CREATE TRIGGER tool_research_provider_billing_reconciliations_no_delete
  BEFORE DELETE ON tool_research_provider_billing_reconciliations
  FOR EACH ROW EXECUTE FUNCTION protect_research_provider_billing_ledger();

CREATE TRIGGER tool_research_provider_billing_reviews_no_update
  BEFORE UPDATE ON tool_research_provider_billing_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_provider_billing_ledger();

CREATE TRIGGER tool_research_provider_billing_reviews_no_delete
  BEFORE DELETE ON tool_research_provider_billing_reviews
  FOR EACH ROW EXECUTE FUNCTION protect_research_provider_billing_ledger();

COMMIT;
