BEGIN;

ALTER TABLE agent_accounts DROP CONSTRAINT agent_accounts_capabilities_check;
ALTER TABLE agent_accounts ADD CONSTRAINT agent_accounts_capabilities_check
  CHECK (capabilities <@ ARRAY['research:qa','blog:auto-publish']::text[]);
ALTER TABLE agent_execution_principals DROP CONSTRAINT agent_execution_principals_capabilities_check;
ALTER TABLE agent_execution_principals ADD CONSTRAINT agent_execution_principals_capabilities_check
  CHECK (capabilities <@ ARRAY['research:qa','blog:auto-publish']::text[]);

CREATE TABLE agent_provider_secrets (
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('deepseek')),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 4096),
  nonce bytea NOT NULL CHECK (octet_length(nonce)=12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag)=16),
  key_fingerprint text NOT NULL CHECK (key_fingerprint ~ '^[a-f0-9]{64}$'),
  key_last_four text NOT NULL CHECK (char_length(key_last_four) BETWEEN 1 AND 4),
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agent_user_id,provider)
);

CREATE TABLE agent_blog_automation_settings (
  agent_user_id uuid PRIMARY KEY REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  auto_publish boolean NOT NULL DEFAULT true CHECK (auto_publish=true),
  locale text NOT NULL DEFAULT 'zh-CN' CHECK (locale='zh-CN'),
  model text NOT NULL DEFAULT 'deepseek-chat' CHECK (model ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  interval_hours integer NOT NULL DEFAULT 84 CHECK (interval_hours BETWEEN 24 AND 720),
  monthly_article_limit integer NOT NULL DEFAULT 8 CHECK (monthly_article_limit BETWEEN 1 AND 100),
  topic_scope text NOT NULL DEFAULT '人文、历史、地理、科学、游戏与数字创作中的大众知识' CHECK (char_length(btrim(topic_scope)) BETWEEN 10 AND 1000),
  next_run_at timestamptz,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR next_run_at IS NOT NULL)
);

CREATE TABLE agent_blog_runs (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('schedule','manual')),
  status text NOT NULL CHECK (status IN ('queued','generating','checking','published','rejected','failed')),
  model text NOT NULL CHECK (model ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  topic_scope text NOT NULL CHECK (char_length(btrim(topic_scope)) BETWEEN 10 AND 1000),
  article_id uuid REFERENCES blog_articles(id) ON DELETE RESTRICT,
  article_title text,
  withdrawn_at timestamptz,
  withdrawn_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason_codes text[] NOT NULL DEFAULT '{}',
  provider_usage jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(provider_usage)='object' AND octet_length(provider_usage::text)<=16384),
  error_code text,
  error_message text CHECK (error_message IS NULL OR char_length(error_message)<=500),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('queued','generating','checking') AND finished_at IS NULL) OR (status IN ('published','rejected','failed') AND finished_at IS NOT NULL)),
  CHECK ((status='published' AND article_id IS NOT NULL AND article_title IS NOT NULL) OR status<>'published'),
  CHECK ((withdrawn_at IS NULL AND withdrawn_by_user_id IS NULL) OR (status='published' AND article_id IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawn_by_user_id IS NOT NULL))
);

CREATE UNIQUE INDEX agent_blog_one_active_run
  ON agent_blog_runs(agent_user_id) WHERE status IN ('queued','generating','checking');
CREATE INDEX agent_blog_runs_agent_history
  ON agent_blog_runs(agent_user_id,created_at DESC,id DESC);
CREATE INDEX agent_blog_due_settings
  ON agent_blog_automation_settings(next_run_at,agent_user_id) WHERE enabled=true;

CREATE FUNCTION reject_agent_secret_delete_or_direct_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.agent_user_id<>OLD.agent_user_id OR NEW.provider<>OLD.provider OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Agent provider secret identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_provider_secret_identity_guard
  BEFORE UPDATE ON agent_provider_secrets FOR EACH ROW EXECUTE FUNCTION reject_agent_secret_delete_or_direct_update();

COMMIT;
