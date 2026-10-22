BEGIN;

CREATE TABLE tool_research_gaps (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  question_sha256 text NOT NULL CHECK (question_sha256 ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','important','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','queued','resolved','dismissed')),
  origin text NOT NULL DEFAULT 'contract' CHECK (origin IN ('contract','user','researcher','system')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,question_sha256),
  UNIQUE(topic_id,id)
);

CREATE INDEX tool_research_gaps_topic_idx
  ON tool_research_gaps(topic_id,status,priority,created_at,id);

CREATE TABLE tool_researcher_jobs (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  gap_id uuid NOT NULL,
  contract_version integer NOT NULL,
  protocol text NOT NULL DEFAULT 'research-job-v1' CHECK (protocol='research-job-v1'),
  request_json jsonb NOT NULL CHECK (jsonb_typeof(request_json)='object'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','leased','completed','failed','uncertain','cancelled')),
  attempt_id uuid,
  leased_by text CHECK (leased_by IS NULL OR char_length(leased_by) BETWEEN 1 AND 120),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  result_json jsonb CHECK (result_json IS NULL OR jsonb_typeof(result_json)='object'),
  result_sha256 text CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[a-f0-9]{64}$'),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 120),
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(topic_id,contract_version)
    REFERENCES tool_research_topic_contracts(topic_id,version),
  FOREIGN KEY(topic_id,gap_id)
    REFERENCES tool_research_gaps(topic_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX tool_researcher_jobs_one_active_gap_idx
  ON tool_researcher_jobs(gap_id)
  WHERE status IN ('queued','leased');
CREATE INDEX tool_researcher_jobs_queue_idx
  ON tool_researcher_jobs(queued_at,id)
  WHERE status='queued' OR lease_until IS NOT NULL;
CREATE INDEX tool_researcher_jobs_topic_idx
  ON tool_researcher_jobs(topic_id,created_at DESC,id DESC);

CREATE TABLE tool_research_claims (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES tool_research_topics(id) ON DELETE CASCADE,
  stable_key text NOT NULL CHECK (stable_key ~ '^[a-f0-9]{64}$'),
  finding_id text NOT NULL CHECK (char_length(finding_id) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('event','metric','claim','contradiction')),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','accepted','rejected','superseded')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_id,stable_key)
);

CREATE INDEX tool_research_claims_topic_idx
  ON tool_research_claims(topic_id,status,updated_at DESC,id DESC);

CREATE TABLE tool_research_claim_revisions (
  claim_id uuid NOT NULL REFERENCES tool_research_claims(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  job_id uuid NOT NULL REFERENCES tool_researcher_jobs(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  importance text NOT NULL CHECK (importance IN ('routine','important','critical')),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(claim_id,revision),
  UNIQUE(job_id,claim_id)
);

CREATE TABLE tool_research_claim_evidence (
  claim_id uuid NOT NULL,
  revision integer NOT NULL,
  evidence_id uuid NOT NULL REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  stance text NOT NULL DEFAULT 'supports' CHECK (stance IN ('supports','opposes','context')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(claim_id,revision,evidence_id),
  FOREIGN KEY(claim_id,revision)
    REFERENCES tool_research_claim_revisions(claim_id,revision) ON DELETE CASCADE
);

CREATE TRIGGER tool_research_claim_revision_immutable
  BEFORE UPDATE ON tool_research_claim_revisions
  FOR EACH ROW EXECUTE FUNCTION protect_research_evidence_fact();
CREATE TRIGGER tool_research_claim_evidence_immutable
  BEFORE UPDATE ON tool_research_claim_evidence
  FOR EACH ROW EXECUTE FUNCTION protect_research_evidence_fact();

COMMIT;
