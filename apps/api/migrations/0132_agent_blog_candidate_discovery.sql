BEGIN;

-- Discovery is deliberately a separate least-privilege capability. Search
-- results can nominate repositories, but cannot read revision-pinned evidence
-- or write a draft.
INSERT INTO agent_capability_grants(
  id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
)
SELECT gen_random_uuid(),account.user_id,'research.github.discover',1,
  jsonb_build_object('resourceTypes',jsonb_build_array('github.repository-search')),
  'L1','active',account.operator_user_id,'博客候选发现：只读 GitHub 仓库搜索'
FROM agent_accounts account
WHERE 'blog:auto-publish'=ANY(account.capabilities)
  AND NOT EXISTS (
    SELECT 1 FROM agent_capability_grants existing
    WHERE existing.agent_user_id=account.user_id
      AND existing.capability_key='research.github.discover'
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
      (gen_random_uuid(),NEW.user_id,'provider.text.generate',1,jsonb_build_object('resourceTypes',jsonb_build_array('provider.model')),'L2','active',NEW.operator_user_id,'博客迁移：受控文本生成能力'),
      (gen_random_uuid(),NEW.user_id,'blog.article.draft',1,jsonb_build_object('resourceTypes',jsonb_build_array('blog.private-draft')),'L2','active',NEW.operator_user_id,'博客迁移：私有文章草稿能力');
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
