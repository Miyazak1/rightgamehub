BEGIN;

ALTER TABLE works ADD COLUMN game_session_generation bigint NOT NULL DEFAULT 0 CHECK (game_session_generation >= 0);
ALTER TABLE work_targets ADD COLUMN game_session_generation bigint NOT NULL DEFAULT 0 CHECK (game_session_generation >= 0);
ALTER TABLE releases ADD COLUMN game_session_generation bigint NOT NULL DEFAULT 0 CHECK (game_session_generation >= 0);
ALTER TABLE releases ADD CONSTRAINT releases_work_id_id_unique UNIQUE (work_id, id);
ALTER TABLE device_grants ADD CONSTRAINT device_grants_user_id_id_unique UNIQUE (user_id, id);

-- This table is platform control-plane approval, never populated by a ZIP manifest.
CREATE TABLE game_release_service_scopes (
  work_id uuid NOT NULL,
  release_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('production', 'preview')),
  status text NOT NULL DEFAULT 'retired' CHECK (status IN ('active', 'retired')),
  namespaces jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(namespaces) = 'object'),
  mode_ids uuid[] NOT NULL DEFAULT '{}',
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  approved_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, channel),
  FOREIGN KEY (work_id, release_id) REFERENCES releases(work_id, id)
);

CREATE FUNCTION bump_game_session_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'works' THEN
    IF ROW(OLD.state, OLD.visibility, OLD.owner_user_id) IS DISTINCT FROM ROW(NEW.state, NEW.visibility, NEW.owner_user_id) THEN
      NEW.game_session_generation := OLD.game_session_generation + 1;
    END IF;
  ELSIF TG_TABLE_NAME = 'work_targets' THEN
    IF OLD.state IS DISTINCT FROM NEW.state THEN NEW.game_session_generation := OLD.game_session_generation + 1; END IF;
  ELSE
    IF ROW(OLD.serving_state, OLD.validation_state, OLD.approved_capabilities) IS DISTINCT FROM ROW(NEW.serving_state, NEW.validation_state, NEW.approved_capabilities) THEN
      NEW.game_session_generation := OLD.game_session_generation + 1;
    END IF;
  END IF;
  IF NEW.game_session_generation < OLD.game_session_generation THEN RAISE EXCEPTION 'game session generation cannot decrease'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER works_game_session_generation BEFORE UPDATE ON works FOR EACH ROW EXECUTE FUNCTION bump_game_session_generation();
CREATE TRIGGER targets_game_session_generation BEFORE UPDATE ON work_targets FOR EACH ROW EXECUTE FUNCTION bump_game_session_generation();
CREATE TRIGGER releases_game_session_generation BEFORE UPDATE ON releases FOR EACH ROW EXECUTE FUNCTION bump_game_session_generation();

CREATE FUNCTION bump_game_service_scope_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.generation := OLD.generation + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_service_scope_generation BEFORE UPDATE ON game_release_service_scopes FOR EACH ROW EXECUTE FUNCTION bump_game_service_scope_generation();

CREATE TABLE game_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  release_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('production', 'preview')),
  launch_nonce uuid NOT NULL,
  capabilities text[] NOT NULL CHECK (capabilities <@ ARRAY['identity','multiplayer','cloudSave','competition']::text[]),
  namespaces jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(namespaces) = 'object'),
  mode_ids uuid[] NOT NULL DEFAULT '{}',
  work_generation bigint NOT NULL CHECK (work_generation >= 0),
  target_generation bigint NOT NULL CHECK (target_generation >= 0),
  release_generation bigint NOT NULL CHECK (release_generation >= 0),
  scope_generation bigint NOT NULL CHECK (scope_generation >= 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (user_id, grant_id) REFERENCES device_grants(user_id, id),
  FOREIGN KEY (work_id, release_id) REFERENCES releases(work_id, id),
  UNIQUE (grant_id, launch_nonce),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '15 minutes')
);
CREATE INDEX game_sessions_expiry_idx ON game_sessions(expires_at);
CREATE INDEX game_sessions_grant_active_idx ON game_sessions(grant_id, expires_at) WHERE revoked_at IS NULL;


-- Scope approvals keep an append-only audit trail, including retirement. Deletion
-- would permit a new row to reset the generation and revive an old session.
CREATE TABLE game_service_scope_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id),
  channel text NOT NULL,
  generation bigint NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_game_service_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'retire service scopes instead of deleting them'; END IF;
  IF ROW(NEW.release_id, NEW.work_id, NEW.channel) IS DISTINCT FROM ROW(OLD.release_id, OLD.work_id, OLD.channel) THEN
    RAISE EXCEPTION 'service scope identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_service_scope_identity BEFORE UPDATE OR DELETE ON game_release_service_scopes FOR EACH ROW EXECUTE FUNCTION protect_game_service_scope();
CREATE FUNCTION audit_game_service_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO game_service_scope_events(release_id,channel,generation,actor_user_id,reason,snapshot)
    VALUES(NEW.release_id,NEW.channel,NEW.generation,NEW.approved_by,NEW.reason,to_jsonb(NEW));
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_service_scope_audit AFTER INSERT OR UPDATE ON game_release_service_scopes FOR EACH ROW EXECUTE FUNCTION audit_game_service_scope();
CREATE FUNCTION protect_game_session_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'game session authorization is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_session_authorization BEFORE UPDATE ON game_sessions FOR EACH ROW EXECUTE FUNCTION protect_game_session_authorization();
CREATE FUNCTION protect_game_service_scope_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'game service scope audit is append only'; END;
$$;
CREATE TRIGGER game_service_scope_event_immutable BEFORE UPDATE OR DELETE ON game_service_scope_events FOR EACH ROW EXECUTE FUNCTION protect_game_service_scope_event();

COMMIT;
