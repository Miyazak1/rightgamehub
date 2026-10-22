BEGIN;

CREATE TABLE tool_research_entities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('product','company','person','project','policy','technology','paper','institution','region','other')),
  canonical_name text NOT NULL CHECK (char_length(canonical_name) BETWEEN 1 AND 160),
  normalized_name text NOT NULL CHECK (char_length(normalized_name) BETWEEN 1 AND 160),
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(aliases) <= 20),
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(external_ids)='object' AND octet_length(external_ids::text)<=4096),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','tracked','rejected','muted')),
  confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  discovery_basis text NOT NULL CHECK (char_length(discovery_basis) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,entity_type,normalized_name)
);

CREATE INDEX tool_research_entities_user_status_idx
  ON tool_research_entities(user_id,status,entity_type,normalized_name,id);

CREATE TABLE tool_research_topic_entities (
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES tool_research_entities(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'subject' CHECK (role IN ('subject','owner','competitor','partner','regulator','market','other')),
  added_reason text NOT NULL CHECK (char_length(added_reason) BETWEEN 1 AND 500),
  added_by text NOT NULL CHECK (added_by IN ('user','source','discovery','researcher','import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic_id,entity_id)
);

CREATE INDEX tool_research_topic_entities_entity_idx
  ON tool_research_topic_entities(entity_id,topic_id);

CREATE TABLE tool_research_event_clusters (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_title text NOT NULL CHECK (char_length(canonical_title) BETWEEN 1 AND 240),
  occurred_day date NOT NULL,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','formal','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,fingerprint)
);

CREATE INDEX tool_research_event_clusters_topic_day_idx
  ON tool_research_event_clusters(topic_id,occurred_day DESC,id DESC);

CREATE TABLE tool_research_event_cluster_members (
  cluster_id uuid NOT NULL REFERENCES tool_research_event_clusters(id) ON DELETE CASCADE,
  event_id uuid NOT NULL UNIQUE REFERENCES tool_research_events(id) ON DELETE CASCADE,
  match_kind text NOT NULL CHECK (match_kind IN ('exact-normalized-title-day')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(cluster_id,event_id)
);

CREATE TABLE tool_research_event_entities (
  event_id uuid NOT NULL REFERENCES tool_research_events(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES tool_research_entities(id) ON DELETE RESTRICT,
  linked_by text NOT NULL CHECK (linked_by IN ('user','deterministic','researcher')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,entity_id)
);

COMMIT;
