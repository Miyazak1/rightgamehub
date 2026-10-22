BEGIN;

CREATE TABLE tool_research_metric_views (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  view_type text NOT NULL CHECK (view_type IN ('series','comparison')),
  config_json jsonb NOT NULL CHECK (
    jsonb_typeof(config_json)='object'
    AND octet_length(config_json::text)<=8192
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,name)
);

CREATE INDEX tool_research_metric_views_topic_idx
  ON tool_research_metric_views(topic_id,updated_at DESC,id);

COMMIT;
