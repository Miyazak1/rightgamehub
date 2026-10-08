BEGIN;

-- Preserve the audience of revisions created before open posting. Only new
-- revisions explicitly submitted by their author can adopt post-level publicity.
ALTER TABLE community_post_revisions ADD COLUMN visibility_policy text NOT NULL
  DEFAULT 'profile' CHECK (visibility_policy IN ('profile','post'));
ALTER TABLE community_post_revisions ALTER COLUMN visibility_policy SET DEFAULT 'post';

CREATE OR REPLACE FUNCTION community_protect_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.post_id,NEW.channel_key,NEW.schema_version,NEW.title,NEW.blocks,NEW.content_hash,NEW.created_at,NEW.visibility_policy)
     IS DISTINCT FROM
     (OLD.post_id,OLD.channel_key,OLD.schema_version,OLD.title,OLD.blocks,OLD.content_hash,OLD.created_at,OLD.visibility_policy) THEN
    RAISE EXCEPTION 'community revision content is immutable';
  END IF;
  RETURN NEW;
END; $$;

-- Missing membership rows now mean normal posting. Explicit restrictions remain.
ALTER TABLE community_members ALTER COLUMN posting_allowed SET DEFAULT true;

COMMIT;
