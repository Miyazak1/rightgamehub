BEGIN;

CREATE TABLE game_save_policies (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id),
  namespace text NOT NULL CHECK (namespace ~ '^[a-z0-9._-]{1,64}$' AND namespace NOT LIKE '\_gamehub.%'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','active','retired')),
  max_slots integer NOT NULL DEFAULT 10 CHECK (max_slots BETWEEN 1 AND 10),
  max_document_bytes integer NOT NULL DEFAULT 262144 CHECK (max_document_bytes BETWEEN 1 AND 1048576),
  max_live_bytes integer NOT NULL DEFAULT 1048576 CHECK (max_live_bytes BETWEEN 1 AND 1048576),
  max_history_bytes integer NOT NULL DEFAULT 5242880 CHECK (max_history_bytes BETWEEN 0 AND 5242880),
  history_versions integer NOT NULL DEFAULT 5 CHECK (history_versions BETWEEN 0 AND 5),
  history_days integer NOT NULL DEFAULT 7 CHECK (history_days BETWEEN 0 AND 7),
  schema_min integer NOT NULL DEFAULT 1 CHECK (schema_min > 0),
  schema_max integer NOT NULL DEFAULT 1 CHECK (schema_max >= schema_min),
  content_types text[] NOT NULL DEFAULT ARRAY['application/json','application/octet-stream']
    CHECK (cardinality(content_types) > 0 AND content_types <@ ARRAY['application/json','application/octet-stream']::text[]),
  approved_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id,namespace)
);
CREATE TABLE game_save_policy_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_id uuid NOT NULL REFERENCES game_save_policies(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_game_save_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'retire save policies instead of deleting them'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id,NEW.work_id,NEW.namespace,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.work_id,OLD.namespace,OLD.created_at) THEN
      RAISE EXCEPTION 'save policy identity is immutable';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_save_policy_guard BEFORE UPDATE OR DELETE ON game_save_policies FOR EACH ROW EXECUTE FUNCTION guard_game_save_policy();
CREATE FUNCTION audit_game_save_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO game_save_policy_events(policy_id,actor_user_id,reason,snapshot) VALUES(NEW.id,NEW.approved_by,NEW.reason,to_jsonb(NEW));
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_save_policy_audit AFTER INSERT OR UPDATE ON game_save_policies FOR EACH ROW EXECUTE FUNCTION audit_game_save_policy();

CREATE TABLE game_save_usage (
  user_id uuid NOT NULL REFERENCES users(id),
  work_id uuid NOT NULL REFERENCES works(id),
  channel text NOT NULL CHECK (channel IN ('production','preview')),
  live_slots integer NOT NULL DEFAULT 0 CHECK (live_slots BETWEEN 0 AND 10),
  live_bytes bigint NOT NULL DEFAULT 0 CHECK (live_bytes BETWEEN 0 AND 1048576),
  history_bytes bigint NOT NULL DEFAULT 0 CHECK (history_bytes BETWEEN 0 AND 5242880),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  reconciled_at timestamptz,
  PRIMARY KEY(user_id,work_id,channel)
);
-- Rate budget is shared by production and preview, unlike data and storage usage.
CREATE TABLE game_save_rate_usage (
  user_id uuid NOT NULL REFERENCES users(id),
  work_id uuid NOT NULL REFERENCES works(id),
  recent_writes timestamptz[] NOT NULL DEFAULT '{}',
  day date NOT NULL,
  day_writes integer NOT NULL DEFAULT 0 CHECK (day_writes >= 0),
  day_bytes bigint NOT NULL DEFAULT 0 CHECK (day_bytes >= 0),
  PRIMARY KEY(user_id,work_id)
);
CREATE TABLE game_save_slots (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  work_id uuid NOT NULL,
  channel text NOT NULL,
  namespace text NOT NULL,
  slot_key text NOT NULL CHECK (slot_key ~ '^[a-z0-9._-]{1,64}$' AND slot_key NOT LIKE '\_gamehub.%'),
  current_revision_id uuid,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY(user_id,work_id,channel) REFERENCES game_save_usage(user_id,work_id,channel),
  FOREIGN KEY(work_id,namespace) REFERENCES game_save_policies(work_id,namespace),
  UNIQUE(user_id,work_id,channel,namespace,slot_key)
);
CREATE TABLE game_save_revisions (
  id uuid PRIMARY KEY,
  slot_id uuid NOT NULL REFERENCES game_save_slots(id),
  revision bigint NOT NULL CHECK (revision > 0),
  base_revision bigint NOT NULL CHECK (base_revision >= 0 AND revision = base_revision + 1),
  etag text NOT NULL UNIQUE CHECK (etag ~ '^"ghsave-[A-Za-z0-9_-]{32}"$'),
  schema_version integer,
  content_type text,
  content_encoding text NOT NULL DEFAULT 'identity' CHECK (content_encoding = 'identity'),
  payload_sha256 text,
  stored_bytes integer NOT NULL CHECK (stored_bytes BETWEEN 0 AND 1048576),
  release_id uuid NOT NULL REFERENCES releases(id),
  source_kind text NOT NULL CHECK (source_kind IN ('write','delete','restore')),
  created_at timestamptz NOT NULL,
  restored_from_revision_id uuid,
  tombstone boolean NOT NULL,
  UNIQUE(slot_id,revision),
  UNIQUE(slot_id,id),
  FOREIGN KEY(slot_id,restored_from_revision_id) REFERENCES game_save_revisions(slot_id,id),
  CHECK ((tombstone AND schema_version IS NULL AND content_type IS NULL AND payload_sha256 IS NULL AND stored_bytes = 0 AND source_kind = 'delete')
    OR (NOT tombstone AND schema_version IS NOT NULL AND schema_version > 0 AND content_type IS NOT NULL AND content_type IN ('application/json','application/octet-stream')
      AND payload_sha256 IS NOT NULL AND payload_sha256 ~ '^[a-f0-9]{64}$' AND source_kind IN ('write','restore'))),
  CHECK ((source_kind = 'restore') = (restored_from_revision_id IS NOT NULL))
);
ALTER TABLE game_save_slots ADD CONSTRAINT game_save_current_revision_same_slot
  FOREIGN KEY(id,current_revision_id) REFERENCES game_save_revisions(slot_id,id) DEFERRABLE INITIALLY DEFERRED;
