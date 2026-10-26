BEGIN;

-- One Agent has exactly one public blog publisher at a time.  The row is the
-- serialization point shared by the legacy publisher and the future
-- Foundation publisher, so a cutover cannot race an in-flight publication.
CREATE TABLE agent_blog_publication_owners (
  agent_user_id uuid PRIMARY KEY REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  active_publisher text NOT NULL DEFAULT 'legacy'
    CHECK (active_publisher IN ('legacy','foundation')),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation BETWEEN 1 AND 9223372036854775807),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  switched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_blog_publication_owner_events (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_blog_publication_owners(agent_user_id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9223372036854775807),
  previous_publisher text CHECK (previous_publisher IS NULL OR previous_publisher IN ('legacy','foundation')),
  active_publisher text NOT NULL CHECK (active_publisher IN ('legacy','foundation')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,generation),
  CHECK ((generation=1 AND previous_publisher IS NULL)
    OR (generation>1 AND previous_publisher IS NOT NULL AND previous_publisher<>active_publisher))
);

INSERT INTO agent_blog_publication_owners(
  agent_user_id,active_publisher,generation,reason,updated_by_user_id
)
SELECT user_id,'legacy',1,'迁移时保留旧自动发布链路',operator_user_id
FROM agent_accounts;

INSERT INTO agent_blog_publication_owner_events(
  id,agent_user_id,generation,previous_publisher,active_publisher,reason,actor_user_id,created_at
)
SELECT gen_random_uuid(),agent_user_id,generation,NULL,active_publisher,reason,updated_by_user_id,created_at
FROM agent_blog_publication_owners;

CREATE FUNCTION guard_agent_blog_publication_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Agent blog publication ownership cannot be deleted';
  END IF;
  IF NEW.agent_user_id<>OLD.agent_user_id OR NEW.created_at<>OLD.created_at
    OR NEW.active_publisher=OLD.active_publisher
    OR NEW.generation<>OLD.generation+1
    OR char_length(btrim(NEW.reason))=0
    OR NEW.updated_by_user_id IS NULL
    OR NEW.switched_at<=OLD.switched_at
    OR NEW.updated_at<=OLD.updated_at THEN
    RAISE EXCEPTION 'Invalid Agent blog publication ownership transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION audit_agent_blog_publication_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO agent_blog_publication_owner_events(
    id,agent_user_id,generation,previous_publisher,active_publisher,reason,actor_user_id,created_at
  ) VALUES(
    gen_random_uuid(),NEW.agent_user_id,NEW.generation,OLD.active_publisher,
    NEW.active_publisher,NEW.reason,NEW.updated_by_user_id,NEW.switched_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION seed_agent_blog_publication_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO agent_blog_publication_owners(
    agent_user_id,active_publisher,generation,reason,updated_by_user_id
  ) VALUES(NEW.user_id,'legacy',1,'新 Agent 默认使用旧自动发布链路',NEW.operator_user_id);
  INSERT INTO agent_blog_publication_owner_events(
    id,agent_user_id,generation,previous_publisher,active_publisher,reason,actor_user_id
  ) VALUES(
    gen_random_uuid(),NEW.user_id,1,NULL,'legacy','新 Agent 默认使用旧自动发布链路',NEW.operator_user_id
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION reject_agent_blog_publication_owner_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent blog publication ownership events are immutable';
END;
$$;

CREATE TRIGGER agent_blog_publication_owner_guard
  BEFORE UPDATE OR DELETE ON agent_blog_publication_owners
  FOR EACH ROW EXECUTE FUNCTION guard_agent_blog_publication_owner();
CREATE TRIGGER agent_blog_publication_owner_audit
  AFTER UPDATE ON agent_blog_publication_owners
  FOR EACH ROW EXECUTE FUNCTION audit_agent_blog_publication_owner();
CREATE TRIGGER agent_blog_publication_owner_seed
  AFTER INSERT ON agent_accounts
  FOR EACH ROW EXECUTE FUNCTION seed_agent_blog_publication_owner();
CREATE TRIGGER agent_blog_publication_owner_events_immutable
  BEFORE UPDATE OR DELETE ON agent_blog_publication_owner_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_blog_publication_owner_event_mutation();

COMMIT;
