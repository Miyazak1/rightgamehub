BEGIN;

-- Question money ledger only. No provider, runtime route, publication or account seed.
CREATE TABLE research_qa_budgets (
  account_key text PRIMARY KEY CHECK (account_key='global' OR account_key ~ '^user:[a-f0-9-]{36}$'),
  limit_micros bigint NOT NULL CHECK (limit_micros>=0),
  held_micros bigint NOT NULL DEFAULT 0 CHECK (held_micros>=0),
  spent_micros bigint NOT NULL DEFAULT 0 CHECK (spent_micros>=0),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0)
);
CREATE TABLE research_qa_questions (
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin_grant_id uuid NOT NULL REFERENCES device_grants(id) ON DELETE RESTRICT,
  article_id uuid NOT NULL REFERENCES blog_articles(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[-a-zA-Z0-9]{8,100}$'),
  binding_hash text NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
  scope_json jsonb NOT NULL CHECK (jsonb_typeof(scope_json)='object' AND octet_length(scope_json::text)<=16384),
  submission_json jsonb NOT NULL CHECK (jsonb_typeof(submission_json)='object' AND octet_length(submission_json::text)<=32768),
  link_json jsonb CHECK (link_json IS NULL OR jsonb_typeof(link_json)='object'),
  delivery_state text NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','dispatching','uncertain','accepted','closed')),
  status_version bigint NOT NULL DEFAULT 0 CHECK (status_version>=0),
  status_json jsonb,
  released boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id,idempotency_key),
  FOREIGN KEY(article_id,revision_id) REFERENCES blog_article_revisions(article_id,id) ON DELETE RESTRICT,
  CHECK ((scope_json->'binding'->>'questionId')=id::text AND (scope_json->'binding'->>'subject')=subject_id::text AND (scope_json->>'originGrantId')=origin_grant_id::text),
  CHECK (NOT released OR (delivery_state='closed' AND status_json IS NOT NULL AND status_json->>'executionClosed'='true'))
);
CREATE TABLE research_qa_reservations (
  id uuid PRIMARY KEY,
  question_id uuid NOT NULL UNIQUE REFERENCES research_qa_questions(id) ON DELETE RESTRICT,
  reserved_micros bigint NOT NULL CHECK (reserved_micros>=0),
  held_micros bigint NOT NULL CHECK (held_micros>=0),
  spent_micros bigint NOT NULL DEFAULT 0 CHECK (spent_micros>=0),
  price_json jsonb NOT NULL CHECK (jsonb_typeof(price_json)='object' AND octet_length(price_json::text)<=4096),
  released boolean NOT NULL DEFAULT false,
  CHECK (NOT released OR held_micros=0)
);
CREATE TABLE research_qa_actions (
  question_id uuid NOT NULL REFERENCES research_qa_questions(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('model','read')),
  slot_index integer NOT NULL,
  action_digest text NOT NULL CHECK (action_digest ~ '^[a-f0-9]{64}$'),
  request_json jsonb NOT NULL,
  permit_id uuid NOT NULL UNIQUE,
  permit_json jsonb NOT NULL,
  token_limit integer NOT NULL CHECK (token_limit BETWEEN 0 AND 80000),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','dispatching','unknown','known','neverSent')),
  PRIMARY KEY(question_id,kind,slot_index),
  CHECK ((kind='model' AND slot_index BETWEEN 0 AND 4 AND token_limit>0) OR (kind='read' AND slot_index BETWEEN 0 AND 1 AND token_limit=0))
);
CREATE TABLE research_qa_receipts (
  receipt_id text PRIMARY KEY CHECK (receipt_id ~ '^[a-f0-9]{64}$'),
  question_id uuid NOT NULL REFERENCES research_qa_questions(id) ON DELETE RESTRICT,
  call_index integer NOT NULL CHECK (call_index BETWEEN 0 AND 4),
  state text NOT NULL CHECK (state IN ('known','unknown')),
  receipt_json jsonb NOT NULL CHECK (octet_length(receipt_json::text)<=16384),
  proof_json jsonb CHECK (proof_json IS NULL OR octet_length(proof_json::text)<=4194304),
  raw_sha256 text CHECK (raw_sha256 IS NULL OR raw_sha256 ~ '^[a-f0-9]{64}$'),
  provider_request_id text,
  cost_micros bigint NOT NULL CHECK (cost_micros>=0),
  UNIQUE(question_id,call_index),
  CHECK ((state='unknown' AND cost_micros=0) OR (state='known' AND proof_json IS NOT NULL AND raw_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX research_qa_receipts_raw_unique ON research_qa_receipts(raw_sha256) WHERE raw_sha256 IS NOT NULL;
CREATE UNIQUE INDEX research_qa_receipts_provider_unique ON research_qa_receipts(provider_request_id) WHERE provider_request_id IS NOT NULL;
CREATE TABLE research_qa_seen_requests (
  issuer text NOT NULL,
  request_id uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES research_qa_questions(id) ON DELETE RESTRICT,
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  action text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(issuer,request_id)
);
CREATE TABLE research_qa_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES research_qa_questions(id) ON DELETE RESTRICT,
  action text NOT NULL,
  details jsonb NOT NULL CHECK (octet_length(details::text)<=32768),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_qa_questions_subject ON research_qa_questions(subject_id,created_at,id);
CREATE INDEX research_qa_questions_pending ON research_qa_questions(delivery_state) WHERE NOT released;
CREATE INDEX research_qa_events_question ON research_qa_events(question_id,id);

CREATE FUNCTION research_qa_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'QA ledger records cannot be deleted'; END IF;
  IF TG_TABLE_NAME='research_qa_questions' THEN
    IF NEW.id<>OLD.id OR NEW.subject_id<>OLD.subject_id OR NEW.origin_grant_id<>OLD.origin_grant_id
      OR NEW.article_id<>OLD.article_id OR NEW.revision_id<>OLD.revision_id OR NEW.idempotency_key<>OLD.idempotency_key
      OR NEW.binding_hash<>OLD.binding_hash OR NEW.scope_json<>OLD.scope_json OR NEW.submission_json<>OLD.submission_json
      OR NEW.created_at<>OLD.created_at OR (OLD.link_json IS NOT NULL AND NEW.link_json IS DISTINCT FROM OLD.link_json)
      OR NEW.status_version<OLD.status_version OR (OLD.released AND NEW IS DISTINCT FROM OLD)
    THEN RAISE EXCEPTION 'QA question binding is immutable'; END IF;
  ELSIF TG_TABLE_NAME='research_qa_reservations' THEN
    IF NEW.id<>OLD.id OR NEW.question_id<>OLD.question_id OR NEW.reserved_micros<>OLD.reserved_micros
      OR NEW.price_json<>OLD.price_json OR NEW.spent_micros<OLD.spent_micros OR (OLD.released AND NEW IS DISTINCT FROM OLD)
    THEN RAISE EXCEPTION 'QA reservation cannot reset'; END IF;
  ELSIF TG_TABLE_NAME='research_qa_receipts' THEN
    IF NEW.receipt_id<>OLD.receipt_id OR NEW.question_id<>OLD.question_id OR NEW.call_index<>OLD.call_index
      OR OLD.state='known' AND NEW IS DISTINCT FROM OLD
      OR OLD.state='unknown' AND NEW.state<>'known'
    THEN RAISE EXCEPTION 'QA confirmed receipt is immutable'; END IF;
  ELSIF TG_TABLE_NAME='research_qa_actions' THEN
    IF NEW.question_id<>OLD.question_id OR NEW.kind<>OLD.kind OR NEW.slot_index<>OLD.slot_index OR NEW.action_digest<>OLD.action_digest
      OR NEW.request_json<>OLD.request_json OR NEW.permit_id<>OLD.permit_id OR NEW.permit_json<>OLD.permit_json OR NEW.token_limit<>OLD.token_limit
      OR (OLD.state IN ('known','neverSent') AND NEW.state<>OLD.state)
      OR (OLD.state='unknown' AND NEW.state NOT IN ('unknown','known'))
      OR (OLD.state='dispatching' AND NEW.state NOT IN ('dispatching','unknown','known'))
    THEN RAISE EXCEPTION 'QA action cannot replay or rebind'; END IF;
  ELSIF TG_TABLE_NAME='research_qa_budgets' THEN
    IF NEW.account_key<>OLD.account_key OR NEW.limit_micros<>OLD.limit_micros OR NEW.spent_micros<OLD.spent_micros OR NEW.version<>OLD.version+1
    THEN RAISE EXCEPTION 'QA budget cannot reset'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER research_qa_questions_guard BEFORE UPDATE OR DELETE ON research_qa_questions FOR EACH ROW EXECUTE FUNCTION research_qa_guard();
CREATE TRIGGER research_qa_reservations_guard BEFORE UPDATE OR DELETE ON research_qa_reservations FOR EACH ROW EXECUTE FUNCTION research_qa_guard();
CREATE TRIGGER research_qa_receipts_guard BEFORE UPDATE OR DELETE ON research_qa_receipts FOR EACH ROW EXECUTE FUNCTION research_qa_guard();
CREATE TRIGGER research_qa_actions_guard BEFORE UPDATE OR DELETE ON research_qa_actions FOR EACH ROW EXECUTE FUNCTION research_qa_guard();
CREATE TRIGGER research_qa_budgets_guard BEFORE UPDATE OR DELETE ON research_qa_budgets FOR EACH ROW EXECUTE FUNCTION research_qa_guard();
CREATE FUNCTION research_qa_reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'QA audit records are append-only';
END;
$$;
CREATE TRIGGER research_qa_seen_requests_append_only BEFORE UPDATE OR DELETE ON research_qa_seen_requests FOR EACH ROW EXECUTE FUNCTION research_qa_reject_append_only_mutation();
CREATE TRIGGER research_qa_events_append_only BEFORE UPDATE OR DELETE ON research_qa_events FOR EACH ROW EXECUTE FUNCTION research_qa_reject_append_only_mutation();
COMMIT;
