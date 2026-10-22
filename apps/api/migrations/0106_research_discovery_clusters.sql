BEGIN;

CREATE TABLE tool_research_discovery_clusters (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_title text NOT NULL CHECK (char_length(canonical_title) BETWEEN 1 AND 500),
  published_day date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,fingerprint)
);

CREATE INDEX tool_research_discovery_clusters_topic_idx
  ON tool_research_discovery_clusters(topic_id,updated_at DESC,id DESC);

CREATE TABLE tool_research_discovery_cluster_members (
  cluster_id uuid NOT NULL REFERENCES tool_research_discovery_clusters(id) ON DELETE CASCADE,
  discovery_id uuid PRIMARY KEY REFERENCES tool_research_source_discoveries(id) ON DELETE CASCADE,
  match_kind text NOT NULL DEFAULT 'exact-normalized-title-day'
    CHECK (match_kind IN ('exact-normalized-title-day')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_research_discovery_cluster_members_cluster_idx
  ON tool_research_discovery_cluster_members(cluster_id,created_at,discovery_id);

COMMIT;
