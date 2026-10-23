BEGIN;

CREATE TABLE blog_article_questions (
  id uuid PRIMARY KEY,
  article_id uuid NOT NULL REFERENCES blog_articles(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL,
  asker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  parent_question_id uuid REFERENCES blog_article_questions(id) ON DELETE RESTRICT,
  depth smallint NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 4),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 2 AND 500),
  answer text CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 1 AND 4000),
  citation_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(citation_ids)='array' AND jsonb_array_length(citation_ids)<=20),
  evidence_snapshot_hash text NOT NULL CHECK (evidence_snapshot_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('processing','completed','failed','unknown')),
  provider text NOT NULL DEFAULT 'deepseek' CHECK (provider='deepseek'),
  model text NOT NULL CHECK (model ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  provider_usage jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_usage)='object' AND octet_length(provider_usage::text)<=16384),
  provider_request_id text CHECK (provider_request_id IS NULL OR char_length(provider_request_id)<=200),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{2,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(asker_user_id,idempotency_key),
  UNIQUE(article_id,revision_id,id),
  UNIQUE(asker_user_id,article_id,revision_id,id),
  FOREIGN KEY(article_id,revision_id) REFERENCES blog_article_revisions(article_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(asker_user_id,article_id,revision_id,parent_question_id)
    REFERENCES blog_article_questions(asker_user_id,article_id,revision_id,id) ON DELETE RESTRICT,
  CHECK (
    (status='processing' AND answer IS NULL AND completed_at IS NULL AND error_code IS NULL)
    OR (status='completed' AND answer IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status IN ('failed','unknown') AND answer IS NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX blog_article_questions_asker_daily_idx
  ON blog_article_questions(asker_user_id,created_at DESC);
CREATE INDEX blog_article_questions_agent_daily_idx
  ON blog_article_questions(agent_user_id,created_at DESC);
CREATE INDEX blog_article_questions_article_idx
  ON blog_article_questions(article_id,revision_id,created_at,id);

CREATE FUNCTION guard_blog_article_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Article questions cannot be deleted'; END IF;
  IF OLD.status<>'processing' OR NEW.status NOT IN ('completed','failed','unknown')
    OR NEW.id<>OLD.id OR NEW.article_id<>OLD.article_id OR NEW.revision_id<>OLD.revision_id
    OR NEW.asker_user_id<>OLD.asker_user_id OR NEW.agent_user_id<>OLD.agent_user_id
    OR NEW.parent_question_id IS DISTINCT FROM OLD.parent_question_id OR NEW.depth<>OLD.depth
    OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_hash<>OLD.request_hash
    OR NEW.question<>OLD.question OR NEW.evidence_snapshot_hash<>OLD.evidence_snapshot_hash
    OR NEW.provider<>OLD.provider OR NEW.model<>OLD.model OR NEW.created_at<>OLD.created_at
  THEN RAISE EXCEPTION 'Article question identity and terminal state are immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_article_questions_guard
  BEFORE UPDATE OR DELETE ON blog_article_questions
  FOR EACH ROW EXECUTE FUNCTION guard_blog_article_question();

COMMIT;
