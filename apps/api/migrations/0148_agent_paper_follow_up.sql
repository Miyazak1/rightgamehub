BEGIN;

-- R1.5 is a private, evidence-bound question/answer ledger over one immutable
-- R1.4 semantic analysis.  It is intentionally not part of public publishing.
CREATE TABLE agent_paper_follow_up_answers (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  semantic_analysis_id uuid NOT NULL,
  run_id uuid NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE RESTRICT,
  action_id uuid NOT NULL UNIQUE REFERENCES agent_run_actions(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version=1),
  question text NOT NULL CHECK (char_length(question) BETWEEN 2 AND 500),
  question_sha256 text NOT NULL CHECK (question_sha256 ~ '^[a-f0-9]{64}$'),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 8000),
  uncertainty text NOT NULL CHECK (uncertainty IN ('none','bounded','insufficient-evidence')),
  finding_keys jsonb NOT NULL CHECK (
    jsonb_typeof(finding_keys)='array' AND jsonb_array_length(finding_keys)<=32
  ),
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 3 AND 120),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 3 AND 120),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 120),
  model_id text NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 240),
  answer_sha256 text NOT NULL CHECK (answer_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,request_id),
  UNIQUE(id,agent_user_id),
  FOREIGN KEY(semantic_analysis_id,agent_user_id)
    REFERENCES agent_paper_semantic_analyses(id,agent_user_id) ON DELETE RESTRICT
);

CREATE INDEX agent_paper_follow_up_answers_analysis_created
  ON agent_paper_follow_up_answers(semantic_analysis_id,created_at,id);
CREATE INDEX agent_paper_follow_up_answers_agent_created
  ON agent_paper_follow_up_answers(agent_user_id,created_at DESC,id DESC);

CREATE TABLE agent_paper_follow_up_evidence_links (
  answer_id uuid NOT NULL REFERENCES agent_paper_follow_up_answers(id) ON DELETE RESTRICT,
  finding_key text NOT NULL CHECK (finding_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  evidence_id uuid NOT NULL REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  evidence_index integer NOT NULL CHECK (evidence_index BETWEEN 1 AND 96),
  relation text NOT NULL CHECK (relation IN ('supports','weakens','contradicts','context')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(answer_id,finding_key,evidence_id,relation)
);

CREATE INDEX agent_paper_follow_up_evidence_links_evidence
  ON agent_paper_follow_up_evidence_links(evidence_id,answer_id,finding_key);

CREATE TRIGGER agent_paper_follow_up_answers_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_follow_up_answers
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_follow_up_evidence_links_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_follow_up_evidence_links
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

INSERT INTO agent_capability_grants(
  id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
)
SELECT gen_random_uuid(),account.user_id,'research.paper.follow-up',1,
  jsonb_build_object('resourceTypes',jsonb_build_array('paper.semantic-follow-up')),
  'L2','active',account.operator_user_id,'论文证据追问：私有、单次模型调用、不可变引用回答'
FROM agent_accounts account
WHERE 'blog:auto-publish'=ANY(account.capabilities)
  AND NOT EXISTS (
    SELECT 1 FROM agent_capability_grants existing
    WHERE existing.agent_user_id=account.user_id
      AND existing.capability_key='research.paper.follow-up'
      AND existing.contract_version=1 AND existing.status='active' AND existing.valid_until IS NULL
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
      (gen_random_uuid(),NEW.user_id,'research.paper.analyze',1,jsonb_build_object('resourceTypes',jsonb_build_array('paper.semantic-analysis')),'L2','active',NEW.operator_user_id,'论文语义阅读：私有且证据约束的不可变分析'),
      (gen_random_uuid(),NEW.user_id,'research.paper.follow-up',1,jsonb_build_object('resourceTypes',jsonb_build_array('paper.semantic-follow-up')),'L2','active',NEW.operator_user_id,'论文证据追问：私有、单次模型调用、不可变引用回答'),
      (gen_random_uuid(),NEW.user_id,'provider.text.generate',1,jsonb_build_object('resourceTypes',jsonb_build_array('provider.model')),'L2','active',NEW.operator_user_id,'博客迁移：受控文本生成能力'),
      (gen_random_uuid(),NEW.user_id,'blog.article.draft',1,jsonb_build_object('resourceTypes',jsonb_build_array('blog.private-draft')),'L2','active',NEW.operator_user_id,'博客迁移：私有文章草稿能力');
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
