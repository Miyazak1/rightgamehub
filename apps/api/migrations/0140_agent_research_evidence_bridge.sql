BEGIN;

-- Foundation tool artifacts remain the execution ledger, while the existing
-- tool_research_* tables remain the cross-workflow evidence ledger.  These
-- bindings join the two without copying either ownership model or inventing a
-- blog-only source archive.
CREATE TABLE agent_research_artifact_bindings (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL,
  action_id uuid NOT NULL,
  tool_artifact_id uuid NOT NULL UNIQUE REFERENCES agent_tool_artifacts(id) ON DELETE RESTRICT,
  research_source_id uuid NOT NULL REFERENCES tool_research_sources(id) ON DELETE RESTRICT,
  research_source_version_id uuid NOT NULL REFERENCES tool_research_source_versions(id) ON DELETE RESTRICT,
  artifact_kind text NOT NULL CHECK (artifact_kind IN (
    'github.repository','web.page','paper','user.file'
  )),
  locator jsonb NOT NULL CHECK (
    jsonb_typeof(locator)='object' AND octet_length(locator::text)<=16384
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,stage_id) REFERENCES agent_run_stages(run_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(run_id,action_id) REFERENCES agent_run_actions(run_id,id) ON DELETE RESTRICT,
  UNIQUE(run_id,id),
  UNIQUE(id,tool_artifact_id),
  UNIQUE(run_id,research_source_version_id,tool_artifact_id)
);

CREATE INDEX agent_research_artifact_bindings_source
  ON agent_research_artifact_bindings(research_source_id,created_at,id);
CREATE INDEX agent_research_artifact_bindings_run
  ON agent_research_artifact_bindings(run_id,created_at,id);

CREATE TABLE agent_research_evidence_bindings (
  artifact_binding_id uuid NOT NULL REFERENCES agent_research_artifact_bindings(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  evidence_role text NOT NULL CHECK (evidence_role IN ('metadata','primary-text','supporting-text')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(artifact_binding_id,evidence_id)
);

CREATE INDEX agent_research_evidence_bindings_evidence
  ON agent_research_evidence_bindings(evidence_id,artifact_binding_id);

-- A Foundation revision cites stable evidence spans, not merely the transient
-- tool call that fetched them. One citation may bind several bounded spans
-- from one immutable source version.
CREATE TABLE blog_revision_citation_evidence (
  revision_id uuid NOT NULL REFERENCES blog_article_revisions(id) ON DELETE RESTRICT,
  citation_id uuid NOT NULL,
  tool_artifact_id uuid NOT NULL REFERENCES agent_tool_artifacts(id) ON DELETE RESTRICT,
  artifact_binding_id uuid NOT NULL,
  evidence_id uuid NOT NULL REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(revision_id,citation_id,evidence_id),
  FOREIGN KEY(artifact_binding_id,tool_artifact_id)
    REFERENCES agent_research_artifact_bindings(id,tool_artifact_id) ON DELETE RESTRICT,
  FOREIGN KEY(artifact_binding_id,evidence_id)
    REFERENCES agent_research_evidence_bindings(artifact_binding_id,evidence_id) ON DELETE RESTRICT
);

CREATE INDEX blog_revision_citation_evidence_lookup
  ON blog_revision_citation_evidence(revision_id,citation_id,created_at,evidence_id);

CREATE FUNCTION reject_agent_research_evidence_binding_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent research evidence bindings are immutable';
END;
$$;

CREATE TRIGGER agent_research_artifact_bindings_immutable
  BEFORE UPDATE OR DELETE ON agent_research_artifact_bindings
  FOR EACH ROW EXECUTE FUNCTION reject_agent_research_evidence_binding_mutation();

CREATE TRIGGER agent_research_evidence_bindings_immutable
  BEFORE UPDATE OR DELETE ON agent_research_evidence_bindings
  FOR EACH ROW EXECUTE FUNCTION reject_agent_research_evidence_binding_mutation();

CREATE TRIGGER blog_revision_citation_evidence_immutable
  BEFORE UPDATE OR DELETE ON blog_revision_citation_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_agent_research_evidence_binding_mutation();

COMMIT;
