BEGIN;

CREATE TABLE agent_behavior_profiles (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  schema_version text NOT NULL CHECK (schema_version='agent-behavior-v1'),
  profile jsonb NOT NULL CHECK (
    jsonb_typeof(profile)='object'
    AND profile->>'schemaVersion'='agent-behavior-v1'
    AND jsonb_typeof(profile->'core')='object'
    AND jsonb_typeof(profile->'modules')='object'
    AND octet_length(profile::text)<=12288
  ),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,version),
  UNIQUE(agent_user_id,id)
);

CREATE TABLE agent_behavior_profile_assignments (
  agent_user_id uuid PRIMARY KEY REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  active_profile_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(agent_user_id,active_profile_id)
    REFERENCES agent_behavior_profiles(agent_user_id,id) ON DELETE RESTRICT
);

WITH seeded AS (
  INSERT INTO agent_behavior_profiles(id,agent_user_id,version,schema_version,profile,created_by_user_id)
  SELECT gen_random_uuid(),a.user_id,1,'agent-behavior-v1',
    jsonb_build_object(
      'schemaVersion','agent-behavior-v1',
      'core',jsonb_build_object(
        'mission','发现、研究并向中文读者介绍真正有用或有趣的开放项目，诚实说明证据边界，不把营销包装当成事实。',
        'personality','好奇、审慎、有判断力；愿意关注小而巧的创意，也不会因为热门术语或夸张名称高估项目。',
        'voice','使用自然、具体、克制的简体中文，先讲清项目解决什么问题，再解释适合谁以及如何开始。',
        'audience','对人工智能、数字工具、游戏和开放创作感兴趣的普通中文读者与开发者。'
      ),
      'modules',jsonb_build_object('editorial',jsonb_build_object(
        'persona','像一位好奇但不追逐噱头的科技选题编辑。优先选择能快速看到结果、具有互动或创作空间、解决常见问题，或者实现方式令人意外的项目；所有判断都必须来自候选仓库证据。',
        'comparisonEnabled',true,
        'interestSignals',jsonb_build_array('可以快速体验','结果直观或可视化','实现方式有创意','解决常见但容易忽略的问题','能够生成或分享作品','适合学习和探索')
      ))
    ),a.operator_user_id
  FROM agent_accounts a
  RETURNING agent_user_id,id,created_by_user_id
)
INSERT INTO agent_behavior_profile_assignments(agent_user_id,active_profile_id,updated_by_user_id)
SELECT agent_user_id,id,created_by_user_id FROM seeded;

ALTER TABLE agent_blog_runs ADD COLUMN behavior_profile_id uuid;
UPDATE agent_blog_runs r SET behavior_profile_id=a.active_profile_id
FROM agent_behavior_profile_assignments a WHERE a.agent_user_id=r.agent_user_id;
ALTER TABLE agent_blog_runs ALTER COLUMN behavior_profile_id SET NOT NULL;
ALTER TABLE agent_blog_runs ADD CONSTRAINT agent_blog_runs_behavior_profile_fk
  FOREIGN KEY(agent_user_id,behavior_profile_id)
  REFERENCES agent_behavior_profiles(agent_user_id,id) ON DELETE RESTRICT;

CREATE FUNCTION guard_agent_behavior_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='agent_behavior_profiles' AND TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Agent behavior profile versions are immutable';
  END IF;
  IF TG_TABLE_NAME='agent_behavior_profile_assignments' AND TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Agent behavior profile assignment cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_behavior_profiles_immutable
  BEFORE UPDATE OR DELETE ON agent_behavior_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_agent_behavior_profile();
CREATE TRIGGER agent_behavior_assignments_guard
  BEFORE DELETE ON agent_behavior_profile_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_agent_behavior_profile();

COMMIT;
