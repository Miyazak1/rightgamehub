BEGIN;

ALTER TABLE agent_blog_foundation_drafts
  ADD COLUMN verification_artifact_id uuid REFERENCES agent_runtime_stage_artifacts(id) ON DELETE RESTRICT,
  ADD COLUMN composition_artifact_id uuid REFERENCES agent_runtime_stage_artifacts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT agent_blog_foundation_draft_lineage_pair
    CHECK ((verification_artifact_id IS NULL)=(composition_artifact_id IS NULL));

CREATE INDEX agent_blog_foundation_drafts_verification
  ON agent_blog_foundation_drafts(verification_artifact_id)
  WHERE verification_artifact_id IS NOT NULL;

COMMIT;
