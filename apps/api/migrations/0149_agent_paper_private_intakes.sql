BEGIN;

-- R1.6 adds a private, operator-owned intake ledger. Files are inspected in
-- quarantine, then accepted bytes are promoted into a content-addressed,
-- private archive. Rows retain immutable provenance and security decisions.
ALTER TABLE agent_paper_identities
  ADD COLUMN local_document_id text CHECK (
    local_document_id IS NULL OR local_document_id ~ '^[a-f0-9]{64}$'
  );

ALTER TABLE agent_paper_identities
  DROP CONSTRAINT agent_paper_identities_check;
ALTER TABLE agent_paper_identities
  ADD CONSTRAINT agent_paper_identities_locator_check CHECK (
    doi IS NOT NULL OR arxiv_id IS NOT NULL OR local_document_id IS NOT NULL
  );
ALTER TABLE agent_paper_identities
  ADD CONSTRAINT agent_paper_identities_id_agent_unique UNIQUE(id,agent_user_id);

CREATE TABLE agent_paper_private_intakes (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  intake_kind text NOT NULL CHECK (intake_kind IN ('doi-metadata','user-pdf')),
  status text NOT NULL CHECK (status IN ('accepted','blocked')),
  canonical_doi text CHECK (canonical_doi IS NULL OR char_length(canonical_doi) BETWEEN 7 AND 300),
  original_filename text CHECK (original_filename IS NULL OR char_length(original_filename) BETWEEN 1 AND 240),
  declared_media_type text CHECK (declared_media_type IS NULL OR char_length(declared_media_type) BETWEEN 3 AND 120),
  sniffed_media_type text CHECK (sniffed_media_type IS NULL OR char_length(sniffed_media_type) BETWEEN 3 AND 120),
  byte_length bigint CHECK (byte_length IS NULL OR byte_length BETWEEN 1 AND 20971520),
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  object_key text CHECK (object_key IS NULL OR object_key ~ '^paper-archive/[0-9a-f-]{36}/[a-f0-9]{64}\.pdf$'),
  rights_attestation text CHECK (rights_attestation IS NULL OR rights_attestation IN (
    'user-owned','authorized-use','open-license'
  )),
  security_report jsonb NOT NULL CHECK (
    jsonb_typeof(security_report)='object' AND octet_length(security_report::text)<=131072
  ),
  paper_identity_id uuid REFERENCES agent_paper_identities(id) ON DELETE RESTRICT,
  paper_version_id uuid REFERENCES agent_paper_versions(id) ON DELETE RESTRICT,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 3 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_user_id,request_id),
  CHECK ((status='accepted')=(failure_code IS NULL)),
  CHECK (
    (intake_kind='doi-metadata' AND canonical_doi IS NOT NULL AND object_key IS NULL
      AND rights_attestation IS NULL AND paper_identity_id IS NOT NULL)
    OR
    (intake_kind='user-pdf' AND original_filename IS NOT NULL
      AND declared_media_type='application/pdf' AND rights_attestation IS NOT NULL
      AND content_sha256 IS NOT NULL AND byte_length IS NOT NULL)
  ),
  CHECK (status='blocked' OR paper_identity_id IS NOT NULL),
  CHECK (status='blocked' OR intake_kind='doi-metadata' OR paper_version_id IS NOT NULL),
  CHECK (status='blocked' OR intake_kind='doi-metadata' OR object_key IS NOT NULL)
);

CREATE FUNCTION enforce_agent_paper_private_intake_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paper_identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agent_paper_identities identity
    WHERE identity.id=NEW.paper_identity_id AND identity.agent_user_id=NEW.agent_user_id
  ) THEN
    RAISE EXCEPTION 'paper intake identity belongs to another agent' USING ERRCODE='23514';
  END IF;
  IF NEW.paper_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agent_paper_versions version
    JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
    WHERE version.id=NEW.paper_version_id AND identity.agent_user_id=NEW.agent_user_id
  ) THEN
    RAISE EXCEPTION 'paper intake version belongs to another agent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_paper_private_intakes_scope
  BEFORE INSERT ON agent_paper_private_intakes
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_paper_private_intake_scope();

CREATE INDEX agent_paper_private_intakes_agent_created
  ON agent_paper_private_intakes(agent_user_id,created_at DESC,id DESC);
CREATE INDEX agent_paper_private_intakes_content
  ON agent_paper_private_intakes(agent_user_id,content_sha256)
  WHERE content_sha256 IS NOT NULL;

CREATE TRIGGER agent_paper_private_intakes_immutable
  BEFORE UPDATE OR DELETE ON agent_paper_private_intakes
  FOR EACH ROW EXECUTE FUNCTION reject_agent_paper_research_mutation();

COMMIT;
