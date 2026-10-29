BEGIN;

-- Paper identity, version lineage and layout extend the shared research
-- evidence ledger. Quote ownership remains in tool_research_evidence.
CREATE TABLE agent_paper_identities (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  canonical_id text NOT NULL CHECK (char_length(canonical_id) BETWEEN 5 AND 300),
  doi text CHECK (doi IS NULL OR char_length(doi) BETWEEN 5 AND 300),
  arxiv_id text CHECK (arxiv_id IS NULL OR char_length(arxiv_id) BETWEEN 5 AND 120),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 1000),
  authors jsonb NOT NULL CHECK (jsonb_typeof(authors)='array' AND jsonb_array_length(authors) BETWEEN 1 AND 200),
  publication_year integer NOT NULL CHECK (publication_year BETWEEN 1600 AND 3000),
  venue text CHECK (venue IS NULL OR char_length(venue) BETWEEN 1 AND 500),
  identity_confidence text NOT NULL CHECK (identity_confidence IN ('confirmed','provisional','unresolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,canonical_id),
  CHECK (doi IS NOT NULL OR arxiv_id IS NOT NULL)
);

CREATE TABLE agent_paper_versions (
  id uuid PRIMARY KEY,
  paper_identity_id uuid NOT NULL REFERENCES agent_paper_identities(id) ON DELETE RESTRICT,
  research_source_version_id uuid NOT NULL UNIQUE REFERENCES tool_research_source_versions(id) ON DELETE RESTRICT,
  external_artifact_version_id uuid NOT NULL,
  version_kind text NOT NULL CHECK (version_kind IN (
    'preprint','conference','journal','author-manuscript','supplement','erratum',
    'retraction-notice','unknown'
  )),
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  access_level text NOT NULL CHECK (access_level IN (
    'metadata-only','abstract-only','fulltext-open','fulltext-user-provided','fulltext-restricted'
  )),
  parent_version_id uuid REFERENCES agent_paper_versions(id) ON DELETE RESTRICT,
  version_relation text NOT NULL CHECK (version_relation IN (
    'initial','revises','supplements','corrects','retracts','related-unconfirmed'
  )),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(paper_identity_id,external_artifact_version_id),
  CHECK ((version_relation='initial')=(parent_version_id IS NULL))
);

CREATE INDEX agent_paper_versions_identity_created
  ON agent_paper_versions(paper_identity_id,created_at,id);

CREATE TABLE agent_paper_layout_manifests (
  paper_version_id uuid PRIMARY KEY REFERENCES agent_paper_versions(id) ON DELETE RESTRICT,
  parser_version text NOT NULL CHECK (char_length(parser_version) BETWEEN 3 AND 120),
  page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 5000),
  manifest_json jsonb NOT NULL CHECK (
    jsonb_typeof(manifest_json)='object' AND octet_length(manifest_json::text)<=2097152
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_agent_paper_research_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent paper research records are immutable';
END;
$$;

CREATE TRIGGER agent_paper_identities_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_identities
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_versions_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_versions
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_layout_manifests_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_layout_manifests
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

-- Paper reading is a separate least-privilege, read-only capability. Register
-- it for existing autonomous research accounts and preserve that invariant for
-- accounts provisioned after this migration.
INSERT INTO agent_capability_grants(
  id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
)
SELECT gen_random_uuid(),account.user_id,'research.paper.read',1,
  jsonb_build_object('resourceTypes',jsonb_build_array('paper.arxiv')),
  'L1','active',account.operator_user_id,'多源研究基座：只读 arXiv 论文证据能力'
FROM agent_accounts account
WHERE 'blog:auto-publish'=ANY(account.capabilities)
  AND NOT EXISTS (
    SELECT 1 FROM agent_capability_grants existing
    WHERE existing.agent_user_id=account.user_id AND existing.capability_key='research.paper.read'
      AND existing.contract_version=1 AND existing.status='active'
      AND existing.valid_until IS NULL
  );

CREATE OR REPLACE FUNCTION seed_agent_blog_foundation_capabilities() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF 'blog:auto-publish'=ANY(NEW.capabilities) THEN
    INSERT INTO agent_capability_grants(
      id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
    ) VALUES
      (gen_random_uuid(),NEW.user_id,'research.github.read',1,jsonb_build_object('resourceTypes',jsonb_build_array('github.repository')),'L1','active',NEW.operator_user_id,'博客迁移：只读 GitHub 研究能力'),
      (gen_random_uuid(),NEW.user_id,'research.github.discover',1,jsonb_build_object('resourceTypes',jsonb_build_array('github.repository-search')),'L1','active',NEW.operator_user_id,'博客候选发现：只读 GitHub 仓库搜索'),
      (gen_random_uuid(),NEW.user_id,'research.paper.read',1,jsonb_build_object('resourceTypes',jsonb_build_array('paper.arxiv')),'L1','active',NEW.operator_user_id,'多源研究基座：只读 arXiv 论文证据能力'),
      (gen_random_uuid(),NEW.user_id,'provider.text.generate',1,jsonb_build_object('resourceTypes',jsonb_build_array('provider.model')),'L2','active',NEW.operator_user_id,'博客迁移：受控文本生成能力'),
      (gen_random_uuid(),NEW.user_id,'blog.article.draft',1,jsonb_build_object('resourceTypes',jsonb_build_array('blog.private-draft')),'L2','active',NEW.operator_user_id,'博客迁移：私有文章草稿能力');
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
