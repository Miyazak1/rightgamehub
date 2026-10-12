BEGIN;

ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_attribution_source_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_attribution_source_check CHECK (
  attribution_source IS NULL OR attribution_source IN ('share_copy','share_system','readme','external','campaign')
);

CREATE TABLE discovery_campaigns (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$'),
  eyebrow text NOT NULL CHECK (char_length(eyebrow) BETWEEN 2 AND 40),
  title text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 80),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 20 AND 300),
  campaign_kind text NOT NULL CHECK (campaign_kind IN ('weekly_open_game','improve_together','collection')),
  publication_state text NOT NULL DEFAULT 'draft' CHECK (publication_state IN ('draft','published','archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NOT NULL AND ends_at > starts_at),
  CHECK (
    publication_state='draft' AND published_at IS NULL AND archived_at IS NULL
    OR publication_state='published' AND published_at IS NOT NULL AND archived_at IS NULL
    OR publication_state='archived' AND published_at IS NOT NULL AND archived_at IS NOT NULL
  )
);

CREATE INDEX discovery_campaigns_public_idx
  ON discovery_campaigns(starts_at DESC,published_at DESC,id DESC)
  WHERE publication_state='published';

CREATE TABLE discovery_campaign_items (
  campaign_id uuid NOT NULL REFERENCES discovery_campaigns(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
  pitch text NOT NULL CHECK (char_length(pitch) BETWEEN 5 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,work_id),
  UNIQUE (campaign_id,position)
);

CREATE TABLE discovery_campaign_events (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES discovery_campaigns(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created','edited','published','archived')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX discovery_campaign_events_campaign_idx
  ON discovery_campaign_events(campaign_id,created_at,id);

CREATE FUNCTION reject_discovery_campaign_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'discovery campaign events are append-only';
END;
$$;

CREATE TRIGGER discovery_campaign_events_no_update BEFORE UPDATE ON discovery_campaign_events
  FOR EACH ROW EXECUTE FUNCTION reject_discovery_campaign_event_mutation();
CREATE TRIGGER discovery_campaign_events_no_delete BEFORE DELETE ON discovery_campaign_events
  FOR EACH ROW EXECUTE FUNCTION reject_discovery_campaign_event_mutation();

COMMIT;
