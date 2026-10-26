BEGIN;

CREATE TABLE agent_blog_foundation_drafts (
  run_id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL,
  action_id uuid NOT NULL UNIQUE,
  article_id uuid NOT NULL UNIQUE REFERENCES blog_articles(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL UNIQUE,
  source_artifact_ids uuid[] NOT NULL CHECK (cardinality(source_artifact_ids) BETWEEN 1 AND 32),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,agent_user_id) REFERENCES agent_runs(id,agent_user_id) ON DELETE RESTRICT,
  FOREIGN KEY(run_id,action_id) REFERENCES agent_run_actions(run_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(article_id,revision_id) REFERENCES blog_article_revisions(article_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION reject_agent_blog_foundation_draft_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent blog foundation draft mappings are immutable';
END;
$$;

CREATE TRIGGER agent_blog_foundation_drafts_immutable
  BEFORE UPDATE OR DELETE ON agent_blog_foundation_drafts
  FOR EACH ROW EXECUTE FUNCTION reject_agent_blog_foundation_draft_mutation();

COMMIT;
