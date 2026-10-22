BEGIN;

CREATE TABLE tool_research_method_templates (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  method_version text NOT NULL CHECK (method_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  method_kind text NOT NULL CHECK (method_kind IN ('direct-observation')),
  rules_json jsonb NOT NULL CHECK (jsonb_typeof(rules_json)='object' AND octet_length(rules_json::text)<=8192),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,method_version)
);

CREATE INDEX tool_research_method_templates_topic_idx
  ON tool_research_method_templates(topic_id,status,method_version,id);

INSERT INTO tool_research_method_templates(
  id,topic_id,method_version,label,description,method_kind,rules_json,status
)
SELECT gen_random_uuid(),t.id,'direct-observation-v1','直接证据观察','从冻结证据中的直接引文或结构化事实记录原始观察；缺失保持未知，不执行单位换算或派生计算。','direct-observation',
  '{"evidenceKinds":["change-excerpt","direct-quote","structured-fact"],"authorityTiers":["official-primary","official-implementation","institutional","independent-reputable","community","unknown"],"requiredDimensions":[],"missingValuePolicy":"unknown","comparisonPolicy":"same-method-unit","aggregation":"none","instructions":"只记录证据直接支持的原始值，不推断缺失值。"}'::jsonb,
  'active'
FROM tool_research_topics t;

ALTER TABLE tool_research_metric_definitions
  ADD COLUMN method_template_id uuid;

UPDATE tool_research_metric_definitions d
   SET method_template_id=m.id
  FROM tool_research_method_templates m
 WHERE m.topic_id=d.topic_id
   AND m.method_version=d.method_version;

ALTER TABLE tool_research_metric_definitions
  ALTER COLUMN method_template_id SET NOT NULL,
  ADD CONSTRAINT tool_research_metric_definitions_method_fk
    FOREIGN KEY(method_template_id) REFERENCES tool_research_method_templates(id) ON DELETE RESTRICT;

CREATE FUNCTION guard_research_method_template_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'research method template versions are immutable';
  END IF;
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tool_research_method_template_version_guard
  BEFORE UPDATE ON tool_research_method_templates
  FOR EACH ROW EXECUTE FUNCTION guard_research_method_template_update();

COMMIT;
