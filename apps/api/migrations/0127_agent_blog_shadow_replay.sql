BEGIN;

-- Separate read, model, private draft and public publication authority.  These
-- grants are inert until an active workflow declares and a Policy decision
-- authorizes the matching capability.
WITH capabilities(capability_key,risk_ceiling,scope_json,reason) AS (
  VALUES
    ('research.github.read','L1',jsonb_build_object('resourceTypes',jsonb_build_array('github.repository')),'博客迁移：只读 GitHub 研究能力'),
    ('provider.text.generate','L2',jsonb_build_object('resourceTypes',jsonb_build_array('provider.model')),'博客迁移：受控文本生成能力'),
    ('blog.article.draft','L2',jsonb_build_object('resourceTypes',jsonb_build_array('blog.private-draft')),'博客迁移：私有文章草稿能力')
)
INSERT INTO agent_capability_grants(
  id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
)
SELECT gen_random_uuid(),account.user_id,capability.capability_key,1,capability.scope_json,capability.risk_ceiling,
  'active',account.operator_user_id,capability.reason
FROM agent_accounts account CROSS JOIN capabilities capability
WHERE 'blog:auto-publish'=ANY(account.capabilities)
  AND NOT EXISTS (
    SELECT 1 FROM agent_capability_grants existing
    WHERE existing.agent_user_id=account.user_id AND existing.capability_key=capability.capability_key
      AND existing.contract_version=1 AND existing.status='active' AND existing.valid_until IS NULL
  );

CREATE FUNCTION seed_agent_blog_foundation_capabilities() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF 'blog:auto-publish'=ANY(NEW.capabilities) THEN
    INSERT INTO agent_capability_grants(
      id,agent_user_id,capability_key,contract_version,scope_json,risk_ceiling,status,granted_by_user_id,reason
    ) VALUES
      (gen_random_uuid(),NEW.user_id,'research.github.read',1,jsonb_build_object('resourceTypes',jsonb_build_array('github.repository')),'L1','active',NEW.operator_user_id,'博客迁移：只读 GitHub 研究能力'),
      (gen_random_uuid(),NEW.user_id,'provider.text.generate',1,jsonb_build_object('resourceTypes',jsonb_build_array('provider.model')),'L2','active',NEW.operator_user_id,'博客迁移：受控文本生成能力'),
      (gen_random_uuid(),NEW.user_id,'blog.article.draft',1,jsonb_build_object('resourceTypes',jsonb_build_array('blog.private-draft')),'L2','active',NEW.operator_user_id,'博客迁移：私有文章草稿能力');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_blog_foundation_capability_seed
  AFTER INSERT ON agent_accounts FOR EACH ROW EXECUTE FUNCTION seed_agent_blog_foundation_capabilities();

CREATE TABLE agent_blog_shadow_replay_artifacts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  agent_user_id uuid NOT NULL,
  legacy_run_id uuid NOT NULL UNIQUE REFERENCES agent_blog_runs(id) ON DELETE RESTRICT,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  verdict text NOT NULL CHECK (verdict IN ('exact','invalid')),
  report_json jsonb NOT NULL CHECK (jsonb_typeof(report_json)='object' AND octet_length(report_json::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id),
  FOREIGN KEY(run_id,agent_user_id) REFERENCES agent_runs(id,agent_user_id) ON DELETE RESTRICT
);

CREATE FUNCTION reject_agent_blog_shadow_replay_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent blog shadow replay artifacts are immutable';
END;
$$;

CREATE TRIGGER agent_blog_shadow_replay_immutable
  BEFORE UPDATE OR DELETE ON agent_blog_shadow_replay_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_agent_blog_shadow_replay_mutation();

COMMIT;
