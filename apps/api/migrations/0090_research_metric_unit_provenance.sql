BEGIN;

ALTER TABLE tool_research_metric_observations
  ADD COLUMN source_value_number numeric,
  ADD COLUMN source_unit text,
  ADD COLUMN conversion_version text,
  ADD COLUMN conversion_numerator bigint,
  ADD COLUMN conversion_denominator bigint;

UPDATE tool_research_metric_observations
   SET source_value_number=value_number,
       source_unit=unit,
       conversion_version='identity-v1',
       conversion_numerator=1,
       conversion_denominator=1;

ALTER TABLE tool_research_metric_observations
  ALTER COLUMN source_unit SET NOT NULL,
  ALTER COLUMN conversion_version SET NOT NULL,
  ALTER COLUMN conversion_numerator SET NOT NULL,
  ALTER COLUMN conversion_denominator SET NOT NULL,
  ADD CONSTRAINT tool_research_metric_observations_source_unit_check CHECK (char_length(source_unit) BETWEEN 1 AND 40),
  ADD CONSTRAINT tool_research_metric_observations_conversion_version_check CHECK (conversion_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  ADD CONSTRAINT tool_research_metric_observations_conversion_ratio_check CHECK (conversion_numerator > 0 AND conversion_denominator > 0),
  ADD CONSTRAINT tool_research_metric_observations_source_value_check CHECK ((value_number IS NULL) = (source_value_number IS NULL));

CREATE FUNCTION protect_research_metric_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research metric definitions are immutable';
END;
$$;

CREATE TRIGGER tool_research_metric_definitions_no_update
  BEFORE UPDATE ON tool_research_metric_definitions
  FOR EACH ROW EXECUTE FUNCTION protect_research_metric_definition();

COMMIT;
