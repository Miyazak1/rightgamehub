BEGIN;

-- R1.7 keeps discovery, identity decisions and the research queue private to
-- one Agent. Discovery evidence is append-only; queue state is operational but
-- every transition is mirrored into an immutable event ledger.
CREATE TABLE agent_paper_discovery_runs (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  query_kind text NOT NULL CHECK (query_kind IN ('doi','arxiv','title-author','private-intake')),
  query_json jsonb NOT NULL CHECK (
    jsonb_typeof(query_json)='object' AND octet_length(query_json::text)<=8192
  ),
  query_sha256 text NOT NULL CHECK (query_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('completed','blocked')),
  provider_requests smallint NOT NULL CHECK (provider_requests BETWEEN 0 AND 2),
  candidate_count smallint NOT NULL CHECK (candidate_count BETWEEN 0 AND 12),
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 3 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,request_id),
  CHECK ((status='completed')=(failure_code IS NULL))
);

CREATE TABLE agent_paper_discovery_candidates (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_paper_discovery_runs(id) ON DELETE RESTRICT,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 12),
  source_kind text NOT NULL CHECK (source_kind IN ('crossref','arxiv','private-intake')),
  external_key text NOT NULL CHECK (char_length(external_key) BETWEEN 5 AND 400),
  canonical_doi text CHECK (canonical_doi IS NULL OR char_length(canonical_doi) BETWEEN 7 AND 300),
  arxiv_id text CHECK (arxiv_id IS NULL OR char_length(arxiv_id) BETWEEN 5 AND 120),
  local_document_id text CHECK (local_document_id IS NULL OR local_document_id ~ '^[a-f0-9]{64}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 1000),
  normalized_title text NOT NULL CHECK (char_length(normalized_title) BETWEEN 1 AND 1000),
  title_fingerprint text NOT NULL CHECK (title_fingerprint ~ '^[a-f0-9]{64}$'),
  authors jsonb NOT NULL CHECK (
    jsonb_typeof(authors)='array' AND jsonb_array_length(authors) BETWEEN 1 AND 200
  ),
  author_fingerprint text NOT NULL CHECK (author_fingerprint ~ '^[a-f0-9]{64}$'),
  publication_year integer CHECK (publication_year IS NULL OR publication_year BETWEEN 1600 AND 3000),
  venue text CHECK (venue IS NULL OR char_length(venue) BETWEEN 1 AND 500),
  metadata_json jsonb NOT NULL CHECK (
    jsonb_typeof(metadata_json)='object' AND octet_length(metadata_json::text)<=65536
  ),
  provenance_json jsonb NOT NULL CHECK (
    jsonb_typeof(provenance_json)='object' AND octet_length(provenance_json::text)<=32768
  ),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,ordinal),
  UNIQUE(run_id,candidate_sha256),
  CHECK (canonical_doi IS NOT NULL OR arxiv_id IS NOT NULL OR local_document_id IS NOT NULL
    OR publication_year IS NOT NULL)
);

CREATE TABLE agent_paper_identity_resolutions (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL UNIQUE REFERENCES agent_paper_discovery_candidates(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN (
    'exact-version','exact-identity','new-identity-candidate','possible-match','conflict','blocked'
  )),
  paper_identity_id uuid REFERENCES agent_paper_identities(id) ON DELETE RESTRICT,
  paper_version_id uuid REFERENCES agent_paper_versions(id) ON DELETE RESTRICT,
  match_basis text[] NOT NULL CHECK (
    cardinality(match_basis) BETWEEN 0 AND 4
    AND match_basis <@ ARRAY['doi','arxiv','content-sha256','title-author-year']::text[]
  ),
  decision_json jsonb NOT NULL CHECK (
    jsonb_typeof(decision_json)='object' AND octet_length(decision_json::text)<=32768
  ),
  decision_sha256 text NOT NULL CHECK (decision_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (decision IN ('exact-version','exact-identity','possible-match') AND paper_identity_id IS NOT NULL)
    OR (decision IN ('new-identity-candidate','conflict','blocked') AND paper_identity_id IS NULL)
  ),
  CHECK ((decision='exact-version')=(paper_version_id IS NOT NULL))
);

