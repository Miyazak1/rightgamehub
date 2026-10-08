BEGIN;

CREATE TABLE community_channels (
  key text PRIMARY KEY CHECK(key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);
INSERT INTO community_channels(key,name) VALUES ('game','游戏'),('ai','AI'),('computing','计算机');

-- Publishing eligibility is separate from game creator permissions.
CREATE TABLE community_members (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  posting_allowed boolean NOT NULL DEFAULT false,
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 1000),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_posts (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel_key text NOT NULL REFERENCES community_channels(key),
  kind text NOT NULL DEFAULT 'share' CHECK(kind='share'),
  publication_state text NOT NULL DEFAULT 'draft' CHECK(publication_state IN ('draft','published','withdrawn','deleted')),
  moderation_state text NOT NULL DEFAULT 'clear' CHECK(moderation_state IN ('clear','hidden')),
  working_revision_id uuid,
  published_revision_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  first_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(publication_state<>'published' OR (published_revision_id IS NOT NULL AND first_published_at IS NOT NULL))
);
CREATE TABLE community_post_revisions (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  channel_key text NOT NULL REFERENCES community_channels(key),
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
  blocks jsonb NOT NULL CHECK(jsonb_typeof(blocks)='array' AND jsonb_array_length(blocks) BETWEEN 1 AND 32),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  review_status text NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','pending','approved','rejected','superseded')),
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  UNIQUE(post_id,id)
);
ALTER TABLE community_posts
  ADD FOREIGN KEY(id,working_revision_id) REFERENCES community_post_revisions(post_id,id) DEFERRABLE INITIALLY DEFERRED,
  ADD FOREIGN KEY(id,published_revision_id) REFERENCES community_post_revisions(post_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX community_posts_feed_idx ON community_posts(first_published_at DESC,id DESC) WHERE publication_state='published' AND moderation_state='clear';
CREATE INDEX community_posts_channel_idx ON community_posts(channel_key,first_published_at DESC,id DESC) WHERE publication_state='published' AND moderation_state='clear';
CREATE INDEX community_posts_author_idx ON community_posts(author_id,updated_at DESC,id DESC);
CREATE INDEX community_revisions_pending_idx ON community_post_revisions(submitted_at,id) WHERE review_status='pending';

CREATE TABLE community_media_assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','uploaded','processing','ready','failed','deleting','deleted')),
  declared_bytes integer NOT NULL CHECK(declared_bytes BETWEEN 1 AND 2097152),
  reserved_bytes bigint NOT NULL CHECK(reserved_bytes>=0),
  stored_bytes bigint NOT NULL DEFAULT 0 CHECK(stored_bytes>=0),
  input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
  input_type text NOT NULL CHECK(input_type IN ('image/jpeg','image/png','image/webp')),
  variants jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(variants)='object'),
  width integer,
  height integer,
  error_code text,
  lease_id uuid,
  lease_until timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
  UNIQUE(post_id,id),
  UNIQUE(id,owner_id),
  CHECK((state='processing')=(lease_id IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK(state<>'ready' OR (width>0 AND height>0 AND stored_bytes>0))
);
CREATE INDEX community_media_owner_idx ON community_media_assets(owner_id,created_at);
CREATE INDEX community_media_queue_idx ON community_media_assets(created_at,id) WHERE state IN ('uploaded','processing');
CREATE INDEX community_media_expiry_idx ON community_media_assets(expires_at,id) WHERE state<>'deleted';
CREATE TABLE community_revision_media (
  post_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  PRIMARY KEY(revision_id,asset_id),
  FOREIGN KEY(post_id,revision_id) REFERENCES community_post_revisions(post_id,id) ON DELETE CASCADE,
  FOREIGN KEY(post_id,asset_id) REFERENCES community_media_assets(post_id,id) ON DELETE RESTRICT
);
CREATE INDEX community_revision_media_asset_idx ON community_revision_media(asset_id);

CREATE TABLE community_post_likes (
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(post_id,user_id)
);
CREATE TABLE community_post_bookmarks (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id,user_id)
);
CREATE INDEX community_bookmarks_user_idx ON community_post_bookmarks(user_id,created_at DESC,id DESC);
CREATE TABLE community_post_stats (
  post_id uuid PRIMARY KEY REFERENCES community_posts(id) ON DELETE RESTRICT,
  like_count bigint NOT NULL DEFAULT 0 CHECK(like_count>=0)
);
CREATE TABLE community_reports (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK(category IN ('unsafe','harassment','copyright','spam','other')),
  details text NOT NULL CHECK(char_length(details) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX community_reports_open_unique ON community_reports(post_id,reporter_id) WHERE status='open';
CREATE INDEX community_reports_queue_idx ON community_reports(created_at,id) WHERE status='open';
CREATE TABLE community_moderation_events (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  post_id uuid REFERENCES community_posts(id) ON DELETE RESTRICT,
  revision_id uuid REFERENCES community_post_revisions(id) ON DELETE RESTRICT,
  action text NOT NULL,
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 1000),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_write_receipts (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  key_hash text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
  PRIMARY KEY(actor_id,operation,key_hash)
);
CREATE INDEX community_receipts_expiry_idx ON community_write_receipts(expires_at);
CREATE INDEX community_receipts_rate_idx ON community_write_receipts(actor_id,operation,created_at);

CREATE FUNCTION community_protect_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.post_id,NEW.channel_key,NEW.schema_version,NEW.title,NEW.blocks,NEW.content_hash,NEW.created_at)
     IS DISTINCT FROM
     (OLD.post_id,OLD.channel_key,OLD.schema_version,OLD.title,OLD.blocks,OLD.content_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'community revision content is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER community_revision_immutable BEFORE UPDATE ON community_post_revisions FOR EACH ROW EXECUTE FUNCTION community_protect_revision();
CREATE TRIGGER community_audit_no_update BEFORE UPDATE ON community_moderation_events FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
CREATE TRIGGER community_audit_no_delete BEFORE DELETE ON community_moderation_events FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();

CREATE TABLE community_interaction_limits (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  minute timestamptz NOT NULL,
  count integer NOT NULL CHECK(count>0)
);
COMMIT;
