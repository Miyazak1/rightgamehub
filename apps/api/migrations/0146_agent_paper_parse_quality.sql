BEGIN;

-- A parser success is not a quality claim.  Persist the deterministic quality
-- gate separately from the layout so later semantic readers cannot silently
-- upgrade a risky text layer.
CREATE TABLE agent_paper_parse_assessments (
  paper_version_id uuid PRIMARY KEY REFERENCES agent_paper_versions(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version=1),
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 3 AND 120),
  parser_version text NOT NULL CHECK (char_length(parser_version) BETWEEN 3 AND 120),
  reliability_grade text NOT NULL CHECK (reliability_grade IN (
    'trusted-text','limited-text','blocked'
  )),
  permitted_uses text[] NOT NULL CHECK (
    cardinality(permitted_uses) BETWEEN 0 AND 3
    AND permitted_uses <@ ARRAY['analysis','citation','comparison']::text[]
  ),
  reason_codes text[] NOT NULL CHECK (
    cardinality(reason_codes) BETWEEN 0 AND 9
    AND reason_codes <@ ARRAY[
      'EMPTY_TEXT_PAGES','SCANNED_PAGES','LOW_TEXT_DENSITY','READING_ORDER_UNCERTAIN',
      'MULTI_COLUMN_LAYOUT','TABLE_STRUCTURE_UNSUPPORTED','FORMULA_STRUCTURE_UNSUPPORTED',
      'IMAGE_CONTENT_UNREAD','EVIDENCE_COVERAGE_LOW'
    ]::text[]
  ),
  metrics_json jsonb NOT NULL CHECK (
    jsonb_typeof(metrics_json)='object' AND octet_length(metrics_json::text)<=65536
  ),
  assessment_sha256 text NOT NULL CHECK (assessment_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (reliability_grade='trusted-text'
      AND permitted_uses=ARRAY['analysis','citation','comparison']::text[]
      AND cardinality(reason_codes)=0)
    OR (reliability_grade='limited-text' AND permitted_uses=ARRAY['analysis']::text[])
    OR (reliability_grade='blocked' AND cardinality(permitted_uses)=0)
  )
);

CREATE INDEX agent_paper_parse_assessments_grade_created
  ON agent_paper_parse_assessments(reliability_grade,created_at,paper_version_id);

CREATE TRIGGER agent_paper_parse_assessments_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_parse_assessments
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

-- Contract v2 adds the deterministic parse-quality gate.  Preserve v1 grants
-- for historical runs, grant v2 to existing research agents, and make future
-- account provisioning seed both versions explicitly.
INSERT INTO agent_capability_grants(
  id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
)
SELECT gen_random_uuid(),account.user_id,'research.paper.read',2,
  jsonb_build_object('resourceTypes',jsonb_build_array('paper.arxiv')),
  'L1','active',account.operator_user_id,'论文解析质量门禁：只读 arXiv 论文证据能力 v2'
FROM agent_accounts account
WHERE 'blog:auto-publish'=ANY(account.capabilities)
  AND NOT EXISTS (
    SELECT 1 FROM agent_capability_grants existing
    WHERE existing.agent_user_id=account.user_id AND existing.capability_key='research.paper.read'
      AND existing.contract_version=2 AND existing.status='active'
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
      (gen_random_uuid(),NEW.user_id,'research.paper.read',2,jsonb_build_object('resourceTypes',jsonb_build_array('paper.arxiv')),'L1','active',NEW.operator_user_id,'论文解析质量门禁：只读 arXiv 论文证据能力 v2'),
      (gen_random_uuid(),NEW.user_id,'provider.text.generate',1,jsonb_build_object('resourceTypes',jsonb_build_array('provider.model')),'L2','active',NEW.operator_user_id,'博客迁移：受控文本生成能力'),
      (gen_random_uuid(),NEW.user_id,'blog.article.draft',1,jsonb_build_object('resourceTypes',jsonb_build_array('blog.private-draft')),'L2','active',NEW.operator_user_id,'博客迁移：私有文章草稿能力');
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