CREATE TABLE agent_paper_identity_aliases (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  paper_identity_id uuid NOT NULL REFERENCES agent_paper_identities(id) ON DELETE RESTRICT,
  namespace text NOT NULL CHECK (namespace IN ('doi','arxiv','local-sha256')),
  normalized_value text NOT NULL CHECK (char_length(normalized_value) BETWEEN 5 AND 300),
  source_candidate_id uuid REFERENCES agent_paper_discovery_candidates(id) ON DELETE RESTRICT,
  evidence_json jsonb NOT NULL CHECK (
    jsonb_typeof(evidence_json)='object' AND octet_length(evidence_json::text)<=16384
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,namespace,normalized_value)
);

CREATE TABLE agent_paper_research_queue_items (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_candidate_id uuid NOT NULL REFERENCES agent_paper_discovery_candidates(id) ON DELETE RESTRICT,
  paper_identity_id uuid REFERENCES agent_paper_identities(id) ON DELETE RESTRICT,
  queue_key text NOT NULL CHECK (queue_key ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('queued','paused','blocked','completed','rejected')),
  priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,queue_key)
);

CREATE TABLE agent_paper_research_queue_events (
  id uuid PRIMARY KEY,
  queue_item_id uuid NOT NULL REFERENCES agent_paper_research_queue_items(id) ON DELETE RESTRICT,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_state text CHECK (previous_state IS NULL OR previous_state IN (
    'queued','paused','blocked','completed','rejected'
  )),
  next_state text NOT NULL CHECK (next_state IN ('queued','paused','blocked','completed','rejected')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_paper_discovery_runs_agent_created
  ON agent_paper_discovery_runs(agent_user_id,created_at DESC,id DESC);
CREATE INDEX agent_paper_discovery_candidates_agent_fingerprints
  ON agent_paper_discovery_candidates(agent_user_id,title_fingerprint,author_fingerprint,publication_year);
CREATE INDEX agent_paper_identity_resolutions_agent_decision
  ON agent_paper_identity_resolutions(agent_user_id,decision,created_at DESC);
CREATE INDEX agent_paper_research_queue_agent_state
  ON agent_paper_research_queue_items(agent_user_id,state,priority DESC,created_at,id);
CREATE INDEX agent_paper_research_queue_events_item_created
  ON agent_paper_research_queue_events(queue_item_id,created_at,id);

CREATE FUNCTION enforce_agent_paper_discovery_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_json jsonb := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME='agent_paper_discovery_candidates' AND NOT EXISTS (
    SELECT 1 FROM agent_paper_discovery_runs run
    WHERE run.id=(row_json->>'run_id')::uuid AND run.agent_user_id=(row_json->>'agent_user_id')::uuid
  ) THEN RAISE EXCEPTION 'paper discovery run belongs to another agent' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='agent_paper_identity_resolutions' THEN
    IF NOT EXISTS (SELECT 1 FROM agent_paper_discovery_candidates candidate
      WHERE candidate.id=(row_json->>'candidate_id')::uuid AND candidate.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper discovery candidate belongs to another agent' USING ERRCODE='23514'; END IF;
    IF row_json->>'paper_identity_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_paper_identities identity
      WHERE identity.id=(row_json->>'paper_identity_id')::uuid AND identity.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper resolution identity belongs to another agent' USING ERRCODE='23514'; END IF;
    IF row_json->>'paper_version_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_paper_versions version
      JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
      WHERE version.id=(row_json->>'paper_version_id')::uuid AND identity.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper resolution version belongs to another agent' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='agent_paper_identity_aliases' THEN
    IF NOT EXISTS (SELECT 1 FROM agent_paper_identities identity
      WHERE identity.id=(row_json->>'paper_identity_id')::uuid AND identity.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper alias identity belongs to another agent' USING ERRCODE='23514'; END IF;
    IF row_json->>'source_candidate_id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM agent_paper_discovery_candidates candidate
      WHERE candidate.id=(row_json->>'source_candidate_id')::uuid AND candidate.agent_user_id=(row_json->>'agent_user_id')::uuid
    ) THEN RAISE EXCEPTION 'paper alias candidate belongs to another agent' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='agent_paper_research_queue_items' THEN
    IF NOT EXISTS (SELECT 1 FROM agent_paper_discovery_candidates candidate
      WHERE candidate.id=(row_json->>'source_candidate_id')::uuid AND candidate.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper queue candidate belongs to another agent' USING ERRCODE='23514'; END IF;
    IF row_json->>'paper_identity_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_paper_identities identity
      WHERE identity.id=(row_json->>'paper_identity_id')::uuid AND identity.agent_user_id=(row_json->>'agent_user_id')::uuid)
    THEN RAISE EXCEPTION 'paper queue identity belongs to another agent' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='agent_paper_research_queue_events' AND NOT EXISTS (
    SELECT 1 FROM agent_paper_research_queue_items item
    WHERE item.id=(row_json->>'queue_item_id')::uuid AND item.agent_user_id=(row_json->>'agent_user_id')::uuid
  ) THEN RAISE EXCEPTION 'paper queue item belongs to another agent' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_paper_discovery_candidates_scope BEFORE INSERT ON agent_paper_discovery_candidates
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_discovery_scope();
CREATE TRIGGER agent_paper_identity_resolutions_scope BEFORE INSERT ON agent_paper_identity_resolutions
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_discovery_scope();
CREATE TRIGGER agent_paper_identity_aliases_scope BEFORE INSERT ON agent_paper_identity_aliases
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_discovery_scope();
CREATE TRIGGER agent_paper_research_queue_items_scope BEFORE INSERT ON agent_paper_research_queue_items
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_discovery_scope();
CREATE TRIGGER agent_paper_research_queue_events_scope BEFORE INSERT ON agent_paper_research_queue_events
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_discovery_scope();

CREATE FUNCTION guard_agent_paper_queue_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id<>NEW.id OR OLD.agent_user_id<>NEW.agent_user_id
    OR OLD.source_candidate_id<>NEW.source_candidate_id
    OR OLD.paper_identity_id IS DISTINCT FROM NEW.paper_identity_id
    OR OLD.queue_key<>NEW.queue_key OR OLD.created_at<>NEW.created_at THEN
    RAISE EXCEPTION 'paper queue identity fields are immutable';
  END IF;
  IF NOT ((OLD.state='queued' AND NEW.state IN ('paused','completed','rejected'))
    OR (OLD.state='paused' AND NEW.state IN ('queued','rejected'))
    OR OLD.state=NEW.state) THEN
    RAISE EXCEPTION 'invalid paper queue transition';
  END IF;
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_paper_research_queue_items_guard
  BEFORE UPDATE ON agent_paper_research_queue_items
  FOR EACH ROW EXECUTE FUNCTION guard_agent_paper_queue_update();
CREATE TRIGGER agent_paper_research_queue_items_no_delete
  BEFORE DELETE ON agent_paper_research_queue_items
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

CREATE TRIGGER agent_paper_discovery_runs_immutable BEFORE UPDATE OR DELETE ON agent_paper_discovery_runs
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_discovery_candidates_immutable BEFORE UPDATE OR DELETE ON agent_paper_discovery_candidates
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_identity_resolutions_immutable BEFORE UPDATE OR DELETE ON agent_paper_identity_resolutions
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_identity_aliases_immutable BEFORE UPDATE OR DELETE ON agent_paper_identity_aliases
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();
CREATE TRIGGER agent_paper_research_queue_events_immutable BEFORE UPDATE OR DELETE ON agent_paper_research_queue_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

INSERT INTO agent_paper_identity_aliases(
  id,agent_user_id,paper_identity_id,namespace,normalized_value,source_candidate_id,evidence_json
)
SELECT gen_random_uuid(),agent_user_id,id,'doi',lower(doi),NULL,
  jsonb_build_object('source','migration-0150','basis','existing-identity')
FROM agent_paper_identities WHERE doi IS NOT NULL
ON CONFLICT(agent_user_id,namespace,normalized_value) DO NOTHING;
INSERT INTO agent_paper_identity_aliases(
  id,agent_user_id,paper_identity_id,namespace,normalized_value,source_candidate_id,evidence_json
)
SELECT gen_random_uuid(),agent_user_id,id,'arxiv',lower(arxiv_id),NULL,
  jsonb_build_object('source','migration-0150','basis','existing-identity')
FROM agent_paper_identities WHERE arxiv_id IS NOT NULL
ON CONFLICT(agent_user_id,namespace,normalized_value) DO NOTHING;
INSERT INTO agent_paper_identity_aliases(
  id,agent_user_id,paper_identity_id,namespace,normalized_value,source_candidate_id,evidence_json
)
SELECT gen_random_uuid(),agent_user_id,id,'local-sha256',local_document_id,NULL,
  jsonb_build_object('source','migration-0150','basis','existing-identity')
FROM agent_paper_identities WHERE local_document_id IS NOT NULL
ON CONFLICT(agent_user_id,namespace,normalized_value) DO NOTHING;

COMMIT;
