BEGIN;

ALTER TABLE works
  ADD COLUMN ingestion_method text NOT NULL DEFAULT 'zip_upload'
    CHECK (ingestion_method IN ('zip_upload','github_import')),
  ADD COLUMN attribution_kind text NOT NULL DEFAULT 'publisher'
    CHECK (attribution_kind IN ('publisher','community_catalog'));

UPDATE works w SET ingestion_method='github_import'
WHERE EXISTS (SELECT 1 FROM work_sources s WHERE s.work_id=w.id);

CREATE TABLE work_provenance_events (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('admin_updated')),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_provenance_events_work_idx ON work_provenance_events(work_id,created_at DESC,id);

CREATE FUNCTION reject_work_provenance_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work provenance events are append-only';
END;
$$;

CREATE TRIGGER work_provenance_events_no_update BEFORE UPDATE ON work_provenance_events
  FOR EACH ROW EXECUTE FUNCTION reject_work_provenance_event_mutation();
CREATE TRIGGER work_provenance_events_no_delete BEFORE DELETE ON work_provenance_events
  FOR EACH ROW EXECUTE FUNCTION reject_work_provenance_event_mutation();

CREATE TABLE project_claims (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  claimant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  relationship text NOT NULL CHECK (relationship IN ('owner','maintainer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','cancelled','disputed','suspended','revoked')),
  evidence_type text NOT NULL CHECK (evidence_type IN ('github','website','storefront','other')),
  connection_id uuid REFERENCES github_source_connections(id) ON DELETE RESTRICT,
  source_repository_id uuid REFERENCES github_source_repositories(id) ON DELETE RESTRICT,
  repository_id bigint CHECK (repository_id > 0),
  repository_url text CHECK (repository_url IS NULL OR repository_url ~ '^https://github\.com/'),
  evidence_url text CHECK (evidence_url IS NULL OR (char_length(evidence_url) <= 2048 AND evidence_url ~ '^https://')),
  evidence jsonb NOT NULL,
  applicant_note text NOT NULL DEFAULT '' CHECK (char_length(applicant_note) <= 1000),
  decision_note text NOT NULL DEFAULT '' CHECK (char_length(decision_note) <= 2000),
  previous_owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  verified_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (evidence_type='github' AND connection_id IS NOT NULL AND source_repository_id IS NOT NULL AND repository_id IS NOT NULL AND repository_url IS NOT NULL AND evidence_url IS NULL)
    OR
    (evidence_type<>'github' AND connection_id IS NULL AND source_repository_id IS NULL AND repository_id IS NULL AND repository_url IS NULL AND evidence_url IS NOT NULL)
  )
);

CREATE UNIQUE INDEX project_claims_one_pending_applicant_idx
  ON project_claims(work_id,claimant_user_id) WHERE status='pending';
CREATE UNIQUE INDEX project_claims_one_authority_idx
  ON project_claims(work_id) WHERE status IN ('verified','disputed','suspended');
CREATE INDEX project_claims_claimant_idx ON project_claims(claimant_user_id,updated_at DESC,id);
CREATE INDEX project_claims_review_idx ON project_claims(status,submitted_at,id);

CREATE TABLE project_claim_events (
  id uuid PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES project_claims(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('submitted','cancelled','verified','rejected','disputed','suspended','restored','revoked')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('pending','verified','rejected','cancelled','disputed','suspended','revoked')),
  to_status text NOT NULL CHECK (to_status IN ('pending','verified','rejected','cancelled','disputed','suspended','revoked')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_claim_events_claim_idx ON project_claim_events(claim_id,created_at,id);

CREATE FUNCTION reject_project_claim_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project claim events are append-only';
END;
$$;

CREATE TRIGGER project_claim_events_no_update BEFORE UPDATE ON project_claim_events
  FOR EACH ROW EXECUTE FUNCTION reject_project_claim_event_mutation();
CREATE TRIGGER project_claim_events_no_delete BEFORE DELETE ON project_claim_events
  FOR EACH ROW EXECUTE FUNCTION reject_project_claim_event_mutation();

COMMIT;
