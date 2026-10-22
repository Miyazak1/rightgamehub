BEGIN;

CREATE TABLE tool_research_metric_definitions (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  value_type text NOT NULL CHECK (value_type IN ('number','text')),
  canonical_unit text NOT NULL CHECK (char_length(canonical_unit) BETWEEN 1 AND 40),
  method_version text NOT NULL CHECK (method_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,metric_key,method_version)
);

CREATE INDEX tool_research_metric_definitions_topic_idx
  ON tool_research_metric_definitions(topic_id,metric_key,method_version,id);

CREATE TABLE tool_research_metric_observations (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  metric_definition_id uuid NOT NULL REFERENCES tool_research_metric_definitions(id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL,
  claim_revision integer NOT NULL,
  observed_at timestamptz NOT NULL,
  value_number numeric,
  value_text text CHECK (value_text IS NULL OR char_length(value_text) BETWEEN 1 AND 500),
  unit text NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 40),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions)='object'),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_id uuid NOT NULL REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','active','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(claim_id,claim_revision)
    REFERENCES tool_research_claim_revisions(claim_id,revision) ON DELETE RESTRICT,
  UNIQUE(claim_id,claim_revision),
  CHECK ((value_number IS NOT NULL)::integer + (value_text IS NOT NULL)::integer = 1)
);

CREATE INDEX tool_research_metric_observations_series_idx
  ON tool_research_metric_observations(topic_id,metric_definition_id,status,observed_at,id);
CREATE INDEX tool_research_metric_observations_dimensions_idx
  ON tool_research_metric_observations USING gin(dimensions);

-- An observation is a recorded fact. Claim review may move it through the
-- lifecycle, but must never rewrite the measured value, method linkage,
-- dimensions, timestamp or evidence after insertion.
CREATE FUNCTION guard_research_metric_observation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'research metric observation facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tool_research_metric_observation_fact_guard
  BEFORE UPDATE ON tool_research_metric_observations
  FOR EACH ROW EXECUTE FUNCTION guard_research_metric_observation_update();

CREATE FUNCTION sync_research_metric_observation_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tool_research_metric_observations
     SET status=CASE
       WHEN claim_revision<>NEW.current_revision THEN 'superseded'
       WHEN NEW.status='accepted' THEN 'active'
       WHEN NEW.status='rejected' THEN 'rejected'
       ELSE 'candidate'
     END
   WHERE claim_id=NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tool_research_claim_metric_status_sync
  AFTER UPDATE OF status,current_revision ON tool_research_claims
  FOR EACH ROW EXECUTE FUNCTION sync_research_metric_observation_status();

COMMIT;
