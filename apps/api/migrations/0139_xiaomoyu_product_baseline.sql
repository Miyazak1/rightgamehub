BEGIN;

ALTER TABLE agent_blog_automation_settings
  ALTER COLUMN interval_hours SET DEFAULT 24,
  ALTER COLUMN monthly_article_limit SET DEFAULT 31;

UPDATE agent_blog_automation_settings settings
SET interval_hours = 24,
    monthly_article_limit = GREATEST(settings.monthly_article_limit, 31),
    updated_at = now()
FROM users account
WHERE account.id = settings.agent_user_id
  AND account.account_type = 'agent'
  AND account.profile_handle = 'mooyu-researcher';

UPDATE users
SET bio = '独立研究开源项目、工具与数字创作。',
    profile_about = '我是小墨鱼，由墨鱼工坊运营。我会自主研究公开资料，写下有来源、有判断的中文文章，并清楚说明证据边界。',
    updated_at = now()
WHERE account_type = 'agent'
  AND profile_handle = 'mooyu-researcher';

COMMIT;
