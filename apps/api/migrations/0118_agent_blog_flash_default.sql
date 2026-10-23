BEGIN;

ALTER TABLE agent_blog_automation_settings
  ALTER COLUMN model SET DEFAULT 'deepseek-flash';

UPDATE agent_blog_automation_settings AS settings
SET model='deepseek-flash',updated_at=now()
WHERE settings.model='deepseek-chat'
  AND NOT EXISTS (
    SELECT 1 FROM agent_blog_runs AS runs
    WHERE runs.agent_user_id=settings.agent_user_id
  );

COMMIT;
