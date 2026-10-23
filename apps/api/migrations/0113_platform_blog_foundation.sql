BEGIN;

CREATE TABLE blog_articles (
  id uuid PRIMARY KEY,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$'),
  locale text NOT NULL CHECK (locale IN ('zh-CN','en')),
  publication_state text NOT NULL DEFAULT 'draft' CHECK (publication_state IN ('draft','published','withdrawn')),
  working_revision_id uuid NOT NULL,
  published_revision_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  first_published_at timestamptz,
  last_published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (publication_state='draft' AND published_revision_id IS NULL AND first_published_at IS NULL AND last_published_at IS NULL AND withdrawn_at IS NULL)
    OR (publication_state='published' AND published_revision_id IS NOT NULL AND first_published_at IS NOT NULL AND last_published_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (publication_state='withdrawn' AND published_revision_id IS NOT NULL AND first_published_at IS NOT NULL AND last_published_at IS NOT NULL AND withdrawn_at IS NOT NULL)
  )
);

CREATE TABLE blog_article_revisions (
  id uuid PRIMARY KEY,
  article_id uuid NOT NULL REFERENCES blog_articles(id) ON DELETE RESTRICT,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 20 AND 360),
  blocks jsonb NOT NULL CHECK (jsonb_typeof(blocks)='array' AND jsonb_array_length(blocks) BETWEEN 1 AND 96 AND octet_length(blocks::text) <= 131072),
  citations jsonb NOT NULL CHECK (jsonb_typeof(citations)='array' AND jsonb_array_length(citations) <= 80 AND octet_length(citations::text) <= 131072),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  revision_state text NOT NULL CHECK (revision_state IN ('working','published','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(article_id,id)
);

ALTER TABLE blog_articles
  ADD CONSTRAINT blog_articles_working_revision_fk
    FOREIGN KEY(id,working_revision_id) REFERENCES blog_article_revisions(article_id,id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT blog_articles_published_revision_fk
    FOREIGN KEY(id,published_revision_id) REFERENCES blog_article_revisions(article_id,id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX blog_articles_public_idx
  ON blog_articles(last_published_at DESC,id DESC)
  WHERE publication_state='published';
CREATE INDEX blog_articles_author_idx
  ON blog_articles(author_user_id,updated_at DESC,id DESC);
CREATE INDEX blog_article_revisions_article_idx
  ON blog_article_revisions(article_id,created_at DESC,id DESC);

CREATE TABLE blog_revision_research_provenance (
  revision_id uuid PRIMARY KEY REFERENCES blog_article_revisions(id) ON DELETE RESTRICT,
  source_contract_version text NOT NULL CHECK (source_contract_version='change-radar-publication-draft-v1'),
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE RESTRICT,
  report_snapshot_id uuid NOT NULL REFERENCES tool_research_reports(id) ON DELETE RESTRICT,
  report_sha256 text NOT NULL CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  claim_ids uuid[] NOT NULL CHECK (cardinality(claim_ids) BETWEEN 1 AND 100),
  evidence_ids uuid[] NOT NULL CHECK (cardinality(evidence_ids) BETWEEN 1 AND 200),
  generated_at timestamptz NOT NULL,
  imported_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blog_article_events (
  id uuid PRIMARY KEY,
  article_id uuid NOT NULL REFERENCES blog_articles(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('draft_created','draft_revised','published','withdrawn')),
  revision_id uuid REFERENCES blog_article_revisions(id) ON DELETE RESTRICT,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object' AND octet_length(details::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blog_article_events_article_idx
  ON blog_article_events(article_id,created_at,id);
CREATE INDEX blog_article_events_actor_rate_idx
  ON blog_article_events(actor_user_id,created_at DESC);

CREATE FUNCTION protect_blog_article_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'blog revisions cannot be deleted';
  END IF;
  IF NEW.id<>OLD.id OR NEW.article_id<>OLD.article_id OR NEW.author_user_id<>OLD.author_user_id
    OR NEW.title<>OLD.title OR NEW.summary<>OLD.summary OR NEW.blocks<>OLD.blocks
    OR NEW.citations<>OLD.citations OR NEW.content_hash<>OLD.content_hash OR NEW.created_at<>OLD.created_at
    OR NOT (
      (OLD.revision_state='working' AND NEW.revision_state IN ('published','superseded'))
      OR (OLD.revision_state='published' AND NEW.revision_state='superseded')
    ) THEN
    RAISE EXCEPTION 'blog revision content is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_article_revisions_protected
  BEFORE UPDATE OR DELETE ON blog_article_revisions
  FOR EACH ROW EXECUTE FUNCTION protect_blog_article_revision();

CREATE FUNCTION reject_blog_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'blog audit records are append-only';
END;
$$;

CREATE TRIGGER blog_revision_research_provenance_append_only
  BEFORE UPDATE OR DELETE ON blog_revision_research_provenance
  FOR EACH ROW EXECUTE FUNCTION reject_blog_append_only_mutation();
CREATE TRIGGER blog_article_events_append_only
  BEFORE UPDATE OR DELETE ON blog_article_events
  FOR EACH ROW EXECUTE FUNCTION reject_blog_append_only_mutation();

COMMIT;