-- Immutable facts and disposable bytes have different lifetimes. Purging a
-- history payload never mutates a revision or an idempotency receipt.
CREATE TABLE game_save_payloads (
  revision_id uuid PRIMARY KEY REFERENCES game_save_revisions(id),
  payload_inline bytea NOT NULL CHECK (octet_length(payload_inline) <= 1048576)
);
CREATE TABLE game_save_operations (
  id uuid PRIMARY KEY,
  slot_id uuid NOT NULL REFERENCES game_save_slots(id),
  revision_id uuid NOT NULL,
  idempotency_key_hash bytea NOT NULL CHECK (octet_length(idempotency_key_hash) = 32),
  request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY(slot_id,revision_id) REFERENCES game_save_revisions(slot_id,id),
  UNIQUE(slot_id,idempotency_key_hash)
);
CREATE FUNCTION immutable_game_save_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'game save facts are append only'; END;
$$;
CREATE TRIGGER game_save_revision_immutable BEFORE UPDATE OR DELETE ON game_save_revisions FOR EACH ROW EXECUTE FUNCTION immutable_game_save_fact();
CREATE TRIGGER game_save_operation_immutable BEFORE UPDATE OR DELETE ON game_save_operations FOR EACH ROW EXECUTE FUNCTION immutable_game_save_fact();
CREATE TRIGGER game_save_policy_event_immutable BEFORE UPDATE OR DELETE ON game_save_policy_events FOR EACH ROW EXECUTE FUNCTION immutable_game_save_fact();

CREATE FUNCTION check_game_save_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot game_save_slots;
BEGIN
  SELECT * INTO slot FROM game_save_slots WHERE id=NEW.slot_id FOR UPDATE;
  IF NEW.base_revision <> slot.revision THEN RAISE EXCEPTION 'save revision must extend current revision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM releases WHERE id=NEW.release_id AND work_id=slot.work_id) THEN
    RAISE EXCEPTION 'save release belongs to another work';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION check_game_save_revision_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM game_save_slots WHERE id=NEW.slot_id AND revision>=NEW.revision) THEN
    RAISE EXCEPTION 'save revision must advance the current pointer in its transaction';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER game_save_revision_committed AFTER INSERT ON game_save_revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_game_save_revision_committed();
CREATE TRIGGER game_save_revision_chain BEFORE INSERT ON game_save_revisions FOR EACH ROW EXECUTE FUNCTION check_game_save_revision();

CREATE FUNCTION guard_game_save_slot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'delete saves with tombstone revisions'; END IF;
  IF ROW(NEW.id,NEW.user_id,NEW.work_id,NEW.channel,NEW.namespace,NEW.slot_key,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.work_id,OLD.channel,OLD.namespace,OLD.slot_key,OLD.created_at)
    OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'save slot identity is immutable and revision must advance'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_save_slot_guard BEFORE UPDATE OR DELETE ON game_save_slots FOR EACH ROW EXECUTE FUNCTION guard_game_save_slot();

CREATE FUNCTION check_game_save_current() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot game_save_slots; rev game_save_revisions;
BEGIN
  SELECT * INTO slot FROM game_save_slots WHERE id=NEW.id;
  SELECT * INTO rev FROM game_save_revisions WHERE id=slot.current_revision_id AND slot_id=slot.id;
  IF rev.id IS NULL OR rev.revision <> slot.revision OR rev.tombstone <> (slot.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'save current pointer must match slot and revision';
  END IF;
  IF NOT rev.tombstone AND NOT EXISTS(SELECT 1 FROM game_save_payloads WHERE revision_id=rev.id) THEN
    RAISE EXCEPTION 'current save payload is required';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER game_save_current_guard AFTER INSERT OR UPDATE ON game_save_slots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_game_save_current();

CREATE FUNCTION guard_game_save_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev game_save_revisions;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'save payload is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM game_save_slots WHERE current_revision_id=OLD.revision_id) THEN RAISE EXCEPTION 'cannot purge current save payload'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO rev FROM game_save_revisions WHERE id=NEW.revision_id;
  IF rev.tombstone OR octet_length(NEW.payload_inline) <> rev.stored_bytes
    OR encode(sha256(NEW.payload_inline),'hex') <> rev.payload_sha256 THEN RAISE EXCEPTION 'save payload differs from revision'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_save_payload_guard BEFORE INSERT OR UPDATE OR DELETE ON game_save_payloads FOR EACH ROW EXECUTE FUNCTION guard_game_save_payload();

CREATE INDEX game_save_revisions_slot_history_idx ON game_save_revisions(slot_id,revision DESC);
COMMIT;
