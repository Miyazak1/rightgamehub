BEGIN;

CREATE TABLE tool_research_derived_metric_definitions (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  derived_key text NOT NULL CHECK (derived_key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  formula_version text NOT NULL CHECK (formula_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  operator text NOT NULL CHECK (operator IN ('difference','ratio','percent-change')),
  left_metric_definition_id uuid NOT NULL REFERENCES tool_research_metric_definitions(id) ON DELETE RESTRICT,
  right_metric_definition_id uuid NOT NULL REFERENCES tool_research_metric_definitions(id) ON DELETE RESTRICT,
  dimension_key text NOT NULL CHECK (dimension_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  output_unit text NOT NULL CHECK (char_length(output_unit) BETWEEN 1 AND 40),
  formula_json jsonb NOT NULL CHECK (jsonb_typeof(formula_json)='object' AND octet_length(formula_json::text)<=8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,derived_key,formula_version),
  CHECK (left_metric_definition_id<>right_metric_definition_id)
);

CREATE INDEX tool_research_derived_metric_definitions_topic_idx
  ON tool_research_derived_metric_definitions(topic_id,derived_key,formula_version,id);

CREATE FUNCTION protect_research_derived_metric_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research derived metric definitions are immutable';
END;
$$;

CREATE TRIGGER tool_research_derived_metric_definitions_no_update
  BEFORE UPDATE ON tool_research_derived_metric_definitions
  FOR EACH ROW EXECUTE FUNCTION protect_research_derived_metric_definition();

COMMIT;
