BEGIN;

CREATE TABLE paper_study_documents (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_bytes bytea NOT NULL CHECK (octet_length(pdf_bytes) BETWEEN 5 AND 20971520),
  arxiv_id text,
  status text NOT NULL CHECK (status IN ('importing','imported','analyzing','analyzed','drafting','draft-ready','failed')),
  parsed_json jsonb,
  analysis_json jsonb,
  draft_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,source_sha256),
  CHECK (draft_json IS NULL OR (draft_json @> '{"private":true,"manualReviewRequired":true,"publicPublicationEnabled":false,"publicationState":"draft"}'::jsonb
    AND draft_json ?& ARRAY['content','paragraphEvidenceBindings','readingScope','contentSha256']))
);
CREATE TABLE paper_study_tasks (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES paper_study_documents(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('import','analyze','draft')),
  execution_agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  desired_run_id uuid NOT NULL UNIQUE,
  runtime_run_id uuid UNIQUE REFERENCES agent_runs(id) ON DELETE RESTRICT,
  result_json jsonb,
  result_sha256 text CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id,operation),
  CHECK ((result_json IS NULL)=(result_sha256 IS NULL))
);
CREATE INDEX paper_study_owner_history ON paper_study_documents(owner_user_id,created_at DESC,id);
CREATE INDEX paper_study_pending_tasks ON paper_study_tasks(created_at,id) WHERE runtime_run_id IS NULL;
CREATE FUNCTION protect_paper_study_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.source_sha256<>OLD.source_sha256
    OR NEW.pdf_bytes<>OLD.pdf_bytes OR NEW.arxiv_id IS DISTINCT FROM OLD.arxiv_id
    OR (OLD.parsed_json IS NOT NULL AND NEW.parsed_json IS DISTINCT FROM OLD.parsed_json)
    OR (OLD.analysis_json IS NOT NULL AND NEW.analysis_json IS DISTINCT FROM OLD.analysis_json)
    OR (OLD.draft_json IS NOT NULL AND NEW.draft_json IS DISTINCT FROM OLD.draft_json)
  THEN RAISE EXCEPTION 'PAPER_STUDY_CONTENT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER paper_study_content_immutable BEFORE UPDATE ON paper_study_documents
  FOR EACH ROW EXECUTE FUNCTION protect_paper_study_content();
CREATE FUNCTION protect_paper_study_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.document_id<>OLD.document_id OR NEW.operation<>OLD.operation
    OR NEW.execution_agent_user_id<>OLD.execution_agent_user_id OR NEW.desired_run_id<>OLD.desired_run_id
    OR (OLD.runtime_run_id IS NOT NULL AND NEW.runtime_run_id IS DISTINCT FROM OLD.runtime_run_id)
    OR (OLD.result_json IS NOT NULL AND (NEW.result_json IS DISTINCT FROM OLD.result_json OR NEW.result_sha256 IS DISTINCT FROM OLD.result_sha256))
  THEN RAISE EXCEPTION 'PAPER_STUDY_TASK_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER paper_study_task_immutable BEFORE UPDATE ON paper_study_tasks
  FOR EACH ROW EXECUTE FUNCTION protect_paper_study_task();

COMMIT;
