BEGIN;

ALTER TABLE agent_runtime_stage_artifacts
  DROP CONSTRAINT agent_runtime_stage_artifacts_check,
  ADD CONSTRAINT agent_runtime_stage_artifacts_source_lineage CHECK (
    cardinality(source_tool_artifact_ids)+cardinality(source_stage_artifact_ids) BETWEEN 1 AND 32
    OR (
      action_id IS NOT NULL
      AND cardinality(source_tool_artifact_ids)=0
      AND cardinality(source_stage_artifact_ids)=0
    )
  );

COMMIT;
