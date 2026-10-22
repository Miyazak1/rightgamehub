BEGIN;

CREATE TABLE tool_research_sources (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_url text NOT NULL CHECK (char_length(canonical_url) BETWEEN 1 AND 2048),
  source_type text NOT NULL CHECK (source_type IN ('http','rss','github','search','pdf','api')),
  publisher text CHECK (publisher IS NULL OR char_length(publisher) <= 240),
  authority_tier text NOT NULL DEFAULT 'unknown'
    CHECK (authority_tier IN ('official-primary','official-implementation','institutional','independent-reputable','community','unknown')),
  status text NOT NULL DEFAULT 'tracked' CHECK (status IN ('candidate','tracked','rejected','muted')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,canonical_url,source_type)
);

CREATE TABLE tool_research_topic_sources (
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE CASCADE,
  watch_id uuid REFERENCES tool_change_watches(id) ON DELETE SET NULL,
  added_reason text NOT NULL CHECK (char_length(added_reason) BETWEEN 1 AND 500),
  added_by text NOT NULL CHECK (added_by IN ('user','watch','discovery','import')),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic_id,source_id),
  UNIQUE(topic_id,watch_id)
);

CREATE TABLE tool_research_source_versions (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE CASCADE,
  change_snapshot_id uuid UNIQUE REFERENCES tool_change_snapshots(id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL,
  published_at timestamptz,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  normalized_hash text NOT NULL CHECK (normalized_hash ~ '^[a-f0-9]{64}$'),
  locator jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(locator)='object'),
  content_type text CHECK (content_type IS NULL OR char_length(content_type) <= 200),
  storage_ref text CHECK (storage_ref IS NULL OR char_length(storage_ref) <= 500),
  previous_version_id uuid REFERENCES tool_research_source_versions(id),
  fetch_receipt jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fetch_receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,content_hash,fetched_at)
);

CREATE INDEX tool_research_source_versions_source_idx
  ON tool_research_source_versions(source_id,fetched_at DESC,id DESC);

CREATE TABLE tool_research_evidence (
  id uuid PRIMARY KEY,
  source_version_id uuid NOT NULL REFERENCES tool_research_source_versions(id) ON DELETE CASCADE,
  locator jsonb NOT NULL CHECK (jsonb_typeof(locator)='object'),
  quote_text text NOT NULL CHECK (char_length(quote_text) BETWEEN 1 AND 2000),
  quote_hash text NOT NULL CHECK (quote_hash ~ '^[a-f0-9]{64}$'),
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('change-excerpt','direct-quote','structured-fact','metadata')),
  allowed_uses text[] NOT NULL DEFAULT ARRAY['analysis','citation']::text[]
    CHECK (allowed_uses <@ ARRAY['analysis','citation','notification','comparison']::text[]),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_version_id,quote_hash,evidence_kind)
);

CREATE TABLE tool_research_events (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  origin_version_id uuid NOT NULL REFERENCES tool_research_source_versions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  external_key text CHECK (external_key IS NULL OR external_key ~ '^[a-f0-9]{64}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  occurred_at timestamptz,
  detected_at timestamptz NOT NULL,
  importance text NOT NULL CHECK (importance IN ('routine','important','critical')),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','formal','rejected','superseded')),
  run_id uuid NOT NULL REFERENCES tool_research_runs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,origin_version_id,event_type)
);

CREATE UNIQUE INDEX tool_research_events_external_key_unique
  ON tool_research_events(topic_id,external_key)
  WHERE external_key IS NOT NULL;

CREATE INDEX tool_research_events_topic_detected_idx
  ON tool_research_events(topic_id,detected_at DESC,id DESC);

CREATE TABLE tool_research_event_evidence (
  event_id uuid NOT NULL REFERENCES tool_research_events(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  stance text NOT NULL DEFAULT 'supports' CHECK (stance IN ('supports','opposes','context')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,evidence_id)
);

CREATE FUNCTION protect_research_evidence_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'research source versions and evidence are immutable';
END $$;
CREATE TRIGGER tool_research_source_version_immutable
  BEFORE UPDATE ON tool_research_source_versions
  FOR EACH ROW EXECUTE FUNCTION protect_research_evidence_fact();
CREATE TRIGGER tool_research_evidence_immutable
  BEFORE UPDATE ON tool_research_evidence
  FOR EACH ROW EXECUTE FUNCTION protect_research_evidence_fact();

COMMIT;
