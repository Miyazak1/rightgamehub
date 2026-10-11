BEGIN;

ALTER TABLE analytics_events
  ADD COLUMN attribution_source text CHECK (
    attribution_source IS NULL OR attribution_source IN ('share_copy','share_system','readme','external')
  ),
  ADD COLUMN campaign_key text CHECK (
    campaign_key IS NULL OR campaign_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  ADD CONSTRAINT analytics_events_campaign_source_check CHECK (
    campaign_key IS NULL OR attribution_source IS NOT NULL
  );

CREATE INDEX analytics_events_attribution_occurred_idx
  ON analytics_events(attribution_source, occurred_at DESC)
  WHERE work_key IS NOT NULL AND attribution_source IS NOT NULL;

COMMIT;
